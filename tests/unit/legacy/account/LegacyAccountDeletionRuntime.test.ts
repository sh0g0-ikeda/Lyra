import { describe, expect, it } from 'vitest';
import { LegacyAccountDeletionRuntime } from '../../../../src/legacy/account/LegacyAccountDeletionRuntime.js';

describe('LegacyAccountDeletionRuntime', () => {
  it('同時runは重ねずpending recoveryを一回だけ実行する', async () => {
    let resolveRun: (() => void) | undefined;
    let calls = 0;
    const service = {
      async recoverPendingRequests(): Promise<{ attemptedCount: number; completedCount: number }> {
        calls += 1;
        await new Promise<void>((resolve) => { resolveRun = resolve; });
        return { attemptedCount: 1, completedCount: 0 };
      },
    };
    const runtime = new LegacyAccountDeletionRuntime(service, 10);

    const first = runtime.runOnce();
    const second = await runtime.runOnce();
    expect(second).toEqual({ attemptedCount: 0, completedCount: 0, skipped: true });
    resolveRun?.();
    expect(await first).toEqual({ attemptedCount: 1, completedCount: 0, skipped: false });
    expect(calls).toBe(1);
  });
});
