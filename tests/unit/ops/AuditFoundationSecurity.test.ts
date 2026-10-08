import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Resource = {
  Condition?: string;
  Properties?: Record<string, unknown>;
  Type: string;
};

type Template = {
  Resources: Record<string, Resource>;
};

const template = JSON.parse(
  readFileSync(resolve(process.cwd(), 'ops/security/audit-foundation.json'), 'utf8'),
) as Template;

// Design: keep one multi-region management trail, but alert when that trail's
// retained bucket is weakened. The rule exists only with its bucket so an
// alert-only secondary region never references a missing resource.
describe('audit foundation security contract', () => {
  it('KMS 管理イベントを含む trail と audit bucket 改変 alert を維持する', () => {
    const trail = template.Resources.AuditTrail;
    expect(trail.Properties).toMatchObject({
      IsLogging: true,
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
      EnableLogFileValidation: true,
    });
    const selectors = trail.Properties?.EventSelectors as Array<Record<string, unknown>>;
    expect(selectors).toEqual([
      { ReadWriteType: 'All', IncludeManagementEvents: true },
    ]);

    const alert = template.Resources.AuditBucketTamperAlert;
    expect(alert).toMatchObject({
      Type: 'AWS::Events::Rule',
      Condition: 'CreateTrail',
    });
    expect(alert.Properties?.EventPattern).toEqual({
      source: ['aws.s3'],
      'detail-type': ['AWS API Call via CloudTrail'],
      detail: {
        eventSource: ['s3.amazonaws.com'],
        eventName: [
          'PutBucketPolicy',
          'DeleteBucketPolicy',
          'PutBucketLifecycleConfiguration',
          'PutBucketVersioning',
          'PutBucketEncryption',
          'DeleteBucketEncryption',
          'PutPublicAccessBlock',
          'DeletePublicAccessBlock',
          'DeleteBucket',
          'PutBucketOwnershipControls',
          'DeleteBucketOwnershipControls',
          'PutBucketAcl',
        ],
        requestParameters: { bucketName: [{ Ref: 'AuditBucket' }] },
      },
    });
    expect(alert.Properties?.Targets).toEqual([
      { Id: 'SecurityAlerts', Arn: { Ref: 'SecurityAlerts' } },
    ]);
  });

  it('SNS publish policy を EventBridge service principal の無条件許可に保ち、購読を作らない', () => {
    const policy = template.Resources.AlertTopicPolicy;
    const statement = ((policy.Properties?.PolicyDocument as { Statement: unknown[] }).Statement[0]) as Record<string, unknown>;
    expect(statement).toEqual({
      Effect: 'Allow',
      Principal: { Service: 'events.amazonaws.com' },
      Action: 'sns:Publish',
      Resource: { Ref: 'SecurityAlerts' },
    });
    expect(statement.Condition).toBeUndefined();
    expect(Object.values(template.Resources).some((resource) => resource.Type === 'AWS::SNS::Subscription')).toBe(false);
  });

  it('root activity alert だけが CloudTrail read-only 管理イベントを含める State になる', () => {
    // ENABLED excludes read-only CloudTrail management events; root actions must
    // retain them, while the other rules keep their existing event volume scope.
    expect(template.Resources.RootActivityAlert.Properties?.State).toBe(
      'ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS',
    );
    expect(template.Resources.AuditConfigurationAlert.Properties?.State).toBe('ENABLED');
    expect(template.Resources.AuditBucketTamperAlert.Properties?.State).toBe('ENABLED');
    expect(template.Resources.GuardDutyFindingAlert.Properties?.State).toBe('ENABLED');
  });
});
