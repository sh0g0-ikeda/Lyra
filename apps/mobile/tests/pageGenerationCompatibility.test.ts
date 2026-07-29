import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import {
  isLegacyPageGenerationCapabilityUnavailable,
  runPageGenerationWithLegacyFallback,
} from '@/lib/pageGenerationCompatibility';

describe('page generation compatibility', () => {
  it('現行の一括保存生成が成功した場合は旧APIを呼ばない', async () => {
    const saveAndGenerate = vi.fn().mockResolvedValue({ job_id: 'atomic-job' });
    const saveDrafts = vi.fn();
    const generateLegacy = vi.fn();

    await expect(
      runPageGenerationWithLegacyFallback({
        saveAndGenerate,
        saveDrafts,
        generateLegacy,
      }),
    ).resolves.toEqual({ job_id: 'atomic-job' });
    expect(saveDrafts).not.toHaveBeenCalled();
    expect(generateLegacy).not.toHaveBeenCalled();
  });

  it.each([404, 405])(
    '一括保存生成がHTTP %sなら保存後に旧生成APIを呼ぶ',
    async (status) => {
      const calls: string[] = [];
      const saveAndGenerate = vi.fn().mockRejectedValue(
        new ApiError('Route unavailable', status, 'NOT_FOUND'),
      );
      const saveDrafts = vi.fn().mockImplementation(async () => {
        calls.push('save');
      });
      const generateLegacy = vi.fn().mockImplementation(async () => {
        calls.push('generate');
        return { job_id: 'legacy-job' };
      });

      await expect(
        runPageGenerationWithLegacyFallback({
          saveAndGenerate,
          saveDrafts,
          generateLegacy,
        }),
      ).resolves.toEqual({ job_id: 'legacy-job' });
      expect(calls).toEqual(['save', 'generate']);
    },
  );

  it('旧API向けの保存に失敗した場合は生成しない', async () => {
    const saveError = new ApiError('Stale page', 409, 'RESOURCE_STALE');
    const generateLegacy = vi.fn();

    await expect(
      runPageGenerationWithLegacyFallback({
        saveAndGenerate: vi.fn().mockRejectedValue(
          new ApiError('Route unavailable', 404, 'NOT_FOUND'),
        ),
        saveDrafts: vi.fn().mockRejectedValue(saveError),
        generateLegacy,
      }),
    ).rejects.toBe(saveError);
    expect(generateLegacy).not.toHaveBeenCalled();
  });

  it.each([0, 400, 401, 403, 409, 413, 422, 429, 500])(
    'HTTP %sは旧APIへフォールバックしない',
    async (status) => {
      const atomicError = new ApiError('Request failed', status, 'REQUEST_FAILED');
      const saveDrafts = vi.fn();
      const generateLegacy = vi.fn();

      await expect(
        runPageGenerationWithLegacyFallback({
          saveAndGenerate: vi.fn().mockRejectedValue(atomicError),
          saveDrafts,
          generateLegacy,
        }),
      ).rejects.toBe(atomicError);
      expect(saveDrafts).not.toHaveBeenCalled();
      expect(generateLegacy).not.toHaveBeenCalled();
    },
  );

  it('404と405だけを未対応の生成機能として扱う', () => {
    expect(
      isLegacyPageGenerationCapabilityUnavailable(
        new ApiError('Not found', 404, 'NOT_FOUND'),
      ),
    ).toBe(true);
    expect(
      isLegacyPageGenerationCapabilityUnavailable(
        new ApiError('Method not allowed', 405, 'METHOD_NOT_ALLOWED'),
      ),
    ).toBe(true);
    expect(
      isLegacyPageGenerationCapabilityUnavailable(
        new ApiError('Server error', 500, 'INTERNAL_ERROR'),
      ),
    ).toBe(false);
    expect(isLegacyPageGenerationCapabilityUnavailable(new Error('offline'))).toBe(false);
  });
});
