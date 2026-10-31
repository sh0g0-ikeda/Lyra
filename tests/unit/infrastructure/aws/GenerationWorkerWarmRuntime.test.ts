import { describe, expect, it, vi } from 'vitest';
import { startGenerationWorkerWarmReconciler } from '../../../../src/infrastructure/aws/GenerationWorkerWarmRuntime.js';

describe('generation worker warm shutdown', () => {
  it('停止の場合に処理中のDB更新が終わるまでdrainする', async () => {
    let finish: () => void = () => undefined;
    const reconcile = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const stop = startGenerationWorkerWarmReconciler({ reconcile });
    expect(reconcile).toHaveBeenCalledTimes(1);
    let drained = false;
    const pending = Promise.resolve(stop()).then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await pending;
    expect(drained).toBe(true);
    await stop();
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
