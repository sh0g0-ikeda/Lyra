import { vi } from 'vitest';

export async function advanceFakeTimersByTime(milliseconds: number): Promise<void> {
  await flushPromiseTurns();
  vi.advanceTimersByTime(milliseconds);
  await flushPromiseTurns();
}

async function flushPromiseTurns(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
