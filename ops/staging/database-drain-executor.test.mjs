import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const x = JSON.parse(readFileSync(new URL('./database-drain-executor.json', import.meta.url)));

/**
 * Design brief — the normal contract remains reserved concurrency 1. The
 * shared unreserved pool is a temporary, explicit QA exception for the exact
 * staging account in Tokyo because account quota 10 must leave 10 unreserved.
 * Initial setup keeps Google OFF, the reader absent, schedules disabled, and
 * invokes nothing. Runtime QA permits one manual invocation only, with retry 0,
 * parallelism 0, reader connection limit 1, and schedules still disabled.
 * While quota headroom is unverified, rollback must keep the exception true or
 * delete the stack; changing it to false would retry the rejected reservation.
 */

test('proof lambda is private bounded and credential parameter is NoEcho', () => {
  assert.equal(x.Parameters.DrainPassword.NoEcho, true);
  assert.deepEqual(x.Resources.ProofFunction.Properties.ReservedConcurrentExecutions, {
    'Fn::If': ['UseBoundedSharedConcurrencyQa', { Ref: 'AWS::NoValue' }, 1],
  });
  assert.deepEqual(x.Resources.ProofFunction.Properties.VpcConfig.SubnetIds, [{ Ref: 'PrivateSubnetAId' }, { Ref: 'PrivateSubnetCId' }]);
  assert.equal(x.Resources.ProofFunction.Properties.Environment.Variables.RDS_CA_FILE, '/var/task/rds-ca-rsa2048-g1.pem');
  assert.equal(x.Resources.ProofSecurityGroup.Properties.SecurityGroupEgress.length, 1);
  assert.equal(x.Resources.ProofSecurityGroup.Properties.SecurityGroupEgress[0].ToPort, 5432);
  assert.equal(x.Resources.ProofFunction.Properties.Environment.Variables.AWS_REGION, undefined);
  assert.equal(x.Resources.ProofDbEgress, undefined);
  assert.equal(x.Resources.ProofRole.Properties.RoleName, 'lyra-staging-20261003-database-drain-proof');
  assert.equal(x.Outputs.QualifiedFunctionArn.Value.Ref, 'ProofVersion');
  assert.equal(x.Resources.ProofVersion.Type, 'AWS::Lambda::Version');
});

test('shared concurrency QA is default OFF and exact staging scope only', () => {
  assert.deepEqual(x.Parameters.BoundedSharedConcurrencyQa, {
    Type: 'String',
    Default: 'false',
    AllowedValues: ['false', 'true'],
    Description: 'Explicit exact-stage QA exception for the Lambda shared concurrency pool',
  });
  assert.deepEqual(x.Conditions.UseBoundedSharedConcurrencyQa, {
    'Fn::And': [
      { 'Fn::Equals': [{ Ref: 'BoundedSharedConcurrencyQa' }, 'true'] },
      { 'Fn::Equals': [{ Ref: 'AWS::AccountId' }, '452284481392'] },
      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-northeast-1'] },
    ],
  });
  assert.deepEqual(x.Rules.BoundedSharedConcurrencyQaRequiresExactScope, {
    RuleCondition: { 'Fn::Equals': [{ Ref: 'BoundedSharedConcurrencyQa' }, 'true'] },
    Assertions: [
      { Assert: { 'Fn::Equals': [{ Ref: 'AWS::AccountId' }, '452284481392'] }, AssertDescription: 'Shared concurrency QA is restricted to account 452284481392' },
      { Assert: { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-northeast-1'] }, AssertDescription: 'Shared concurrency QA is restricted to ap-northeast-1' },
    ],
  });
});

test('shared concurrency QA adds no event source, permission, or scheduler', () => {
  const forbidden = new Set(['AWS::Lambda::Permission', 'AWS::Lambda::EventSourceMapping', 'AWS::Events::Rule', 'AWS::Scheduler::Schedule']);
  assert.equal(Object.values(x.Resources).some(({ Type }) => forbidden.has(Type)), false);
  assert.equal(Object.keys(x.Resources).length, 6);
});
