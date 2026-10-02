import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import {
  evaluateReleaseCompatibility,
  type ReleaseCompatibilityRuntime,
} from '../../../src/domain/release/ReleaseCompatibilityPolicy.js';
import { parseEnv } from '../../../src/lib/env.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import {
  checkReleaseCompatibility,
  parseReleaseCompatibilityArgs,
  runtimeFromEnv,
} from '../../../scripts/checkReleaseCompatibility.js';

function runtime(overrides: Partial<ReleaseCompatibilityRuntime> = {}): ReleaseCompatibilityRuntime {
  return {
    generationQuotesEnabled: false,
    generationEnabled: true,
    pageGenerationEnabled: true,
    entityGenerationEnabled: true,
    entityImportAnalysisEnabled: true,
    entityReferenceDirectUploadEnabled: true,
    openAiApiKeyConfigured: true,
    openAiImageModel: 'gpt-image-2',
    generationQueueConfigured: true,
    imageStorageConfigured: true,
    awsRegionConfigured: true,
    localImageFallbackEnabled: false,
    webImageDeliveryClientIds: [],
    stateReferenceCopyV2AdmissionEnabled: false,
    stateReferenceCopyV2StorageContractAttested: false,
    ...overrides,
  };
}

function codes(input: Parameters<typeof evaluateReleaseCompatibility>[0]): string[] {
  return evaluateReleaseCompatibility(input).violations.map((violation) => violation.code);
}

describe('release compatibility policy', () => {
  it('backend-onlyではquote OFFとv2 journal導入前の未設定を許可する', () => {
    expect(evaluateReleaseCompatibility({
      profile: 'backend-only',
      journalPresent: false,
      mobileClientIds: [],
      runtime: runtime(),
    })).toMatchObject({ ok: true, violations: [] });
  });

  it('new-mobileでは既存有料page/entity/importと共通実行基盤を要求する', () => {
    const base = runtime({ generationQuotesEnabled: true });
    expect(evaluateReleaseCompatibility({
      profile: 'new-mobile', journalPresent: false, mobileClientIds: [], runtime: base,
    }).ok).toBe(true);

    const cases: Array<[Partial<ReleaseCompatibilityRuntime>, string]> = [
      [{ generationQuotesEnabled: false }, 'MOBILE_QUOTES_REQUIRED'],
      [{ generationEnabled: false }, 'MOBILE_GENERATION_REQUIRED'],
      [{ pageGenerationEnabled: false }, 'MOBILE_PAGE_GENERATION_REQUIRED'],
      [{ entityGenerationEnabled: false }, 'MOBILE_ENTITY_GENERATION_REQUIRED'],
      [{ entityImportAnalysisEnabled: false }, 'MOBILE_ENTITY_IMPORT_REQUIRED'],
      [{ entityReferenceDirectUploadEnabled: false }, 'MOBILE_ENTITY_UPLOAD_REQUIRED'],
      [{ openAiApiKeyConfigured: false }, 'MOBILE_PROVIDER_REQUIRED'],
      [{ openAiImageModel: 'hy4-preview' }, 'MOBILE_IMAGE_MODEL_UNSUPPORTED'],
      [{ generationQueueConfigured: false }, 'MOBILE_DURABLE_QUEUE_REQUIRED'],
      [{ imageStorageConfigured: false }, 'MOBILE_IMAGE_STORAGE_REQUIRED'],
      [{ awsRegionConfigured: false }, 'MOBILE_AWS_REGION_REQUIRED'],
      [{ localImageFallbackEnabled: true }, 'MOBILE_LOCAL_IMAGE_FALLBACK_FORBIDDEN'],
    ];
    for (const [override, code] of cases) {
      expect(codes({
        profile: 'new-mobile', journalPresent: false, mobileClientIds: [],
        runtime: runtime({ ...base, ...override }),
      })).toContain(code);
    }
  });

  it('new-mobileでも段階機能のstate preview受付OFFを許可する', () => {
    expect(evaluateReleaseCompatibility({
      profile: 'new-mobile', journalPresent: false, mobileClientIds: [],
      runtime: runtime({
        generationQuotesEnabled: true,
        stateReferenceCopyV2AdmissionEnabled: false,
      }),
    }).ok).toBe(true);
  });

  it('Web配信allowlistがある場合は明示Mobile inventoryを要求し共有clientを拒否する', () => {
    expect(codes({
      profile: 'backend-only', journalPresent: false, mobileClientIds: [],
      runtime: runtime({ webImageDeliveryClientIds: ['dedicated-web'] }),
    })).toContain('WEB_MOBILE_CLIENT_INVENTORY_REQUIRED');

    expect(codes({
      profile: 'backend-only', journalPresent: false, mobileClientIds: ['old-mobile', 'new-mobile'],
      runtime: runtime({ webImageDeliveryClientIds: ['dedicated-web', 'old-mobile'] }),
    })).toContain('WEB_IMAGE_CLIENT_SHARED_WITH_MOBILE');

    expect(evaluateReleaseCompatibility({
      profile: 'backend-only', journalPresent: false, mobileClientIds: ['old-mobile', 'new-mobile'],
      runtime: runtime({ webImageDeliveryClientIds: ['dedicated-web'] }),
    }).ok).toBe(true);
  });

  it('v2 journalがあればadmission OFFでも完全で分離されたrecovery設定を要求する', () => {
    expect(codes({
      profile: 'backend-only', journalPresent: true, mobileClientIds: [], runtime: runtime(),
    })).toContain('STATE_RECOVERY_CONFIG_REQUIRED');

    const configured = runtime({
      stateReferenceCopyV2StorageContractAttested: true,
      stateReferenceCopyV2ImageRoleArn: 'arn:aws:iam::123456789012:role/lyra-state-image',
      stateReferenceCopyV2RecoveryRoleArn: 'arn:aws:iam::123456789012:role/lyra-state-recovery',
      stateReferenceCopyV2ExpectedBucketOwner: '123456789012',
      stateReferenceCopyV2VersioningHistory: 'versioned',
      stateReferenceCopyV2BucketName: 'lyra-images',
      stateReferenceCopyV2Region: 'ap-northeast-1',
    });
    expect(evaluateReleaseCompatibility({
      profile: 'backend-only', journalPresent: true, mobileClientIds: [], runtime: configured,
    }).ok).toBe(true);
    expect(codes({
      profile: 'backend-only', journalPresent: true, mobileClientIds: [],
      runtime: { ...configured, stateReferenceCopyV2RecoveryRoleArn: configured.stateReferenceCopyV2ImageRoleArn },
    })).toContain('STATE_RECOVERY_ROLES_MUST_BE_DISTINCT');
  });

  it('journalがなくても部分的またはadmission ONのv2設定を拒否する', () => {
    expect(codes({
      profile: 'backend-only', journalPresent: false, mobileClientIds: [],
      runtime: runtime({ stateReferenceCopyV2StorageContractAttested: true }),
    })).toContain('STATE_RECOVERY_CONFIG_INCOMPLETE');
    expect(codes({
      profile: 'backend-only', journalPresent: false, mobileClientIds: [],
      runtime: runtime({ stateReferenceCopyV2AdmissionEnabled: true }),
    })).toContain('STATE_RECOVERY_CONFIG_REQUIRED');
  });

  it('通常のAWS画像設定だけではv2 opt-inとせずCognito一般allowlistを判定材料にしない', () => {
    const mapped = runtimeFromEnv(parseEnv({
      GENERATION_ENABLED: 'true',
      PAGE_GENERATION_ENABLED: 'true',
      ENTITY_GENERATION_ENABLED: 'true',
      ENTITY_IMPORT_ANALYSIS_ENABLED: 'true',
      ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED: 'true',
      OPENAI_API_KEY: 'configured',
      OPENAI_IMAGE_MODEL: 'gpt-image-2',
      AWS_REGION: 'ap-northeast-1',
      SQS_QUEUE_URL_GENERATION: 'https://sqs.example.invalid/queue',
      S3_BUCKET_IMAGES: 'lyra-images',
      GENERATION_QUOTES_ENABLED: 'true',
      WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS: ' dedicated-web, dedicated-web ',
      COGNITO_ALLOWED_CLIENT_IDS: 'old-mobile,new-mobile,dedicated-web',
    }));
    expect(mapped.webImageDeliveryClientIds).toEqual(['dedicated-web']);
    expect(evaluateReleaseCompatibility({
      profile: 'new-mobile', journalPresent: false,
      mobileClientIds: ['old-mobile', 'new-mobile'], runtime: mapped,
    }).ok).toBe(true);
  });
});

describe('release compatibility CLI arguments', () => {
  it('profileと旧新Mobile client inventoryを明示的に読む', () => {
    expect(parseReleaseCompatibilityArgs([
      '--profile', 'new-mobile',
      '--mobile-client-id', 'old-mobile',
      '--mobile-client-id', 'new-mobile',
    ])).toEqual({ profile: 'new-mobile', mobileClientIds: ['old-mobile', 'new-mobile'] });
  });

  it('profile未指定、不明profile、不明引数を拒否する', () => {
    expect(() => parseReleaseCompatibilityArgs([])).toThrow('release profile');
    expect(() => parseReleaseCompatibilityArgs(['--profile', 'unknown'])).toThrow('release profile');
    expect(() => parseReleaseCompatibilityArgs(['--profile', 'backend-only', '--unexpected'])).toThrow('release argument');
  });
});

describe('release compatibility database result validation', () => {
  it.each([
    ['欠落', []],
    ['非数値', [{ count: 'not-a-count' }]],
    ['負数', [{ count: -1 }]],
    ['小数', [{ count: 0.5 }]],
    ['無限大', [{ count: Number.POSITIVE_INFINITY }]],
    ['安全整数上限超過', [{ count: Number.MAX_SAFE_INTEGER + 1 }]],
    ['非正規整数文字列', [{ count: '01' }]],
    ['安全整数上限超過文字列', [{ count: '9007199254740992' }]],
  ] as const)('migration history countが%sならfail-closedにする', async (_name, historyRows) => {
    await expect(checkReleaseCompatibility(databaseWithResults(historyRows, [{ present: false }]), {
      profile: 'backend-only', mobileClientIds: [], runtime: runtime(),
    })).rejects.toThrow('Release compatibility database result is invalid');
  });

  it('正規の非負整数文字列countは安全整数として受け入れる', async () => {
    await expect(checkReleaseCompatibility(databaseWithResults([{ count: '1' }], []), {
      profile: 'backend-only', mobileClientIds: [], runtime: runtime(),
    })).resolves.toMatchObject({
      ok: false,
      journalPresent: null,
      violations: [{ category: 'database', code: 'SCHEMA_HISTORY_MISMATCH', count: 1 }],
    });
  });

  it.each([
    ['欠落', []],
    ['boolean以外', [{ present: 'false' }]],
  ] as const)('journal存在結果が%sならfail-closedにする', async (_name, journalRows) => {
    await expect(checkReleaseCompatibility(databaseWithResults([{ count: 0 }], journalRows), {
      profile: 'backend-only', mobileClientIds: [], runtime: runtime(),
    })).rejects.toThrow('Release compatibility database result is invalid');
  });
});

function databaseWithResults(
  historyRows: readonly Record<string, unknown>[],
  journalRows: readonly Record<string, unknown>[],
): DatabaseClient & TransactionRunner {
  return {
    query: async <T extends QueryResultRow>(): Promise<QueryResult<T>> => queryResult<T>([]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => work({
      query: async <Row extends QueryResultRow>(sql: string): Promise<QueryResult<Row>> => {
        if (/^\s*SET\b/u.test(sql)) return queryResult<Row>([]);
        if (sql.includes('differences')) return queryResult<Row>(historyRows as Row[]);
        if (sql.includes('SELECT EXISTS (SELECT 1 FROM state_reference_copy_attempts)')) {
          return queryResult<Row>(journalRows as Row[]);
        }
        throw new Error('Unexpected query after malformed release database result');
      },
    }),
  };
}

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return { rows, rowCount: rows.length, command: 'SELECT', fields: [], oid: 0 };
}
