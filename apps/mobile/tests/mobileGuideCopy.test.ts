import { describe, expect, it } from 'vitest';

import { t } from '@/lib/i18n';

describe('モバイル制作ガイドの表示契約', () => {
  it('更新後の名称でストーリー手順を5段階にする', () => {
    const steps = [1, 2, 3, 4, 5].map((step) =>
      t('ja', `screen.guide.story.step${step}` as const)
    );

    expect(steps).toHaveLength(5);
    expect(steps.join('\n')).toContain('まずはストーリーを入力');
    expect(steps.join('\n')).toContain('AIでストーリーを改善');
    expect(steps.join('\n')).toContain('背景や時間帯の設定');
    expect(steps.join('\n')).not.toContain('作品の概要は任意');
  });

  it('キャラクター手順は不要な旧4番を除き4段階にする', () => {
    const steps = [1, 2, 3, 4].map((step) =>
      t('ja', `screen.guide.characters.step${step}` as const)
    );

    expect(steps).toHaveLength(4);
    expect(steps.join('\n')).toContain('作成したキャラのプレビュー');
    expect(steps.join('\n')).not.toContain('ページ生成では、確定済みレファレンス');
  });

  it('ページの自動入力に20分の目安を含め、現在使える画像保存を案内する', () => {
    const steps = [1, 2, 3, 4, 5, 6, 7].map((step) =>
      t('ja', `screen.guide.pages.step${step}` as const)
    );

    expect(steps.join('\n')).toContain('20分程度かかる場合があります');
    expect(steps.join('\n')).toContain('コマの設定');
    expect(steps.join('\n')).toContain('画像を保存');
    expect(steps.join('\n')).not.toContain('ファイル形式を選び');
  });

  it('英語ガイドにも同じ工程と20分の目安を持たせる', () => {
    const story = [1, 2, 3, 4, 5].map((step) =>
      t('en', `screen.guide.story.step${step}` as const)
    );
    const characters = [1, 2, 3, 4].map((step) =>
      t('en', `screen.guide.characters.step${step}` as const)
    );
    const pages = [1, 2, 3, 4, 5, 6, 7].map((step) =>
      t('en', `screen.guide.pages.step${step}` as const)
    );

    expect(story.join('\n')).toContain('Improve your story with AI');
    expect(characters.join('\n')).toContain('Character previews');
    expect(pages.join('\n')).toContain('about 20 minutes');
  });
});
