import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../../../src/lib/env.js';
import {
  createFencedStateReferenceRuntime, createConfiguredFencedStateReferenceStorage,
  resolveFencedStateReferenceConfig,
} from '../../../../src/infrastructure/state/FencedStateReferenceRuntime.js';
import type { FencedStateReferenceRepository } from '../../../../src/repositories/FencedStateReferenceRepository.js';

const settings = {
  AWS_REGION: 'ap-northeast-1', S3_BUCKET_IMAGES: 'synthetic-local-only',
  STATE_REFERENCE_COPY_V2_IMAGE_ROLE_ARN: 'arn:aws:iam::123456789012:role/synthetic-image',
  STATE_REFERENCE_COPY_V2_RECOVERY_ROLE_ARN: 'arn:aws:iam::123456789012:role/synthetic-recovery',
  STATE_REFERENCE_COPY_V2_EXPECTED_BUCKET_OWNER: '123456789012',
  STATE_REFERENCE_COPY_V2_VERSIONING_HISTORY: 'never-versioned',
  STATE_REFERENCE_COPY_V2_STORAGE_CONTRACT_ATTESTED: 'true',
};
const database = { query: vi.fn(), transaction: vi.fn() };

describe('fenced state reference runtime configuration', () => {
  it('defaults admission OFF and constructs no storage clients when unconfigured', () => {
    const environment = parseEnv({});
    const storageFactory = vi.fn();
    expect(environment.STATE_REFERENCE_COPY_V2_ADMISSION_ENABLED).toBe(false);
    expect(resolveFencedStateReferenceConfig(environment)).toBeNull();
    const runtime = createFencedStateReferenceRuntime(environment, database, { storageFactory });
    expect(runtime.tryConfirmReference).toBeTypeOf('function');
    expect(runtime.fencePersonalReferences).toBeTypeOf('function');
    expect(storageFactory).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });

  it('rejects an enabled or partial contract before constructing any client', () => {
    const storageFactory = vi.fn();
    expect(() => createFencedStateReferenceRuntime(parseEnv({
      STATE_REFERENCE_COPY_V2_ADMISSION_ENABLED: 'true',
    }), database, { storageFactory })).toThrow('State reference v2');
    for (const key of Object.keys(settings)) {
      const incomplete: NodeJS.ProcessEnv = { ...settings };
      delete incomplete[key];
      expect(() => createFencedStateReferenceRuntime(parseEnv(incomplete), database, { storageFactory })).toThrow();
    }
    expect(storageFactory).not.toHaveBeenCalled();
  });

  it('rejects false attestations, shared roles, malformed owners and invalid flags', () => {
    for (const overrides of [
      { STATE_REFERENCE_COPY_V2_STORAGE_CONTRACT_ATTESTED: 'false' },
      { STATE_REFERENCE_COPY_V2_RECOVERY_ROLE_ARN: settings.STATE_REFERENCE_COPY_V2_IMAGE_ROLE_ARN },
      { STATE_REFERENCE_COPY_V2_EXPECTED_BUCKET_OWNER: 'not-an-account' },
      { STATE_REFERENCE_COPY_V2_VERSIONING_HISTORY: 'unknown' },
      { STATE_REFERENCE_COPY_V2_ADMISSION_ENABLED: 'yes' },
    ]) {
      expect(() => resolveFencedStateReferenceConfig(parseEnv({ ...settings, ...overrides }))).toThrow();
    }
  });

  it.each(['never-versioned', 'versioned', 'suspended'])('retains recovery with admission OFF for %s', (versioning) => {
    const config = resolveFencedStateReferenceConfig(parseEnv({
      ...settings, STATE_REFERENCE_COPY_V2_VERSIONING_HISTORY: versioning,
    }));
    expect(config).toMatchObject({ admissionEnabled: false, versioning });
  });

  it('constructs configured recovery independently of the admission flag', () => {
    const storageFactory = vi.fn(() => ({
      imageCreator: { loadSource: vi.fn(), createImage: vi.fn() },
      recovery: { observe: vi.fn(), fenceAndErase: vi.fn() },
    }));
    createFencedStateReferenceRuntime(parseEnv(settings), database, { storageFactory });
    expect(storageFactory).toHaveBeenCalledWith(expect.objectContaining({ admissionEnabled: false }));
    expect(resolveFencedStateReferenceConfig(parseEnv({ ...settings,
      STATE_REFERENCE_COPY_V2_ADMISSION_ENABLED: 'true',
    }))?.admissionEnabled).toBe(true);
  });

  it('builds separate lazy temporary role providers and single-attempt bounded clients without invoking them', () => {
    const config = resolveFencedStateReferenceConfig(parseEnv(settings))!;
    const providers = [vi.fn(), vi.fn()];
    const temporaryCredentials = vi.fn().mockReturnValueOnce(providers[0]).mockReturnValueOnce(providers[1]);
    const createClient = vi.fn(() => ({ config: { maxAttempts: 1 }, send: vi.fn() }));
    createConfiguredFencedStateReferenceStorage(config, { temporaryCredentials, createClient });
    expect(temporaryCredentials).toHaveBeenCalledTimes(2);
    expect(temporaryCredentials.mock.calls.map(([input]) => input.params.RoleArn)).toEqual([
      settings.STATE_REFERENCE_COPY_V2_IMAGE_ROLE_ARN, settings.STATE_REFERENCE_COPY_V2_RECOVERY_ROLE_ARN,
    ]);
    for (const [input] of temporaryCredentials.mock.calls) {
      expect(input.clientConfig).toMatchObject({ region: settings.AWS_REGION, maxAttempts: 1,
        requestHandler: { requestTimeout: 15_000, connectionTimeout: 3_000, socketTimeout: 15_000, throwOnRequestTimeout: true } });
    }
    expect(createClient.mock.calls).toHaveLength(3);
    for (const [input] of createClient.mock.calls as unknown as Array<[Record<string, unknown>]>) {
      expect(input).toMatchObject({ region: settings.AWS_REGION, maxAttempts: 1,
        requestHandler: { requestTimeout: 15_000, connectionTimeout: 3_000, socketTimeout: 15_000, throwOnRequestTimeout: true } });
    }
    expect(providers.every((provider) => provider.mock.calls.length === 0)).toBe(true);
    expect(createClient.mock.results.every(({ value }) => value.send.mock.calls.length === 0)).toBe(true);
  });

  it('keeps the journal coordinator installed without storage so existing v2 cannot fall through to v1', async () => {
    const repository = { findActiveAttempt: vi.fn(async () => ({ state: 'unresolved', intent: {} })) };
    const runtime = createFencedStateReferenceRuntime(parseEnv({}), database, {
      repository: repository as unknown as FencedStateReferenceRepository,
    });
    await expect(runtime.tryConfirmReference({} as never)).rejects.toThrow();
    expect(repository.findActiveAttempt).toHaveBeenCalledOnce();
  });

  it('also rejects an invalid direct factory configuration before creating providers or clients', () => {
    const config = resolveFencedStateReferenceConfig(parseEnv(settings))!;
    const temporaryCredentials = vi.fn();
    const createClient = vi.fn();
    expect(() => createConfiguredFencedStateReferenceStorage({ ...config, recoveryRoleArn: config.imageRoleArn }, {
      temporaryCredentials, createClient,
    })).toThrow('State reference v2');
    expect(temporaryCredentials).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});
