import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStateReferenceBatchPermissions, buildStateReferenceRecoveryReadPolicy } from './state-reference-batch-permissions.mjs';

const accountId = '123456789012';
const resourcePrefix = 'lyra-staging-20261003';
const arn = suffix => `arn:aws:iam::${accountId}:role/${resourcePrefix}-${suffix}`;
const fixture = () => ({
  accountId, resourcePrefix,
  workerPolicy: { Version: '2012-10-17', Statement: [
    { Sid: 'Unrelated', Effect: 'Deny', Action: 'iam:*', Resource: '*' },
    { Sid: 'AssumeExactStageStateV2RecoveryRole', Effect: 'Allow', Action: 'sts:AssumeRole', Resource: arn('state-v2-recovery') },
  ] },
  imageCreateTrust: { Version: '2012-10-17', Statement: [{
    Sid: 'TrustExactStageApiTaskRole', Effect: 'Allow',
    Principal: { AWS: arn('api-task') }, Action: 'sts:AssumeRole',
  }] },
});

test('同じ検証環境の作成roleとworker principalだけを追加し他の権限を維持する', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = buildStateReferenceBatchPermissions(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.workerPolicy.Statement[0], input.workerPolicy.Statement[0]);
  assert.deepEqual(result.workerPolicy.Statement[1], {
    Sid: 'AssumeExactStageStateV2Roles', Effect: 'Allow', Action: 'sts:AssumeRole',
    Resource: [arn('state-v2-image-create'), arn('state-v2-recovery')],
  });
  assert.deepEqual(result.imageCreateTrust.Statement[0].Principal, {
    AWS: [arn('api-task'), arn('worker-task')],
  });
  assert.deepEqual(buildStateReferenceBatchPermissions({ ...input, ...result }), result);
});

test('本番prefixや他環境のroleおよび想定外のtrust拡大を拒否する', () => {
  assert.throws(() => buildStateReferenceBatchPermissions({ ...fixture(), resourcePrefix: 'lyra-prod' }));
  const wrongRole = fixture();
  wrongRole.workerPolicy.Statement[1].Resource = 'arn:aws:iam::123456789012:role/lyra-prod-worker';
  assert.throws(() => buildStateReferenceBatchPermissions(wrongRole));
  const broadTrust = fixture();
  broadTrust.imageCreateTrust.Statement[0].Principal.AWS = '*';
  assert.throws(() => buildStateReferenceBatchPermissions(broadTrust));
  const extraTrust = fixture();
  extraTrust.imageCreateTrust.Statement.push({ Effect: 'Allow', Principal: '*', Action: 'sts:AssumeRole' });
  assert.throws(() => buildStateReferenceBatchPermissions(extraTrust));
});

test('存在しない画像を404で識別するListBucketだけを同じ検証bucketへ許可する', () => {
  const bucketName = `${resourcePrefix}-images-${accountId}`;
  const recoveryPolicy = { Version: '2012-10-17', Statement: [{
    Sid: 'ExistingObjectAccess', Effect: 'Allow', Action: 's3:GetObject',
    Resource: `arn:aws:s3:::${bucketName}/state-reference-v2/*`,
  }] };
  const input = { accountId, resourcePrefix, bucketName, recoveryPolicy };
  const output = buildStateReferenceRecoveryReadPolicy(input);
  assert.equal(recoveryPolicy.Statement.length, 1);
  assert.deepEqual(output.Statement[0], recoveryPolicy.Statement[0]);
  assert.deepEqual(output.Statement[1], { Sid: 'ObserveMissingStateReferenceObjects', Effect: 'Allow',
    Action: 's3:ListBucket', Resource: `arn:aws:s3:::${bucketName}` });
  assert.deepEqual(buildStateReferenceRecoveryReadPolicy({ ...input, recoveryPolicy: output }), output);
  assert.throws(() => buildStateReferenceRecoveryReadPolicy({ ...input, bucketName: 'lyra-prod-images' }));
});
