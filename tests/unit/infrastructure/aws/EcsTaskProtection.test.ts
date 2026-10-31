import { describe, expect, it, vi } from 'vitest';
import {
  EcsTaskProtection,
  type EcsTaskProtectionFetch,
} from '../../../../src/infrastructure/aws/EcsTaskProtection.js';

function createFetch(status = 200): EcsTaskProtectionFetch {
  return vi.fn(async (_url, init) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'test',
    json: async () => ({ ProtectionEnabled: JSON.parse(init.body).ProtectionEnabled }),
  }));
}

describe('EcsTaskProtection', () => {
  it('protectの場合にECS agentへ60分の保護をPUTする', async () => {
    const fetch = createFetch();
    const protection = new EcsTaskProtection({ agentUri: 'http://169.254.170.2', fetch });

    await protection.protect();

    expect(fetch).toHaveBeenCalledWith(
      'http://169.254.170.2/task-protection/v1/state',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ ProtectionEnabled: true, ExpiresInMinutes: 60 }),
      }),
    );
  });

  it('保護取得に失敗した場合はworkを開始しない', async () => {
    const work = vi.fn(async () => 'completed');
    const protection = new EcsTaskProtection({ agentUri: 'http://169.254.170.2', fetch: createFetch(500) });

    await expect(protection.runProtected(work)).rejects.toThrow('ECS task protection request failed');

    expect(work).not.toHaveBeenCalled();
  });

  it('HTTP成功でも要求した保護状態が確認できなければworkを開始しない', async () => {
    const fetch = vi.fn<EcsTaskProtectionFetch>().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ProtectionEnabled: false }),
    });
    const work = vi.fn(async () => 'completed');
    const protection = new EcsTaskProtection({ agentUri: 'http://169.254.170.2', fetch });

    await expect(protection.runProtected(work)).rejects.toThrow('did not confirm');

    expect(work).not.toHaveBeenCalled();
  });

  it('workの完了後は保護を解除する', async () => {
    const fetch = createFetch();
    const protection = new EcsTaskProtection({ agentUri: 'http://169.254.170.2', fetch });

    await expect(protection.runProtected(async () => 'completed')).resolves.toBe('completed');

    expect(fetch).toHaveBeenLastCalledWith(
      'http://169.254.170.2/task-protection/v1/state',
      expect.objectContaining({
        body: JSON.stringify({ ProtectionEnabled: false }),
      }),
    );
  });

  it('workの失敗をrelease失敗で隠さない', async () => {
    const fetch = vi
      .fn<EcsTaskProtectionFetch>()
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: async () => ({ ProtectionEnabled: true }) })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'failure', json: async () => ({}) });
    const warn = vi.fn();
    const protection = new EcsTaskProtection({ agentUri: 'http://169.254.170.2', fetch, warn });

    await expect(protection.runProtected(async () => {
      throw new Error('work failed');
    })).rejects.toThrow('work failed');

    expect(warn).toHaveBeenCalledOnce();
  });

  it('完了callbackはworkのsettlement後に一度だけ呼ぶ', async () => {
    const callback = vi.fn(async () => undefined);
    const protection = new EcsTaskProtection({ agentUri: 'http://169.254.170.2', fetch: createFetch() });

    await protection.runProtected(async () => 'completed', callback);

    expect(callback).toHaveBeenCalledOnce();
  });

  it('完了callbackが失敗しても保護を解除する', async () => {
    const fetch = createFetch();
    const protection = new EcsTaskProtection({ agentUri: 'http://169.254.170.2', fetch });

    await expect(protection.runProtected(
      async () => 'completed',
      async () => { throw new Error('settlement failed'); },
    )).rejects.toThrow('settlement failed');

    expect(fetch).toHaveBeenLastCalledWith(
      'http://169.254.170.2/task-protection/v1/state',
      expect.objectContaining({ body: JSON.stringify({ ProtectionEnabled: false }) }),
    );
  });

  it('進行中heartbeatの完了を待ってから保護を解除する', async () => {
    vi.useFakeTimers();
    let resolveWork: (() => void) | undefined;
    let resolveHeartbeat: (() => void) | undefined;
    const fetch = vi.fn<EcsTaskProtectionFetch>()
      .mockImplementationOnce(async () => response(true))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveHeartbeat = () => resolve(response(true));
      }))
      .mockImplementationOnce(async () => response(false));
    const protection = new EcsTaskProtection({
      agentUri: 'http://169.254.170.2', fetch, heartbeatIntervalMs: 1,
    });
    const running = protection.runProtected(async () => new Promise<string>((resolve) => {
      resolveWork = () => resolve('completed');
    }));

    await vi.advanceTimersByTimeAsync(1);
    resolveWork?.();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);

    resolveHeartbeat?.();
    await expect(running).resolves.toBe('completed');
    expect(fetch).toHaveBeenLastCalledWith(
      'http://169.254.170.2/task-protection/v1/state',
      expect.objectContaining({ body: JSON.stringify({ ProtectionEnabled: false }) }),
    );
    vi.useRealTimers();
  });

  it('heartbeat更新が一度失敗してもwork結果を維持し次周期で更新を再試行する', async () => {
    vi.useFakeTimers();
    try {
      let resolveWork: (() => void) | undefined;
      const warn = vi.fn();
      const fetch = vi.fn<EcsTaskProtectionFetch>()
        .mockResolvedValueOnce(response(true))
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'unavailable', json: async () => ({}) })
        .mockResolvedValueOnce(response(true))
        .mockResolvedValueOnce(response(false));
      const protection = new EcsTaskProtection({
        agentUri: 'http://169.254.170.2', fetch, warn, heartbeatIntervalMs: 1,
      });
      const running = protection.runProtected(() => new Promise<string>((resolve) => {
        resolveWork = () => resolve('completed');
      }));

      await vi.advanceTimersByTimeAsync(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('active job continues'));
      await vi.advanceTimersByTimeAsync(1);
      resolveWork?.();

      await expect(running).resolves.toBe('completed');
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

function response(protectionEnabled: boolean): { ok: boolean; status: number; statusText: string; json(): Promise<unknown> } {
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({ ProtectionEnabled: protectionEnabled }) };
}
