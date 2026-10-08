import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type PolicyStatement = {
  Sid: string;
  Effect: string;
  Action: string;
  Resource: string;
  Condition: Record<string, Record<string, string | string[]>>;
};

type PolicyDocument = {
  Statement: PolicyStatement[];
};

const policy = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'ops/staging/viewer-dns-cfn-role-policy.json'),
    'utf8',
  ),
) as PolicyDocument;

describe('staging viewer DNS CloudFormation role policy', () => {
  it('Route 53 request context keys are required before its narrowly scoped record allow applies', () => {
    // ForAllValues alone accepts a missing request context key; Null=false keeps every
    // Route 53 constraint present while retaining only the staging A/AAAA change scope.
    expect(policy.Statement).toEqual([
      {
        Sid: 'ManageOnlyExistingStagingViewerRecords',
        Effect: 'Allow',
        Action: 'route53:ChangeResourceRecordSets',
        Resource: 'arn:aws:route53:::hostedzone/Z06854141YIQEBHNYPPXP',
        Condition: {
          Null: {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': 'false',
            'route53:ChangeResourceRecordSetsRecordTypes': 'false',
            'route53:ChangeResourceRecordSetsActions': 'false',
          },
          'ForAllValues:StringEquals': {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
              'staging-20261003.lyra-editor.com',
            ],
            'route53:ChangeResourceRecordSetsRecordTypes': ['A', 'AAAA'],
            'route53:ChangeResourceRecordSetsActions': [
              'CREATE',
              'UPSERT',
              'DELETE',
            ],
          },
        },
      },
    ]);
  });
});
