import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessGoogleExpiryAwsInventory,
  buildGoogleExpiryRunTaskRequest,
  buildGoogleExpiryTaskRecord,
} from './stage-google-expiry-aws-contract.mjs';

const stage='lyra-staging-20261003';
const taskDefinitionArn='arn:aws:ecs:ap-northeast-1:452284481392:task-definition/lyra-staging-20261003-google-link-expiry:1';
function fixture(){
  const foundation={parameters:{GoogleIdentityProviderEnabled:'true'},outputs:{EcsClusterArn:`arn:aws:ecs:ap-northeast-1:452284481392:cluster/${stage}-cluster`,PublicSubnetAId:'subnet-aa',PublicSubnetCId:'subnet-cc',WorkerSecurityGroupId:'sg-aa'}};
  const outputs={GoogleLinkExpiryScheduleGroupName:`${stage}-google-auth`,GoogleLinkExpiryScheduleName:`${stage}-google-link-expiry`,GoogleLinkExpiryScheduleArn:`arn:aws:scheduler:ap-northeast-1:452284481392:schedule/${stage}-google-auth/${stage}-google-link-expiry`,GoogleLinkExpiryTaskDefinitionArn:taskDefinitionArn,GoogleLinkExpirySchedulerRoleArn:`arn:aws:iam::452284481392:role/${stage}-google-link-expiry-scheduler`,GoogleLinkExpiryDlqArn:`arn:aws:sqs:ap-northeast-1:452284481392:${stage}-google-link-expiry-dlq`};
  return {runtimeStack:{parameters:{GoogleIdentityExpiryEnabled:'true'},outputs},foundationStack:foundation,group:{Name:`${stage}-google-auth`,Arn:`arn:aws:scheduler:ap-northeast-1:452284481392:schedule-group/${stage}-google-auth`},groupTags:{Tags:[{Key:'Owner',Value:'Lyra'},{Key:'Environment',Value:'staging'},{Key:'LyraStagingId',Value:stage},{Key:'ExpiresAt',Value:'2026-10-10'}]},schedule:{Name:`${stage}-google-link-expiry`,GroupName:`${stage}-google-auth`,Arn:outputs.GoogleLinkExpiryScheduleArn,State:'DISABLED',ScheduleExpression:'rate(15 minutes)',FlexibleTimeWindow:{Mode:'OFF'},EndDate:new Date('2026-10-10T00:00:00.000Z'),Target:{Arn:foundation.outputs.EcsClusterArn,RoleArn:outputs.GoogleLinkExpirySchedulerRoleArn,DeadLetterConfig:{Arn:outputs.GoogleLinkExpiryDlqArn},RetryPolicy:{MaximumEventAgeInSeconds:60,MaximumRetryAttempts:0},EcsParameters:{TaskDefinitionArn:taskDefinitionArn,TaskCount:1,LaunchType:'FARGATE',EnableECSManagedTags:true,PropagateTags:'TASK_DEFINITION',NetworkConfiguration:{awsvpcConfiguration:{AssignPublicIp:'ENABLED',Subnets:['subnet-aa','subnet-cc'],SecurityGroups:['sg-aa']}}}}},taskRecord:null,task:null};
}
test('Google未公開なら旧stackと明示OFFのどちらもScheduler資源なしでv1互換になる',()=>{
  for(const expiry of [undefined,'false']){
    const parameters=expiry===undefined?{}:{GoogleIdentityExpiryEnabled:expiry};
    assert.deepEqual(assessGoogleExpiryAwsInventory({
      runtimeStack:{parameters},
      foundationStack:{parameters:{GoogleIdentityProviderEnabled:'false'}},
    }),{configured:false});
  }
  assert.deepEqual(assessGoogleExpiryAwsInventory({runtimeStack:{parameters:{}},foundationStack:{parameters:{}}}),{configured:false});
});
test('Google公開済みでexpiryが未設定またはOFFならfail closedになる',()=>{
  for(const expiry of [undefined,'false']){
    const parameters=expiry===undefined?{}:{GoogleIdentityExpiryEnabled:expiry};
    assert.throws(()=>assessGoogleExpiryAwsInventory({
      runtimeStack:{parameters},
      foundationStack:{parameters:{GoogleIdentityProviderEnabled:'true'}},
    }),/GOOGLE_EXPIRY_CONFIGURATION_INVALID/u);
  }
});
test('exact group tags/output/targetだけを受理する',()=>{const x=assessGoogleExpiryAwsInventory(fixture());assert.equal(x.configured,true);assert.equal(x.schedule.state,'DISABLED');for(const mutate of [f=>f.groupTags.Tags.pop(),f=>{f.schedule.Target.RetryPolicy.MaximumRetryAttempts=1;},f=>{f.schedule.Target.EcsParameters.TaskDefinitionArn=taskDefinitionArn.replace(':1',':01');}]){const bad=fixture();mutate(bad);assert.throws(()=>assessGoogleExpiryAwsInventory(bad));}});
test('one-off RunTaskはexact stage networkとdeterministic tokenに固定する',()=>{const x=assessGoogleExpiryAwsInventory(fixture());const a=buildGoogleExpiryRunTaskRequest(x.configuration,'2026-10-09T14:11:00.000Z');const b=buildGoogleExpiryRunTaskRequest(x.configuration,'2026-10-09T14:11:00.000Z');assert.deepEqual(a,b);assert.equal(a.startedBy,'lyra-stage-google-expiry-v1');assert.deepEqual(a.networkConfiguration.awsvpcConfiguration.subnets,['subnet-aa','subnet-cc']);});
test('記録したtaskだけをrunning/completedとして分類する',()=>{const task={taskArn:`arn:aws:ecs:ap-northeast-1:452284481392:task/${stage}-cluster/${'a'.repeat(32)}`,clusterArn:`arn:aws:ecs:ap-northeast-1:452284481392:cluster/${stage}-cluster`,taskDefinitionArn,startedBy:'lyra-stage-google-expiry-v1',group:`family:${stage}-google-link-expiry`,lastStatus:'RUNNING'};const record=buildGoogleExpiryTaskRecord(task,'2026-10-09T14:11:00.000Z',taskDefinitionArn);const running=fixture();running.taskRecord=record;running.task=task;running.activeTasks=[task];assert.equal(assessGoogleExpiryAwsInventory(running).cleanupTask.status,'running');const done=fixture();done.taskRecord=record;done.task={...task,lastStatus:'STOPPED',desiredStatus:'STOPPED',stopCode:'EssentialContainerExited',stoppedAt:'2026-10-09T14:12:00.000Z',containers:[{name:'google-link-expiry',exitCode:0}]};assert.equal(assessGoogleExpiryAwsInventory(done).cleanupTask.status,'completed');});
test('停止済みtaskがECS履歴から消えてもsealed completionとrecordで再開できる',()=>{
  const task={taskArn:`arn:aws:ecs:ap-northeast-1:452284481392:task/${stage}-cluster/${'b'.repeat(32)}`,taskDefinitionArn,startedBy:'lyra-stage-google-expiry-v1',group:`family:${stage}-google-link-expiry`};
  const record=buildGoogleExpiryTaskRecord(task,'2026-10-09T14:11:00.000Z',taskDefinitionArn);
  const value=fixture();value.taskRecord=record;value.sealedCompletedAtUtc='2026-10-09T14:12:00.000Z';
  const result=assessGoogleExpiryAwsInventory(value);
  assert.deepEqual(result.cleanupTask,{status:'completed',count:0,completedAtUtc:'2026-10-09T14:12:00.000Z'});
});
