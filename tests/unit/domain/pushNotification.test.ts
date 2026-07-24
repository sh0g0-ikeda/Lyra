import { describe, expect, it } from 'vitest';

import {
  buildGenerationJobNotificationContent,
  type PushNavigationPayload,
} from '../../../src/domain/pushNotification.js';

describe('generation job push notification', () => {
  it.each([
    ['ja', 'completed', '生成が完了しました', 'アプリで結果を確認できます。'],
    ['ja', 'failed', '生成を完了できませんでした', 'アプリで状況を確認してください。'],
    ['en', 'completed', 'Generation completed', 'Open the app to review the result.'],
    ['en', 'failed', 'Generation could not be completed', 'Open the app to review the status.'],
  ] as const)(
    '%s の %s 通知はユーザーコンテンツを含まない固定文言になる',
    (locale, status, expectedTitle, expectedBody) => {
      expect(buildGenerationJobNotificationContent(locale, status)).toEqual({
        title: expectedTitle,
        body: expectedBody,
      });
    },
  );

  it('navigation payload は不透明なIDと対象タブだけを保持する', () => {
    const payload: PushNavigationPayload = {
      job_id: '11111111-1111-4111-8111-111111111111',
      organization_id: null,
      target_tab: 'Pages',
      work_id: '22222222-2222-4222-8222-222222222222',
      chapter_id: '33333333-3333-4333-8333-333333333333',
      episode_id: '44444444-4444-4444-8444-444444444444',
      page_id: '55555555-5555-4555-8555-555555555555',
    };

    expect(Object.keys(payload).sort()).toEqual([
      'chapter_id',
      'episode_id',
      'job_id',
      'organization_id',
      'page_id',
      'target_tab',
      'work_id',
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/story|dialogue|email|image|name/iu);
  });
});
