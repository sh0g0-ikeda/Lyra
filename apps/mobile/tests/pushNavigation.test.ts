import { describe, expect, it, vi } from 'vitest';

import { handlePushNavigation } from '@/lib/pushNavigation';

const data = {
  job_id: '11111111-1111-4111-8111-111111111111',
  organization_id: null,
  target_tab: 'Characters',
  work_id: '22222222-2222-4222-8222-222222222222',
  entity_id: '33333333-3333-4333-8333-333333333333'
} as const;

describe('push notification navigation', () => {
  it('jobを認証APIで再検証してからselectionとtabを変更する', async () => {
    const getJob = vi.fn().mockResolvedValue({ id: data.job_id });
    const updateSelection = vi.fn().mockResolvedValue(true);
    const navigate = vi.fn().mockReturnValue(true);

    await expect(
      handlePushNavigation(data, { getJob, updateSelection, navigate })
    ).resolves.toBe(true);

    expect(getJob).toHaveBeenCalledWith(data.job_id, null);
    expect(updateSelection).toHaveBeenCalledWith({
      organizationId: null,
      workId: data.work_id,
      chapterId: null,
      episodeId: null,
      pageId: null,
      entityId: data.entity_id
    });
    expect(navigate).toHaveBeenCalledWith('Characters');
  });

  it('jobが権限外またはdirty遷移がキャンセルされた場合は画面を変えない', async () => {
    const updateSelection = vi.fn().mockResolvedValue(true);
    const navigate = vi.fn().mockReturnValue(true);
    await expect(
      handlePushNavigation(data, {
        getJob: vi.fn().mockRejectedValue(new Error('not found')),
        updateSelection,
        navigate
      })
    ).resolves.toBe(false);
    expect(updateSelection).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    await expect(
      handlePushNavigation(data, {
        getJob: vi.fn().mockResolvedValue({ id: data.job_id }),
        updateSelection: vi.fn().mockResolvedValue(false),
        navigate
      })
    ).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
