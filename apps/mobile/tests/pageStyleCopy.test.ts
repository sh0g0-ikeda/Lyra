import { describe, expect, it } from 'vitest';

import { t } from '@/lib/i18n';

describe('Pages style reference copy', () => {
  it('画風の参考に必要な日本語ラベルを辞書から返す', () => {
    expect(t('ja', 'styleReference')).toBe('画風の参考');
    expect(t('ja', 'styleReferenceTitle')).toBe('参考にしたい作品・画風');
    expect(t('ja', 'styleReferenceNotes')).toBe('線、色、雰囲気など守りたいこと');
  });
});
