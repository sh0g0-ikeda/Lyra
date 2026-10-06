import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPolicyScope, buildGoogleExpiryDeployerPolicy, validateCurrentPolicy } from './google-expiry-deployer-policy.mjs';

const denyResources = ['arn:aws:iam::452284481392:role/lyra-prod-api-task-role', 'arn:aws:sqs:ap-northeast-1:452284481392:lyra-prod-generation'];
const current = { Version: '2012-10-17', Statement: [{ Sid: 'DenyExistingProductionResources', Effect: 'Deny', Action: '*', Resource: denyResources }, { Effect: 'Allow', Action: 'ecs:DescribeClusters', Resource: '*' }] };

test('production denyを完全に複製してstaging expiry専用allowだけを足す', () => {
  const generated = buildGoogleExpiryDeployerPolicy(current);
  const deny = generated.Statement.find((statement) => statement.Sid === 'DenyExistingProductionResources');
  assert.deepEqual(deny.Resource, denyResources);
  assert.notEqual(deny.Resource, denyResources);
  const allows = generated.Statement.filter((statement) => statement.Effect === 'Allow');
  assert.equal(allows.some((statement) => statement.Resource === '*'), false);
  assert.equal(allows.some((statement) => JSON.stringify(statement.Resource).includes('lyra-prod')), false);
  assert.equal(allows.some((statement) => JSON.stringify(statement.Resource).includes('999999999999')), false);
});

test('CreateRoleは専用scheduler role、4 tags、boundary条件に限定される', () => {
  const create = buildGoogleExpiryDeployerPolicy(current).Statement.find((statement) => statement.Sid === 'CreateGoogleExpirySchedulerRole');
  assert.deepEqual(create.Resource, 'arn:aws:iam::452284481392:role/lyra-staging-20261003-google-link-expiry-scheduler');
  assert.deepEqual(create.Condition.ArnEquals['iam:PermissionsBoundary'], 'arn:aws:iam::452284481392:policy/lyra-staging-20261003-google-link-expiry-boundary');
  assert.deepEqual(Object.keys(create.Condition.StringEquals).sort(), ['aws:RequestTag/Environment', 'aws:RequestTag/ExpiresAt', 'aws:RequestTag/LyraStagingId', 'aws:RequestTag/Owner']);
});

test('scheduler pass roleとCloudWatch/SQS/Scheduler resourceをexact stage ARNに限定する', () => {
  const statements = buildGoogleExpiryDeployerPolicy(current).Statement;
  const pass = statements.find((statement) => statement.Sid === 'PassGoogleExpirySchedulerRole');
  assert.equal(pass.Condition.StringEquals['iam:PassedToService'], 'scheduler.amazonaws.com');
  assert.equal(statements.find((statement) => statement.Sid === 'ManageGoogleExpiryScheduleGroup').Resource, 'arn:aws:scheduler:ap-northeast-1:452284481392:schedule-group/lyra-staging-20261003-google-auth');
  assert.deepEqual(statements.find((statement) => statement.Sid === 'ManageGoogleExpiryAlarms').Resource, ['arn:aws:cloudwatch:ap-northeast-1:452284481392:alarm:lyra-staging-20261003-google-link-expiry-failure', 'arn:aws:cloudwatch:ap-northeast-1:452284481392:alarm:lyra-staging-20261003-google-link-expiry-at-limit', 'arn:aws:cloudwatch:ap-northeast-1:452284481392:alarm:lyra-staging-20261003-google-link-expiry-dlq']);
});

test('期限task definitionのreadとderegisterは新familyのrevision ARNだけに限定する', () => {
  const task = buildGoogleExpiryDeployerPolicy(current).Statement.find((statement) => statement.Sid === 'ReadAndDeregisterGoogleExpiryTaskDefinition');
  assert.deepEqual(task.Action, ['ecs:DescribeTaskDefinition', 'ecs:DeregisterTaskDefinition']);
  assert.equal(task.Resource, 'arn:aws:ecs:ap-northeast-1:452284481392:task-definition/lyra-staging-20261003-google-link-expiry:*');
  assert.equal(task.Resource.includes('lyra-staging-20261003-api'), false);
  assert.equal(task.Resource === '*', false);
});

test('allowのwildcard、別account、別stage、unexpected resourceを拒否する', () => {
  for (const resource of ['*', 'arn:aws:sqs:ap-northeast-1:999999999999:lyra-staging-20261003-google-link-expiry-dlq', 'arn:aws:sqs:ap-northeast-1:452284481392:lyra-prod-generation', 'arn:aws:sqs:ap-northeast-1:452284481392:lyra-staging-20261004-google-link-expiry-dlq', 'arn:aws:iam::452284481392:role/lyra-staging-20261003-unexpected']) {
    assert.throws(() => assertPolicyScope({ Statement: [{ Effect: 'Allow', Resource: resource }] }), /GENERATED_POLICY_SCOPE_INVALID/);
  }
});

test('CreateRoleのboundaryまたは4 tag条件、PassRoleのscheduler条件が欠けると拒否する', () => {
  const policy = buildGoogleExpiryDeployerPolicy(current);
  for (const mutate of [
    (candidate) => delete candidate.Statement.find((statement) => statement.Sid === 'CreateGoogleExpirySchedulerRole').Condition.ArnEquals['iam:PermissionsBoundary'],
    (candidate) => delete candidate.Statement.find((statement) => statement.Sid === 'CreateGoogleExpirySchedulerRole').Condition.StringEquals['aws:RequestTag/Owner'],
    (candidate) => { candidate.Statement.find((statement) => statement.Sid === 'PassGoogleExpirySchedulerRole').Condition.StringEquals['iam:PassedToService'] = 'ecs-tasks.amazonaws.com'; },
  ]) {
    const candidate = structuredClone(policy);
    mutate(candidate);
    assert.throws(() => assertPolicyScope(candidate), /GENERATED_POLICY_SCOPE_INVALID/);
  }
});

for (const [name, value, code] of [
  ['denyがない', { Version: '2012-10-17', Statement: [] }, 'CURRENT_POLICY_DENY_MISSING'],
  ['deny resourceがない', { Version: '2012-10-17', Statement: [{ Sid: 'DenyExistingProductionResources', Effect: 'Deny', Action: '*', Resource: [] }] }, 'CURRENT_POLICY_DENY_INVALID'],
]) test(`${name}を拒否する`, () => assert.throws(() => validateCurrentPolicy(value), new RegExp(code)));

test('専用groupの削除にはそのgroup配下だけのdependent DeleteScheduleが付く', () => {
  const policy = buildGoogleExpiryDeployerPolicy(current);
  const deletion = policy.Statement.find((s) => s.Sid === 'DeleteSchedulesOnlyInGoogleExpiryGroup');
  assert.deepEqual(deletion, { Sid: 'DeleteSchedulesOnlyInGoogleExpiryGroup', Effect: 'Allow', Action: 'scheduler:DeleteSchedule', Resource: 'arn:aws:scheduler:ap-northeast-1:452284481392:schedule/lyra-staging-20261003-google-auth/*' });
  const mutated = structuredClone(policy);
  mutated.Statement.find((s) => s.Sid === 'DeleteSchedulesOnlyInGoogleExpiryGroup').Action = 'scheduler:UpdateSchedule';
  assert.throws(() => assertPolicyScope(mutated), /GENERATED_POLICY_SCOPE_INVALID/);
});
