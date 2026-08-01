import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readMobileSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('mobile accessibility semantic closure', () => {
  it('フォーム入力に表示ラベルをプログラム上関連付ける', () => {
    const source = readMobileSource('src/components/FormField.tsx');

    expect(source).toContain('accessibilityLabel={label}');
  });

  it('ラジオ形式の選択肢とそのモーダルを支援技術へ公開する', () => {
    const segmentedControl = readMobileSource('src/components/SegmentedControl.tsx');
    const pagesScreen = readMobileSource('src/screens/PagesScreen.tsx');
    const charactersScreen = readMobileSource('src/screens/CharactersScreen.tsx');

    for (const source of [segmentedControl, pagesScreen, charactersScreen]) {
      expect(source).toContain('accessibilityRole="radio"');
      expect(source).toContain('accessibilityRole="radiogroup"');
      expect(source).toContain('accessibilityViewIsModal');
      expect(source).toContain('onAccessibilityEscape=');
    }
    expect(segmentedControl).toContain('accessibilityState={{ disabled, selected }}');
    expect(segmentedControl).toContain('accessibilityLabel={selectedLabel}');
    expect(pagesScreen).toContain('accessibilityLabel={t(language, "generated.screens.PagesScreen.close.603bc62f")}');
    expect(charactersScreen).toContain('accessibilityLabel={t(language, "generated.screens.CharactersScreen.close.603bc62f")}');
  });

  it('階層シートの各モーダルにモーダルと閉じるセマンティクスを持たせる', () => {
    const source = readMobileSource('src/components/StoryHierarchySheet.tsx');

    expect(source.match(/accessibilityViewIsModal/g)).toHaveLength(3);
    expect(source.match(/onAccessibilityEscape=/g)).toHaveLength(3);
    expect(source.match(/accessibilityLabel={t\(language, "generated\.components\.StoryHierarchySheet\.close\.603bc62f"\)}/g)).toHaveLength(3);
  });

  it('未保存編集の解決モーダルを制御可能なアプリ内ダイアログとして公開する', () => {
    const source = readMobileSource(
      'src/components/UnsavedChangesResolutionDialog.tsx'
    );

    expect(source).toContain('accessibilityViewIsModal');
    expect(source).toContain('onAccessibilityEscape={cancel}');
    expect(source).toContain('accessible={false}');
    expect(source).toContain('testID="dirty-resolution-save"');
    expect(source).toContain('testID="dirty-resolution-discard"');
    expect(source).toContain('testID="dirty-resolution-cancel"');
  });

  it('法人管理モーダルを閉じた後に各起動ボタンへフォーカスを戻す', () => {
    const account = readMobileSource('src/screens/AccountScreen.tsx');
    const management = readMobileSource(
      'src/components/OrganizationManagementPanel.tsx'
    );

    expect(account).toContain(
      'restoreFocusRef={organizationManagementTriggerRef}'
    );
    for (const trigger of [
      'membersCollectionTriggerRef',
      'invitationsCollectionTriggerRef',
      'usageCollectionTriggerRef',
      'auditCollectionTriggerRef'
    ]) {
      expect(management).toContain(`restoreFocusRef={${trigger}}`);
    }
  });

  it('ページとキャラクターの画像プレビュー操作に翻訳済みの意味を付ける', () => {
    const pagesScreen = readMobileSource('src/screens/PagesScreen.tsx');
    const charactersScreen = readMobileSource('src/screens/CharactersScreen.tsx');
    const previewLabel = 'generated.components.ImagePreviewModal.image.preview.0f884bd2';

    expect(pagesScreen).toContain(previewLabel);
    expect(charactersScreen.match(new RegExp(previewLabel, 'g'))).toHaveLength(2);
  });

  it('すべての既知の小型操作に44pt以上のタップ領域を持たせる', () => {
    const assertions = [
      ['src/components/JobStatusCard.tsx', 'retryButton', 'minHeight'],
      ['src/components/SegmentedControl.tsx', 'segment', 'minHeight'],
      ['src/screens/StoryScreen.tsx', 'chip', 'minHeight'],
      ['src/screens/PagesScreen.tsx', 'chip', 'minHeight'],
      ['src/screens/PagesScreen.tsx', 'panelDisclosureHeader', 'minHeight'],
      ['src/screens/PagesScreen.tsx', 'templateModalClose', 'height'],
      ['src/screens/CharactersScreen.tsx', 'choiceModalClose', 'height'],
      ['src/screens/CharactersScreen.tsx', 'groupHeader', 'minHeight'],
      ['src/screens/CharactersScreen.tsx', 'smallLink', 'minHeight'],
      ['src/screens/CharactersScreen.tsx', 'smallDangerLink', 'minHeight']
    ] as const;

    for (const [relativePath, styleName, dimension] of assertions) {
      const source = readMobileSource(relativePath);
      const block = source.match(
        new RegExp(`\\n  ${styleName}: \\{([\\s\\S]*?)\\n  \\}`)
      )?.[1];
      expect(block, `${relativePath}#${styleName}`).toBeDefined();
      const value = block?.match(new RegExp(`${dimension}: (\\d+)`))?.[1];
      expect(Number(value), `${relativePath}#${styleName}.${dimension}`).toBeGreaterThanOrEqual(44);
      if (dimension === 'height') {
        const width = block?.match(/width: (\d+)/)?.[1];
        expect(Number(width), `${relativePath}#${styleName}.width`).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
