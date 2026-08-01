import { describe, expect, it, vi } from 'vitest';

import { createSingleFlight } from '@/lib/singleFlight';

describe('createSingleFlight', () => {
  it('同時に開始した認証更新を一度だけ実行する', async () => {
    let resolveTask: ((value: string) => void) | null = null;
    const task = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveTask = resolve;
        })
    );
    const run = createSingleFlight(task);

    const first = run();
    const second = run();
    resolveTask?.('refreshed');

    await expect(Promise.all([first, second])).resolves.toEqual(['refreshed', 'refreshed']);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('完了後の認証更新は新しく実行する', async () => {
    const task = vi.fn().mockResolvedValue('refreshed');
    const run = createSingleFlight(task);

    await run();
    await run();

    expect(task).toHaveBeenCalledTimes(2);
  });
});
