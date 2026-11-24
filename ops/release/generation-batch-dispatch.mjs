import assert from 'node:assert/strict';

// The API enqueues the first child, but the generation worker enqueues later
// children. Validate that exact principal, not the API/deployer identity.
// This module only builds/validates evidence; it never mutates AWS resources.
function assertResourceScope({ workerRoleArn, queueArn }) {
  const role = /^arn:aws:iam::(\d{12}):role\/[\w+=,.@/-]+$/u.exec(workerRoleArn);
  const queue = /^arn:aws:sqs:([a-z]{2}(?:-[a-z]+)+-\d+):(\d{12}):[\w-]+(?:\.fifo)?$/u.exec(queueArn);
  assert.ok(role && queue, 'EXACT_WORKER_AND_QUEUE_REQUIRED');
  assert.equal(role[1], queue[2], 'WORKER_QUEUE_ACCOUNT_MISMATCH');
}

export function buildBatchDispatchPolicy(input) {
  assertResourceScope(input);
  return { Version: '2012-10-17', Statement: [{
    Sid: 'SendGenerationBatchChildren', Effect: 'Allow', Action: 'sqs:SendMessage', Resource: input.queueArn,
  }] };
}

// runtimes must contain resolved API/worker flags from the candidate runtime;
// simulation must come from IAM for workerRoleArn with the queue's region.
export function assertBatchDispatchPreflight(input) {
  assertResourceScope(input);
  assert.equal(input.runtimes.length, 2, 'API_AND_WORKER_REQUIRED');
  assert.deepEqual(input.runtimes.map(runtime => runtime.name).sort(), ['api', 'worker'], 'API_AND_WORKER_REQUIRED');
  for (const runtime of input.runtimes) {
    assert.equal(typeof runtime.batchesEnabled, 'boolean', 'RESOLVED_FLAGS_REQUIRED');
    if (runtime.batchesEnabled) assert.equal(runtime.cancellationEnabled, true, 'BATCH_CANCELLATION_REQUIRED');
  }
  if (!input.runtimes.some(runtime => runtime.batchesEnabled)) return;
  assert.equal(input.simulation?.principalArn, input.workerRoleArn, 'WORKER_ROLE_MISMATCH');
  const decisions = input.simulation.results.filter(result => result.EvalActionName === 'sqs:SendMessage' && result.EvalResourceName === input.queueArn);
  assert.equal(decisions.length, 1, 'WORKER_QUEUE_SEND_REQUIRED');
  assert.equal(decisions[0].EvalDecision, 'allowed', 'WORKER_QUEUE_SEND_REQUIRED');
}
