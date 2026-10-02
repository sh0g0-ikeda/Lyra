import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const template = JSON.parse(readFileSync(fileURLToPath(new URL('./runtime.json', import.meta.url)), 'utf8'));
const resources = template.Resources;
const serialized = JSON.stringify(template);

assert.equal(template.Parameters.DesiredApiCount.Default, 0);
for (const name of ['DesiredGenerationCount', 'DesiredExportCount', 'DesiredDeletionCount']) assert.equal(template.Parameters[name].Default, 0);
for (const name of ['ApiService', 'GenerationService', 'ExportService', 'DeletionService']) {
  assert.equal(resources[name].Type, 'AWS::ECS::Service');
  assert.ok(resources[name].Properties.DesiredCount);
  assert.equal(resources[name].Properties.LaunchType, 'FARGATE');
  assert.equal(resources[name].Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp, 'ENABLED');
}
assert.deepEqual(resources.ApiService.Properties.DesiredCount, { Ref: 'DesiredApiCount' });
for (const name of ['ApiTaskDefinition', 'GenerationTaskDefinition', 'ExportTaskDefinition', 'DeletionTaskDefinition', 'MigrationTaskDefinition']) {
  const task = resources[name];
  assert.equal(task.Type, 'AWS::ECS::TaskDefinition');
  assert.equal(task.Properties.RuntimePlatform.CpuArchitecture, 'ARM64');
  assert.equal(task.Properties.RequiresCompatibilities[0], 'FARGATE');
  assert.equal(task.Properties.Cpu, '512');
  assert.equal(task.Properties.Memory, '1024');
}
for (const name of ['ExecutionRole', 'ApiTaskRole', 'WorkerTaskRole', 'MigrationTaskRole']) {
  const role = resources[name];
  assert.equal(role.Type, 'AWS::IAM::Role');
  assert.ok(role.Properties.PermissionsBoundary);
  assert.match(JSON.stringify(role.Properties.Policies), /ProductionDeniedArns/);
}
assert.match(JSON.stringify(resources.MigrationTaskRole.Properties.Policies), /GetSecretValue/);
assert.equal(JSON.stringify(resources.MigrationTaskRole.Properties.Policies).includes('sqs:'), false);
assert.equal(JSON.stringify(resources.MigrationTaskRole.Properties.Policies).includes('s3:'), false);
assert.match(JSON.stringify(resources.ApiTaskRole.Properties.Policies), /sqs:SendMessage/);
assert.match(JSON.stringify(resources.WorkerTaskRole.Properties.Policies), /sqs:ReceiveMessage/);
assert.equal(serialized.includes('s3:DeleteObjectVersion'), false);
assert.equal(serialized.includes('"Secrets"'), false);
assert.match(JSON.stringify(resources.ApiTaskDefinition.Properties.ContainerDefinitions[0].Command), /startProductionApi/);


const entrypoints={"Api":"startProductionApi","Generation":"startProductionWorker","Export":"startProductionEpisodeExportWorker","Deletion":"startProductionAccountDeletionWorker","Migration":"startProductionMigration"};
for (const [name, entry] of Object.entries(entrypoints)) {
 const p=resources[`${name}TaskDefinition`].Properties,c=p.ContainerDefinitions[0];
 assert.equal(existsSync(fileURLToPath(new URL(`../../scripts/${entry}.ts`,import.meta.url))),true);
 assert.deepEqual(c.Command,["/usr/local/bin/bun",`dist/scripts/${entry}.js`]);
 assert.deepEqual(c.Environment.find(e=>e.Name==="LYRA_APP_SECRET_ID").Value,{Ref:"RuntimeSecretArn"});
 assert.deepEqual(c.Environment.find(e=>e.Name==="STAGING_SECRET_SOURCE_ID").Value,{Ref:"RuntimeSecretArn"});
 assert.equal(c.Secrets,undefined); assert.equal(c.LogConfiguration.LogDriver,"awslogs");
 assert.ok(p.Tags.some(t=>t.Key==="LyraStagingId"));
}
for (const [name,param] of Object.entries({Api:"DesiredApiCount",Generation:"DesiredGenerationCount",Export:"DesiredExportCount",Deletion:"DesiredDeletionCount"})) {
 const p=resources[`${name}Service`].Properties;
 assert.deepEqual(p.DesiredCount,{Ref:param}); assert.equal(template.Parameters[param].Default,0);
 assert.deepEqual(p.NetworkConfiguration.AwsvpcConfiguration.SecurityGroups,[{Ref:name==="Api"?"ApiSG":"WorkerSG"}]);
}


const protection=resources.WorkerTaskRole.Properties.Policies[0].PolicyDocument.Statement.find(s=>s.Sid==='OwnTaskScaleInProtection');
assert.ok(protection, 'task protection is limited to owned staging worker tasks');
assert.deepEqual(protection.Action,['ecs:GetTaskProtection','ecs:UpdateTaskProtection']);
assert.deepEqual(protection.Resource,{'Fn::Sub':'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:task/${ClusterName}/*'});
assert.deepEqual(protection.Condition.ArnEquals['ecs:cluster'],{'Fn::Sub':'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:cluster/${ClusterName}'});
assert.equal(resources.GenerationTaskDefinition.Properties.ContainerDefinitions[0].Environment.find(e=>e.Name==='ECS_TASK_SCALE_IN_PROTECTION_ENABLED')?.Value,'true');
console.log('runtime contract passed');
