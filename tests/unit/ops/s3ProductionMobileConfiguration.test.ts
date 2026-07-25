import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type LifecycleRule = {
  ID?: unknown;
  Status?: unknown;
  Filter?: {
    Prefix?: unknown;
    Tag?: {
      Key?: unknown;
      Value?: unknown;
    };
  };
  Expiration?: { Days?: unknown };
  NoncurrentVersionExpiration?: { NoncurrentDays?: unknown };
  AbortIncompleteMultipartUpload?: { DaysAfterInitiation?: unknown };
};

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
}

describe('production mobile S3 configuration', () => {
  it('本番ライフサイクルは既存保護を維持して一時画像と削除予定画像を1日で失効する', async () => {
    const document = (await readJson(
      'ops/security/s3-images-lifecycle.production.json',
    )) as { Rules?: LifecycleRule[] };
    const rules = document.Rules ?? [];
    const byId = new Map(rules.map((rule) => [rule.ID, rule]));

    expect(rules).toHaveLength(4);
    expect(
      byId.get('abort-incomplete-multipart-uploads-after-1-day')
        ?.AbortIncompleteMultipartUpload?.DaysAfterInitiation,
    ).toBe(1);

    const temporary = byId.get(
      'expire-lyra-temporary-uploads-after-1-day',
    );
    expect(temporary?.Status).toBe('Enabled');
    expect(temporary?.Filter?.Prefix).toBe('tmp/');
    expect(temporary?.Expiration?.Days).toBe(1);
    expect(
      temporary?.NoncurrentVersionExpiration?.NoncurrentDays,
    ).toBe(1);

    const deletion = byId.get('expire-lyra-account-deletion-assets');
    expect(deletion?.Status).toBe('Enabled');
    expect(deletion?.Filter?.Tag).toEqual({
      Key: 'lyra-deletion-state',
      Value: 'pending',
    });
    expect(deletion?.Expiration?.Days).toBe(1);
    expect(deletion?.NoncurrentVersionExpiration?.NoncurrentDays).toBe(1);
    expect(deletion).not.toHaveProperty('AbortIncompleteMultipartUpload');

    const noncurrent = byId.get('manage-noncurrent-image-versions');
    expect(noncurrent?.Status).toBe('Enabled');
  });

  it('タグ条件のアカウント削除ルールに互換性のないmultipart処理を含めない', async () => {
    const rule = (await readJson(
      'ops/security/s3-account-deletion-lifecycle-rule.example.json',
    )) as LifecycleRule;

    expect(rule.Filter?.Tag).toEqual({
      Key: 'lyra-deletion-state',
      Value: 'pending',
    });
    expect(rule.Expiration?.Days).toBe(1);
    expect(rule.NoncurrentVersionExpiration?.NoncurrentDays).toBe(1);
    expect(rule).not.toHaveProperty('AbortIncompleteMultipartUpload');
  });

  it('presigned PUT CORSは固定本番originと必要最小限の操作だけを許可する', async () => {
    const document = (await readJson(
      'ops/security/s3-mobile-direct-upload-cors.production.json',
    )) as {
      CORSRules?: Array<{
        AllowedOrigins?: unknown;
        AllowedMethods?: unknown;
        AllowedHeaders?: unknown;
        ExposeHeaders?: unknown;
        MaxAgeSeconds?: unknown;
      }>;
    };

    expect(document.CORSRules).toEqual([
      {
        AllowedOrigins: ['https://app.lyra-editor.com'],
        AllowedMethods: ['PUT'],
        AllowedHeaders: [
          'Content-Type',
          'x-amz-server-side-encryption',
        ],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      },
    ]);
  });

  it('公開Mobile静的ファイルは専用prefixを対象distributionだけに公開する', async () => {
    const policy = (await readJson(
      'ops/security/s3-mobile-public-static-bucket-policy.production.json',
    )) as {
      Statement?: Array<{
        Effect?: unknown;
        Principal?: unknown;
        Action?: unknown;
        Resource?: unknown;
        Condition?: unknown;
      }>;
    };

    expect(policy.Statement).toEqual([
      {
        Sid: 'AllowLyraAppCloudFrontReadMobilePublicStatic',
        Effect: 'Allow',
        Principal: {
          Service: 'cloudfront.amazonaws.com',
        },
        Action: 's3:GetObject',
        Resource:
          'arn:aws:s3:::lyra-prod-images-452284481392/public/mobile/*',
        Condition: {
          StringEquals: {
            'AWS:SourceArn':
              'arn:aws:cloudfront::452284481392:distribution/E3B8V7G1NPTTMS',
          },
        },
      },
    ]);
  });

  it('CloudFront manifestは必要な公開パスだけを専用S3 originへ送る', async () => {
    const manifest = (await readJson(
      'ops/cloudfront/mobile-public-static.production.json',
    )) as {
      distributionId?: unknown;
      bucket?: unknown;
      prefix?: unknown;
      origin?: unknown;
      cachePolicyId?: unknown;
      responseHeadersPolicyId?: unknown;
      files?: unknown;
    };

    expect(manifest).toEqual({
      distributionId: 'E3B8V7G1NPTTMS',
      bucket: 'lyra-prod-images-452284481392',
      prefix: 'public/mobile',
      origin: {
        id: 'lyra-prod-mobile-public-static-origin',
        domainName:
          'lyra-prod-images-452284481392.s3.ap-northeast-1.amazonaws.com',
        originAccessControlId: 'E1O0E031GX28JO',
      },
      cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
      responseHeadersPolicyId:
        '67f7725c-6f97-4210-82d7-5512b31e9d03',
      files: [
        {
          source: 'apps/web/public/.well-known/assetlinks.json',
          key: 'public/mobile/.well-known/assetlinks.json',
          path: '/.well-known/assetlinks.json',
          contentType: 'application/json',
        },
        {
          source: 'apps/web/public/privacy.html',
          key: 'public/mobile/privacy.html',
          path: '/privacy.html',
          contentType: 'text/html; charset=utf-8',
        },
        {
          source: 'apps/web/public/terms.html',
          key: 'public/mobile/terms.html',
          path: '/terms.html',
          contentType: 'text/html; charset=utf-8',
        },
        {
          source: 'apps/web/public/support.html',
          key: 'public/mobile/support.html',
          path: '/support.html',
          contentType: 'text/html; charset=utf-8',
        },
        {
          source: 'apps/web/public/legal.css',
          key: 'public/mobile/legal.css',
          path: '/legal.css',
          contentType: 'text/css; charset=utf-8',
        },
      ],
    });
  });

  it('API task roleは削除対象画像のタグ操作と対象Cognito poolの削除だけを追加許可する', async () => {
    const policy = (await readJson(
      'ops/security/iam-api-runtime.production.json',
    )) as {
      Statement?: Array<{
        Sid?: unknown;
        Effect?: unknown;
        Action?: unknown;
        Resource?: unknown;
      }>;
    };
    const statements = new Map(
      (policy.Statement ?? []).map((statement) => [
        statement.Sid,
        statement,
      ]),
    );

    expect(statements.get('AccountDeletionAssetTagging')).toEqual({
      Sid: 'AccountDeletionAssetTagging',
      Effect: 'Allow',
      Action: ['s3:GetObjectTagging', 's3:PutObjectTagging'],
      Resource:
        'arn:aws:s3:::lyra-prod-images-452284481392/saved/*',
    });
    expect(statements.get('AccountDeletionIdentityRemoval')).toEqual({
      Sid: 'AccountDeletionIdentityRemoval',
      Effect: 'Allow',
      Action: [
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminDeleteUser',
      ],
      Resource:
        'arn:aws:cognito-idp:ap-northeast-1:452284481392:userpool/ap-northeast-1_wiZLzlGMM',
    });
  });
});
