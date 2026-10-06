import { describe, expect, it, vi } from 'vitest';
import {
  EcsTaskScaleInProtection,
  assertTaskScaleInProtectionEnvironment,
  createTaskScaleInProtectionFromEnvironment,
} from '../../../worker/ecsTaskScaleInProtection.js';

describe('EcsTaskScaleInProtection', () => {
  it('明示有効時にECS agent URIがなければ起動を拒否する', () => {
    expect(() => assertTaskScaleInProtectionEnvironment({
      ECS_TASK_SCALE_IN_PROTECTION_ENABLED: 'true',
    })).toThrow('ECS_AGENT_URI');
  });

  it('未指定時は既存runtime向けの無効adapterを返す', async () => {
    const protection = createTaskScaleInProtectionFromEnvironment({});

    await expect(protection.protect(10)).resolves.toBeUndefined();
    await expect(protection.unprotect()).resolves.toBeUndefined();
  });

  it('保護と解除をbounded requestでagent endpointへ送る', async () => {
    const requests: Array<{ url: string; body: unknown; signal: AbortSignal | null | undefined }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as unknown,
        signal: init?.signal,
      });
      const enabled = (requests.at(-1)?.body as { ProtectionEnabled: boolean }).ProtectionEnabled;
      return new Response(JSON.stringify({
        protection: {
          ProtectionEnabled: enabled,
          ExpirationDate: enabled ? '2026-10-03T03:00:00.000Z' : null,
          TaskArn: 'arn:aws:ecs:ap-northeast-1:452284481392:task/stage/example',
        },
      }), { status: 200 });
    });
    const protection = new EcsTaskScaleInProtection(
      'http://169.254.170.2/api/6f0de4c8',
      fetcher,
    );

    await protection.protect(35);
    await protection.unprotect();

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: 'http://169.254.170.2/api/6f0de4c8/task-protection/v1/state',
      body: { ProtectionEnabled: true, ExpiresInMinutes: 35 },
    });
    expect(requests[1]).toMatchObject({
      body: { ProtectionEnabled: false },
    });
    expect(requests.every((request) => request.signal instanceof AbortSignal)).toBe(true);
  });

  it('agentが要求状態を確認できない場合はfail closedにする', async () => {
    const protection = new EcsTaskScaleInProtection(
      'http://169.254.170.2/api/6f0de4c8',
      async () => new Response(JSON.stringify({
        protection: {
          ProtectionEnabled: false,
          ExpirationDate: null,
          TaskArn: 'arn:aws:ecs:ap-northeast-1:452284481392:task/stage/example',
        },
      }), { status: 200 }),
    );

    await expect(protection.protect(35)).rejects.toThrow('did not confirm');
  });
});
