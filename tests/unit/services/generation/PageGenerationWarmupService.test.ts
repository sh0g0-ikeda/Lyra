import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../../../src/domain/errors/index.js';
import { PageGenerationWarmupService } from '../../../../src/services/generation/PageGenerationWarmupService.js';

describe('PageGenerationWarmupService', () => {
  it('無効時にはDB確認もAWS起動もしない', async () => {
    const assertReadyForWarmup = vi.fn(async () => undefined);
    const service = new PageGenerationWarmupService({ assertReadyForWarmup }, null);
    await service.warmup('user-1', 'page-1', null);
    expect(assertReadyForWarmup).not.toHaveBeenCalled();
  });
  it('所有scopeとreadinessを確認した後だけ起動を依頼する', async () => {
    const order: string[] = [];
    const assertReadyForWarmup = vi.fn(async () => { order.push('authorized'); });
    const requestWarm = vi.fn(async () => { order.push('warm'); });
    const service = new PageGenerationWarmupService({ assertReadyForWarmup }, { requestWarm });
    await service.warmup('user-1', 'page-1', 'org-1');
    expect(assertReadyForWarmup).toHaveBeenCalledWith('user-1', 'page-1', 'org-1');
    expect(order).toEqual(['authorized', 'warm']);
  });
  it('権限外の対象は起動も課金も行わない', async () => {
    const requestWarm = vi.fn(async () => undefined);
    const service = new PageGenerationWarmupService({ assertReadyForWarmup: async () => { throw new NotFoundError(); } }, { requestWarm });
    await expect(service.warmup('user-1', 'page-1', null)).rejects.toBeInstanceOf(NotFoundError);
    expect(requestWarm).not.toHaveBeenCalled();
  });
});
