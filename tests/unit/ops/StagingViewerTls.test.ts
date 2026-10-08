import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Template = {
  Outputs: Record<string, unknown>;
  Parameters: Record<string, { AllowedPattern?: string; Default?: string }>;
  Resources: Record<string, { Properties?: Record<string, unknown>; Type: string }>;
};

const template = JSON.parse(
  readFileSync(resolve(process.cwd(), 'ops/staging/foundation.json'), 'utf8'),
) as Template;

// Design: TLS viewer aliasing belongs only at CloudFront. The existing
// distribution domain remains the Cognito callback authority, so this change
// must not alter the ALB origin, native deep links, or OAuth return URLs.
describe('staging viewer TLS contract', () => {
  it('専用 staging viewer hostname と us-east-1 ACM を CloudFront にだけ結び付ける', () => {
    expect(template.Parameters.ViewerHostname).toMatchObject({
      Default: 'staging-20261003.lyra-editor.com',
      AllowedPattern: '^staging-[a-z0-9-]+\\.lyra-editor\\.com$',
    });
    expect(template.Parameters.ViewerCertificateArn?.AllowedPattern).toBe(
      '^arn:aws:acm:us-east-1:452284481392:certificate/[0-9a-f-]+$',
    );
    expect(template.Parameters.ViewerCertificateArn?.Default).toBeUndefined();

    const distribution = template.Resources.StagingDistribution?.Properties?.DistributionConfig as Record<string, unknown>;
    expect(distribution.Aliases).toEqual([{ Ref: 'ViewerHostname' }]);
    expect(distribution.ViewerCertificate).toEqual({
      AcmCertificateArn: { Ref: 'ViewerCertificateArn' },
      SslSupportMethod: 'sni-only',
      MinimumProtocolVersion: 'TLSv1.2_2021',
    });
    expect((distribution.ViewerCertificate as Record<string, unknown>).CloudFrontDefaultCertificate).toBeUndefined();
    expect((distribution.Origins as Array<Record<string, unknown>>)[0]?.CustomOriginConfig).toMatchObject({
      OriginProtocolPolicy: 'https-only',
      OriginSSLProtocols: ['TLSv1.2'],
    });

    for (const [name, type] of [['ViewerDnsARecord', 'A'], ['ViewerDnsAaaaRecord', 'AAAA']] as const) {
      const record = template.Resources[name];
      expect(record).toMatchObject({ Type: 'AWS::Route53::RecordSet' });
      expect(record.Properties).toMatchObject({
        HostedZoneId: { Ref: 'HostedZoneId' },
        Name: { Ref: 'ViewerHostname' },
        Type: type,
        AliasTarget: {
          DNSName: { 'Fn::GetAtt': ['StagingDistribution', 'DomainName'] },
          HostedZoneId: 'Z2FDTNDATAQYW2',
          EvaluateTargetHealth: false,
        },
      });
    }

    expect(template.Outputs.CloudFrontDomainName).toBeDefined();
    expect(template.Resources.NativeUserPoolClient?.Properties?.CallbackURLs).toEqual([
      'lyra-mobile-staging://auth/mobile/callback',
    ]);
    expect(template.Resources.WebUserPoolClient?.Properties?.CallbackURLs).toEqual([
      { 'Fn::Sub': 'https://${StagingDistribution.DomainName}/auth/callback' },
    ]);
  });
});
