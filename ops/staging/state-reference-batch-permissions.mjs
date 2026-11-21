import assert from 'node:assert/strict';

// Auto-confirm now runs in the generation worker. Its identity policy AND the
// separate image-create role's trust must permit that exact staging principal.
// Build a reviewable patch only: this module makes no AWS requests and leaves
// storage permissions, conditional-write guards and permissions boundaries intact.
export function buildStateReferenceBatchPermissions(input) {
  const { accountId, resourcePrefix } = input;
  assert.match(accountId, /^\d{12}$/u);
  assert.match(resourcePrefix, /^lyra-staging-\d{8}$/u);
  const arn = suffix => `arn:aws:iam::${accountId}:role/${resourcePrefix}-${suffix}`;
  const workerPolicy = structuredClone(input.workerPolicy);
  const imageCreateTrust = structuredClone(input.imageCreateTrust);
  assert.equal(workerPolicy.Version, '2012-10-17');
  assert.equal(imageCreateTrust.Version, '2012-10-17');
  const roleStatements = workerPolicy.Statement.filter(statement => [
    'AssumeExactStageStateV2RecoveryRole', 'AssumeExactStageStateV2Roles',
  ].includes(statement.Sid));
  assert.equal(roleStatements.length, 1, 'Expected one exact staging state-role grant');
  const grant = roleStatements[0];
  const resources = grant.Sid === 'AssumeExactStageStateV2RecoveryRole'
    ? arn('state-v2-recovery')
    : [arn('state-v2-image-create'), arn('state-v2-recovery')];
  assert.deepEqual(grant, { Sid: grant.Sid, Effect: 'Allow', Action: 'sts:AssumeRole', Resource: resources });
  grant.Sid = 'AssumeExactStageStateV2Roles';
  grant.Resource = [arn('state-v2-image-create'), arn('state-v2-recovery')];

  assert.equal(imageCreateTrust.Statement.length, 1, 'Unexpected image-create trust statement');
  const trust = imageCreateTrust.Statement[0];
  assert.ok(['TrustExactStageApiTaskRole', 'TrustExactStageStateReferenceCallers'].includes(trust.Sid));
  const principal = trust.Sid === 'TrustExactStageApiTaskRole'
    ? arn('api-task') : [arn('api-task'), arn('worker-task')];
  assert.deepEqual(trust, {
    Sid: trust.Sid, Effect: 'Allow', Principal: { AWS: principal }, Action: 'sts:AssumeRole',
  });
  trust.Sid = 'TrustExactStageStateReferenceCallers';
  trust.Principal.AWS = [arn('api-task'), arn('worker-task')];
  return { workerPolicy, imageCreateTrust };
}
