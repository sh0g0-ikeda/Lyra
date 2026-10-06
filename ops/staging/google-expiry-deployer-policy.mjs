/* Spec §8/§10: pure, reviewable policy construction. No AWS calls or writes. */
export const STAGE = 'lyra-staging-20261003';
export const ACCOUNT = '452284481392';
export const REGION = 'ap-northeast-1';
const iam = `arn:aws:iam::${ACCOUNT}`;
const schedulerRole = `${iam}:role/${STAGE}-google-link-expiry-scheduler`;
const boundary = `${iam}:policy/${STAGE}-google-link-expiry-boundary`;
const scheduleGroup = `arn:aws:scheduler:${REGION}:${ACCOUNT}:schedule-group/${STAGE}-google-auth`;
const schedule = `arn:aws:scheduler:${REGION}:${ACCOUNT}:schedule/${STAGE}-google-auth/${STAGE}-google-link-expiry`;
const groupChildren = `arn:aws:scheduler:${REGION}:${ACCOUNT}:schedule/${STAGE}-google-auth/*`;
const dlq = `arn:aws:sqs:${REGION}:${ACCOUNT}:${STAGE}-google-link-expiry-dlq`;
const alarms = ['failure', 'at-limit', 'dlq'].map((suffix) => `arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:${STAGE}-google-link-expiry-${suffix}`);
const taskDefinition = `arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/${STAGE}-google-link-expiry:*`;
const roleTags = { 'aws:RequestTag/Environment': 'staging', 'aws:RequestTag/LyraStagingId': STAGE, 'aws:RequestTag/Owner': 'Lyra', 'aws:RequestTag/ExpiresAt': '2026-10-10' };
const allowedAllowResources = new Set([schedulerRole, boundary, scheduleGroup, schedule, dlq, taskDefinition, ...alarms, groupChildren]);

function fail(code) { throw new Error(code); }

export function validateCurrentPolicy(currentPolicy) {
  if (!currentPolicy || typeof currentPolicy !== 'object' || Array.isArray(currentPolicy) || !Array.isArray(currentPolicy.Statement)) fail('CURRENT_POLICY_INVALID');
  const deny = currentPolicy.Statement.find((statement) => statement?.Sid === 'DenyExistingProductionResources');
  if (!deny) fail('CURRENT_POLICY_DENY_MISSING');
  if (deny.Effect !== 'Deny' || deny.Action !== '*' || !Array.isArray(deny.Resource) || deny.Resource.length === 0 || deny.Resource.some((resource) => typeof resource !== 'string' || !resource)) fail('CURRENT_POLICY_DENY_INVALID');
  return structuredClone(deny);
}

function allow(Sid, Action, Resource, Condition) { return Condition === undefined ? { Sid, Effect: 'Allow', Action, Resource } : { Sid, Effect: 'Allow', Action, Resource, Condition }; }

export function buildGoogleExpiryDeployerPolicy(currentPolicy) {
  const deny = validateCurrentPolicy(currentPolicy);
  const policy = { Version: '2012-10-17', Statement: [
    deny,
    allow('CreateGoogleExpirySchedulerRole', 'iam:CreateRole', schedulerRole, { ArnEquals: { 'iam:PermissionsBoundary': boundary }, StringEquals: roleTags }),
    allow('ManageGoogleExpirySchedulerRole', ['iam:GetRole', 'iam:ListRolePolicies', 'iam:GetRolePolicy', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:TagRole', 'iam:UntagRole', 'iam:DeleteRole', 'iam:ListAttachedRolePolicies', 'iam:ListRoleTags'], schedulerRole),
    allow('ManageGoogleExpiryBoundary', ['iam:CreatePolicy', 'iam:GetPolicy', 'iam:GetPolicyVersion', 'iam:ListPolicyVersions', 'iam:CreatePolicyVersion', 'iam:SetDefaultPolicyVersion', 'iam:DeletePolicyVersion', 'iam:DeletePolicy'], boundary),
    allow('PassGoogleExpirySchedulerRole', 'iam:PassRole', schedulerRole, { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } }),
    allow('ManageGoogleExpiryScheduleGroup', ['scheduler:CreateScheduleGroup', 'scheduler:GetScheduleGroup', 'scheduler:DeleteScheduleGroup', 'scheduler:ListTagsForResource', 'scheduler:TagResource', 'scheduler:UntagResource'], scheduleGroup),
    allow('ManageGoogleExpirySchedule', ['scheduler:CreateSchedule', 'scheduler:GetSchedule', 'scheduler:UpdateSchedule', 'scheduler:DeleteSchedule'], schedule),
    allow('DeleteSchedulesOnlyInGoogleExpiryGroup', 'scheduler:DeleteSchedule', groupChildren),
    allow('ManageGoogleExpiryDlq', ['sqs:CreateQueue', 'sqs:GetQueueAttributes', 'sqs:SetQueueAttributes', 'sqs:DeleteQueue', 'sqs:TagQueue', 'sqs:ListQueueTags', 'sqs:UntagQueue'], dlq),
    allow('ManageGoogleExpiryAlarms', ['cloudwatch:PutMetricAlarm', 'cloudwatch:DeleteAlarms', 'cloudwatch:DescribeAlarms', 'cloudwatch:TagResource', 'cloudwatch:ListTagsForResource', 'cloudwatch:UntagResource'], alarms),
    allow('ReadAndDeregisterGoogleExpiryTaskDefinition', ['ecs:DescribeTaskDefinition', 'ecs:DeregisterTaskDefinition'], taskDefinition),
  ] };
  assertPolicyScope(policy);
  return policy;
}

export function assertPolicyScope(policy) {
  for (const statement of policy.Statement ?? []) {
    if (statement.Effect !== 'Allow') continue;
    const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
    if (resources.some((resource) => typeof resource !== 'string' || !allowedAllowResources.has(resource))) fail('GENERATED_POLICY_SCOPE_INVALID');
    if (resources.includes(groupChildren) && (statement.Action !== 'scheduler:DeleteSchedule' || resources.length !== 1)) fail('GENERATED_POLICY_SCOPE_INVALID');
  }
  const createRole = policy.Statement?.find((statement) => statement.Sid === 'CreateGoogleExpirySchedulerRole');
  const passRole = policy.Statement?.find((statement) => statement.Sid === 'PassGoogleExpirySchedulerRole');
  if (!createRole || createRole.Resource !== schedulerRole || JSON.stringify(createRole.Condition) !== JSON.stringify({ ArnEquals: { 'iam:PermissionsBoundary': boundary }, StringEquals: roleTags })) fail('GENERATED_POLICY_SCOPE_INVALID');
  if (!passRole || passRole.Resource !== schedulerRole || JSON.stringify(passRole.Condition) !== JSON.stringify({ StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } })) fail('GENERATED_POLICY_SCOPE_INVALID');
  return true;
}
