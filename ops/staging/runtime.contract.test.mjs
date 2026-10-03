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
assert.deepEqual(protection.Resource,{'Fn::Sub':['arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:task/${StageClusterName}/*',{StageClusterName:{'Fn::Select':[1,{'Fn::Split':['/',{Ref:'ClusterArn'}]}]}}]});
assert.deepEqual(protection.Condition.ArnEquals['ecs:cluster'],{Ref:'ClusterArn'});
assert.equal(resources.GenerationTaskDefinition.Properties.ContainerDefinitions[0].Environment.find(e=>e.Name==='ECS_TASK_SCALE_IN_PROTECTION_ENABLED')?.Value,'true');

const stageImageRole = { 'Fn::Sub': 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${ResourcePrefix}-state-v2-image-create' };
const stageRecoveryRole = { 'Fn::Sub': 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${ResourcePrefix}-state-v2-recovery' };
const apiStateAssumption = resources.ApiTaskRole.Properties.Policies[0].PolicyDocument.Statement.find(s => s.Sid === 'AssumeExactStageStateV2Roles');
const workerStateAssumption = resources.WorkerTaskRole.Properties.Policies[0].PolicyDocument.Statement.find(s => s.Sid === 'AssumeExactStageStateV2RecoveryRole');
assert.deepEqual(apiStateAssumption, { Sid: 'AssumeExactStageStateV2Roles', Effect: 'Allow', Action: 'sts:AssumeRole', Resource: [stageImageRole, stageRecoveryRole] });
assert.deepEqual(workerStateAssumption, { Sid: 'AssumeExactStageStateV2RecoveryRole', Effect: 'Allow', Action: 'sts:AssumeRole', Resource: stageRecoveryRole });



// Every CloudFormation substitution must resolve before a stage can be updated.
const pseudoParameters = new Set(['AWS::AccountId','AWS::NotificationARNs','AWS::NoValue','AWS::Partition','AWS::Region','AWS::StackId','AWS::StackName','AWS::URLSuffix']);
function validateSubstitutions(value) {
 if (!value || typeof value !== 'object') return;
 if (Object.hasOwn(value,'Fn::Sub')) {
  const sub=value['Fn::Sub'];
  const text=Array.isArray(sub)?sub[0]:sub;
  const bindings=Array.isArray(sub)?sub[1]:{};
  for (const match of text.matchAll(/\$\{([^}]+)\}/g)) {
   const name=match[1];
   if(name.startsWith('!')) continue;
   assert.ok(Object.hasOwn(bindings,name)||pseudoParameters.has(name)||Object.hasOwn(template.Parameters,name)||Object.hasOwn(resources,name.split('.')[0]), 'unresolved CloudFormation substitution: '+name);
  }
 }
 for(const child of Object.values(value)) validateSubstitutions(child);
}
validateSubstitutions(template);



// DeregisterTaskDefinition cannot be restricted by task ARN; retain definitions for scoped cleanup.
for(const name of ['ApiTaskDefinition','GenerationTaskDefinition','ExportTaskDefinition','DeletionTaskDefinition','MigrationTaskDefinition']) {
 assert.equal(resources[name].UpdateReplacePolicy,'Retain','replacement must not require unscoped deregistration');
 assert.equal(resources[name].DeletionPolicy,'Retain','stack cleanup must not require unscoped deregistration');
}

console.log('runtime contract passed');
