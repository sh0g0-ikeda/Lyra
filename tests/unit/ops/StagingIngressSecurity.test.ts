import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type Template = {
  Parameters: Record<string, { Type?: string }>;
  Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
};

const template = JSON.parse(
  readFileSync(resolve(process.cwd(), 'ops/staging/foundation.json'), 'utf8')
) as Template;

describe('staging ingress hardening', () => {
  it('CloudFront prefix list と origin verification header 以外から ALB target へ到達させない', () => {
    expect(template.Parameters.CloudFrontManagedPrefixListId?.Type).toBe('String');

    const ingress = template.Resources.AlbIngressHttps;
    expect(ingress?.Type).toBe('AWS::EC2::SecurityGroupIngress');
    expect(ingress?.Properties).toMatchObject({
      FromPort: 443,
      IpProtocol: 'tcp',
      SourcePrefixListId: { Ref: 'CloudFrontManagedPrefixListId' },
      ToPort: 443
    });
    expect(ingress?.Properties.CidrIp).toBeUndefined();

    const listener = template.Resources.HttpsListener;
    expect(listener?.Properties.DefaultActions).toEqual([
      {
        Type: 'fixed-response',
        FixedResponseConfig: {
          ContentType: 'text/plain',
          MessageBody: 'Forbidden',
          StatusCode: '403'
        }
      }
    ]);

    const rule = template.Resources.CloudFrontOriginListenerRule;
    expect(rule?.Type).toBe('AWS::ElasticLoadBalancingV2::ListenerRule');
    expect(rule?.Properties.Actions).toEqual([
      { Type: 'forward', TargetGroupArn: { Ref: 'ApiTargetGroup' } }
    ]);
    expect(rule?.Properties.Conditions).toEqual([
      {
        Field: 'http-header',
        HttpHeaderConfig: {
          HttpHeaderName: 'x-lyra-origin-verify',
          Values: [{ 'Fn::Sub': '{{resolve:secretsmanager:${OriginVerificationSecret}:SecretString:origin}}' }]
        }
      }
    ]);
  });
});
