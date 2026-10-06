import { describe, expect, it, vi } from 'vitest';
import {
  startAttestedCanonicalRuntime,
  type AttestedCanonicalRuntime,
} from '../../../src/lib/runtimeSchemaAttestation.js';

// Spec §11: schema attestation precedes every writer. This canonical-only
// bootstrap does not admit the artificial legacy reference or production44.
describe('attested canonical runtime startup', () => {
  it('schema検証が完了するまでHTTPとqueueとrecoveryを開始しない', async () => {
    let complete!: (descriptor: 'canonical_fresh_v1') => void;
    const pending = new Promise<'canonical_fresh_v1'>((resolve) => { complete = resolve; });
    const http = vi.fn();
    const queue = vi.fn();
    const recovery = vi.fn();
    const maintenance = vi.fn();
    const startup = startAttestedCanonicalRuntime({
      attest: () => pending,
      start: (runtime) => {
        http(runtime); queue(runtime); recovery(runtime); maintenance(runtime);
        return runtime;
      },
    });
    await Promise.resolve();
    for (const writer of [http, queue, recovery, maintenance]) expect(writer).not.toHaveBeenCalled();
    complete('canonical_fresh_v1');
    const runtime = await startup;
    expect(runtime).toEqual({ descriptor: 'canonical_fresh_v1', repositoryProfile: 'canonical' });
    for (const writer of [http, queue, recovery, maintenance]) expect(writer).toHaveBeenCalledExactlyOnceWith(runtime);
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it.each(['SCHEMA_QUERY_FAILED', 'SCHEMA_UNSUPPORTED'])('%sの場合にwriter構築前に失敗する', async (message) => {
    const failure = new Error(message);
    const start = vi.fn();
    await expect(startAttestedCanonicalRuntime({
      attest: async () => { throw failure; }, start,
    })).rejects.toBe(failure);
    expect(start).not.toHaveBeenCalled();
  });

  it('canonical以外のdescriptorが渡された場合にwriterを開始しない', async () => {
    const start = vi.fn();
    await expect(startAttestedCanonicalRuntime({
      attest: async () => 'legacy_2debe_v1' as 'canonical_fresh_v1', start,
    })).rejects.toThrow('SCHEMA_UNSUPPORTED');
    expect(start).not.toHaveBeenCalled();
  });

  it('起動後にprofile変更を試みても遅延recoveryには同じ検証済み値を渡す', async () => {
    let delayedRecovery!: () => AttestedCanonicalRuntime;
    const result = await startAttestedCanonicalRuntime({
      attest: async () => 'canonical_fresh_v1',
      start: (runtime) => {
        delayedRecovery = () => runtime;
        return runtime;
      },
    });
    expect(Reflect.set(result, 'repositoryProfile', 'legacy_2debe_v1')).toBe(false);
    expect(delayedRecovery()).toBe(result);
    expect(delayedRecovery().repositoryProfile).toBe('canonical');
  });
});
