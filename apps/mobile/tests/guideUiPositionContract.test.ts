import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const translations = readFileSync(
  resolve(process.cwd(), 'src/lib/i18nScreenMessages.ts'),
  'utf8',
);

describe('MobileガイドのUI位置契約', () => {
  it('ワークスペースと話選択の実際の入口を案内する', () => {
    expect(translations).toContain(
      "'screen.guide.story.step1': 'ワークスペースはアカウントで切り替えます。ストーリー画面上部で作品・章・話を選ぶか、新しく作成します。'",
    );
    expect(translations).toContain(
      "'screen.guide.story.step1': 'Change workspace in Account. At the top of Story, select or create the work, chapter, and episode.'",
    );
  });

  it('話の保存とストーリーAIの並びを案内する', () => {
    expect(translations).toContain(
      "'screen.guide.story.step4': '話を全体入力欄に書き、ストーリーAIの直前にある「保存」で確定します。'",
    );
    expect(translations).toContain(
      "'screen.guide.story.step4': 'Write the episode in the full story field, then use Save directly before Story AI.'",
    );
  });

  it('新規キャラとページ設計の実際の場所を案内する', () => {
    expect(translations).toContain(
      "'screen.guide.characters.step1': 'キャラクター一覧で「新しいキャラ」を選び、分かっている項目から入力します。'",
    );
    expect(translations).toContain(
      "'screen.guide.characters.step1': 'Choose New character in Character list, then fill the fields you already know.'",
    );
    expect(translations).toContain(
      "'screen.guide.pages.step1': '必要なキャラを作ったら、ページ画面上部の「ページ設計」を開きます。'",
    );
    expect(translations).toContain(
      "'screen.guide.pages.step1': 'After creating the needed characters, open Page design at the top of the Pages screen.'",
    );
  });
});
