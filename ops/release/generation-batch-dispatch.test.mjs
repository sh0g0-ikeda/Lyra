import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBatchDispatchPolicy, assertBatchDispatchPreflight } from './generation-batch-dispatch.mjs';

const workerRoleArn = 'arn:aws:iam::452284481392:role/lyra-prod-worker-task-role';
const queueArn = 'arn:aws:sqs:ap-northeast-1:452284481392:lyra-prod-generation';
const input = () => ({
  workerRoleArn, queueArn,
  runtimes: [{ name: 'api', batchesEnabled: true, cancellationEnabled: true }, { name: 'worker', batchesEnabled: true, cancellationEnabled: true }],
  simulation: { principalArn: workerRoleArn, results: [{ EvalActionName: 'sqs:SendMessage', EvalResourceName: queueArn, EvalDecision: 'allowed' }] },
});

test('ワーカーに対象キューへの送信だけを付与する', () => {
  assert.deepEqual(buildBatchDispatchPolicy({ workerRoleArn, queueArn }), {
    Version: '2012-10-17', Statement: [{ Sid: 'SendGenerationBatchChildren', Effect: 'Allow', Action: 'sqs:SendMessage', Resource: queueArn }],
  });
  assert.throws(() => buildBatchDispatchPolicy({ workerRoleArn, queueArn: '*' }));
  assert.throws(() => buildBatchDispatchPolicy({ workerRoleArn, queueArn: queueArn.replace('452284481392', '111111111111') }));
});

test('一括生成ONは両サービスの停止ONと実ワーカーの送信許可を要求する', () => {
  assert.doesNotThrow(() => assertBatchDispatchPreflight(input()));
  for (const decision of ['implicitDeny', 'explicitDeny']) {
    const invalid = input(); invalid.simulation.results[0].EvalDecision = decision;
    assert.throws(() => assertBatchDispatchPreflight(invalid), /WORKER_QUEUE_SEND_REQUIRED/u);
  }
  const wrongRole = input(); wrongRole.simulation.principalArn = workerRoleArn.replace('worker', 'api');
  assert.throws(() => assertBatchDispatchPreflight(wrongRole), /WORKER_ROLE_MISMATCH/u);
  const wrongQueue = input(); wrongQueue.simulation.results[0].EvalResourceName += '-other';
  assert.throws(() => assertBatchDispatchPreflight(wrongQueue), /WORKER_QUEUE_SEND_REQUIRED/u);
  const missing = input(); missing.runtimes[0].cancellationEnabled = false;
  assert.throws(() => assertBatchDispatchPreflight(missing), /BATCH_CANCELLATION_REQUIRED/u);
});

test('一括生成OFFの互換配備は送信許可と停止機能を追加要求しない', () => {
  const disabled = input(); disabled.runtimes = disabled.runtimes.map(runtime => ({ ...runtime, batchesEnabled: false, cancellationEnabled: false }));
  disabled.simulation = null;
  assert.doesNotThrow(() => assertBatchDispatchPreflight(disabled));
});
