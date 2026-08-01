import { describe, expect, it } from 'vitest';
import { formatMessageTemplate } from '@/lib/i18n';

describe('Mobile i18n formatting', () => {
  it('名前付きパラメータだけをテンプレートへ埋め込む', () => {
    expect(
      formatMessageTemplate('Page {page} / {total}', {
        page: 2,
        total: 8
      })
    ).toBe('Page 2 / 8');
  });

  it('不足しているパラメータはプレースホルダーを残す', () => {
    expect(formatMessageTemplate('Page {page} / {total}', { page: 2 })).toBe(
      'Page 2 / {total}'
    );
  });
});
