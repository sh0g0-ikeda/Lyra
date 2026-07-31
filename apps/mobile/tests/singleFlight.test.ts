import { describe, expect, it } from 'vitest';
import { createSingleFlight } from '../src/lib/singleFlight';

describe('createSingleFlight', () => {
  it('同時呼出しを1回の処理へ集約し完了後は次の処理を開始する', async () => {
    let resolveTask: ((value: string) => void) | undefined;
    let calls = 0;
    const task = createSingleFlight(async (): Promise<string> => {
      calls += 1;
      return await new Promise<string>((resolve) => {
        resolveTask = resolve;
      });
    });

    const first = task();
    const second = task();

    expect(first).toBe(second);
    expect(calls).toBe(1);
    resolveTask?.('done');
    await expect(first).resolves.toBe('done');

    const third = task();
    expect(calls).toBe(2);
    resolveTask?.('again');
    await expect(third).resolves.toBe('again');
  });

  it('失敗後も次の呼出しを開始できる', async () => {
    let calls = 0;
    const task = createSingleFlight(async (): Promise<number> => {
      calls += 1;
      if (calls === 1) {
        throw new Error('temporary');
      }
      return calls;
    });

    await expect(task()).rejects.toThrow('temporary');
    await expect(task()).resolves.toBe(2);
  });
});
