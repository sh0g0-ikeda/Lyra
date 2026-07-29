import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  characterContinuityStateUiEnabled,
  pageLayoutEditingUiEnabled,
  panelCharacterStateOverrideUiEnabled
} from '@/constants/mobileFeatureVisibility';

describe('Mobile feature visibility', () => {
  it('キャラ状態管理UIを公開準備が整うまで表示しない', () => {
    expect(characterContinuityStateUiEnabled).toBe(false);
    expect(panelCharacterStateOverrideUiEnabled).toBe(false);
    expect(pageLayoutEditingUiEnabled).toBe(false);
  });

  it('キャラ画面とページ画面が非公開フラグを表示条件に使う', () => {
    const characters = readFileSync(
      resolve(process.cwd(), 'src/screens/CharactersScreen.tsx'),
      'utf8'
    );
    const pages = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );

    expect(characters).toContain('characterContinuityStateUiEnabled ? (');
    expect(pages).toContain('panelCharacterStateOverrideUiEnabled ? (');
    expect(pages).toContain('pageLayoutEditingUiEnabled ? (');
    expect(pages).toContain(
      'onLayout={pageLayoutEditingUiEnabled ? () => setTemplateModalVisible(true) : undefined}'
    );
  });
});
