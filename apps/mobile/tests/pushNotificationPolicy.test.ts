import { describe, expect, it } from 'vitest';

import {
  parsePushNavigationData,
  pushNavigationSelection
} from '@/domain/pushNotificationPolicy';

const ids = {
  job: '11111111-1111-4111-8111-111111111111',
  organization: '22222222-2222-4222-8222-222222222222',
  work: '33333333-3333-4333-8333-333333333333',
  chapter: '44444444-4444-4444-8444-444444444444',
  episode: '55555555-5555-4555-8555-555555555555',
  page: '66666666-6666-4666-8666-666666666666'
};

describe('push notification navigation policy', () => {
  it('opaque IDだけのpage通知を厳格に検証してworkspace選択へ変換する', () => {
    const data = parsePushNavigationData({
      job_id: ids.job,
      organization_id: ids.organization,
      target_tab: 'Pages',
      work_id: ids.work,
      chapter_id: ids.chapter,
      episode_id: ids.episode,
      page_id: ids.page
    });

    expect(data).not.toBeNull();
    expect(pushNavigationSelection(data!)).toEqual({
      organizationId: ids.organization,
      workId: ids.work,
      chapterId: ids.chapter,
      episodeId: ids.episode,
      pageId: ids.page,
      entityId: null
    });
  });

  it('文章・未知field・不正UUID・target不整合を拒否する', () => {
    expect(
      parsePushNavigationData({
        job_id: ids.job,
        target_tab: 'Pages',
        story_name: '秘密の作品名'
      })
    ).toBeNull();
    expect(parsePushNavigationData({ job_id: 'not-a-uuid', target_tab: 'Account' })).toBeNull();
    expect(
      parsePushNavigationData({
        job_id: ids.job,
        target_tab: 'Pages',
        entity_id: ids.page
      })
    ).toBeNull();
  });
});
