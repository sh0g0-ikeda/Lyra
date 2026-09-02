import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const renderSource = (screen: 'StoryScreen' | 'CharactersScreen' | 'PagesScreen'): string => {
  const source = readSource(`src/screens/${screen}.tsx`);
  return source.slice(source.indexOf('  return (\n    <Screen'));
};

describe('mobile workspace navigation and editor UX contract', () => {
  it('物語・キャラ・ページの先頭に共通の作品・章・話ナビゲータを置く', () => {
    for (const screen of ['StoryScreen', 'CharactersScreen', 'PagesScreen'] as const) {
      const source = renderSource(screen);
      expect(source).toContain('<WorkspaceHierarchyNavigator');
      expect(source).not.toContain('<WorkspaceContextPicker');
    }
  });

  it('物語画面は重複する作品名と章名の編集欄を表示しない', () => {
    const source = renderSource('StoryScreen');

    expect(source).not.toContain('persistKey="story:work-title"');
    expect(source).not.toContain('persistKey="story:chapter-title"');
  });

  it('話は初期表示し、Story AIをシーンより前に置き、シーン説明を閉じた状態でも示す', () => {
    const source = renderSource('StoryScreen');
    const episode = source.indexOf('persistKey="story:episode"');
    const storyAi = source.indexOf('persistKey="story:story-ai"');
    const scenes = source.indexOf('persistKey="story:scenes"');

    expect(episode).toBeGreaterThanOrEqual(0);
    expect(source.slice(Math.max(0, episode - 100), episode)).not.toContain('defaultCollapsed');
    expect(storyAi).toBeGreaterThan(episode);
    expect(scenes).toBeGreaterThan(storyAi);
    expect(source.slice(Math.max(0, scenes - 180), scenes)).toContain('defaultCollapsed');
    expect(source.slice(Math.max(0, scenes - 220), scenes + 220)).toContain('showSubtitleWhenCollapsed');
  });

  it('物語は初心者向け名称と保存済み状態から次工程を案内する', () => {
    const storyScreen = readSource('src/screens/StoryScreen.tsx');
    const source = renderSource('StoryScreen');

    expect(source).toContain("title={t(language, 'screen.story.entry.title')}");
    expect(source).toContain("title={t(language, 'storyAi')}");
    expect(source).toContain("title={t(language, 'scenes')}");
    expect(storyScreen).toContain('shouldShowStoryNextStep({');
    expect(source).toContain("'screen.story.next.characters'");
  });

  it('キャラクター種別の直後に画像取り込みを置く', () => {
    const source = renderSource('CharactersScreen');
    const type = source.indexOf('<SegmentedControl onChange={setEntityType}');
    const imageImport = source.indexOf("onLayout={recordSectionOffset('import')}");
    const firstStructuredGroup = source.indexOf('<CollapsibleGroup');

    expect(type).toBeGreaterThanOrEqual(0);
    expect(imageImport).toBeGreaterThan(type);
    expect(imageImport).toBeLessThan(firstStructuredGroup);
  });

  it('キャラクター画面は集計カードを除き保存・プレビュー・確定・ページの順に案内する', () => {
    const characterScreen = readSource('src/screens/CharactersScreen.tsx');
    const source = renderSource('CharactersScreen');

    expect(source).not.toContain('styles.metricsGrid');
    expect(source).not.toContain('formatReferenceStatus(');
    expect(characterScreen).toContain('resolveCharacterWorkflowNextStep({');
    expect(characterScreen).toContain('invalidateActiveReferenceJob()');
    expect(characterScreen).toContain(
      'hasJustConfirmedPreview: lastConfirmedPreviewEntityId === selectedEntity?.id'
    );
    expect(characterScreen).toMatch(
      /const deleteReferenceMutation[\s\S]*?setLastConfirmedPreviewEntityId\(null\);[\s\S]*?await invalidateReference\(\);/
    );
    expect(characterScreen).toContain("'screen.characters.next.createPreview'");
    expect(characterScreen).toContain("'screen.characters.next.confirmPreview'");
    expect(characterScreen).toContain("'screen.characters.next.openPages'");
  });

  it('ページの画風レファレンスは初期状態で閉じる', () => {
    const source = renderSource('PagesScreen');
    const style = source.indexOf('persistKey="pages:style"');

    expect(source.slice(Math.max(0, style - 120), style)).toContain('defaultCollapsed');
  });

  it('ページ一覧・コマ設定・流れの概要を指定された説明で表示する', () => {
    const source = renderSource('PagesScreen');
    const confirmedSummary = readSource('src/components/ConfirmedPageSummary.tsx');

    expect(source).toContain("helperText={t(language, 'screen.pages.list.subtitle')}");
    expect(source).toContain("subtitle={t(language, 'screen.pages.panelSettings.subtitle')}");
    expect(source).toContain("title={t(language, 'panels')}");
    expect(source).toContain("title={t(language, 'screen.pages.flowOverview')}");
    expect(confirmedSummary).toContain("'screen.pages.flowOverview'");
  });

  it('全画面共通Screenの日英切替を上部に維持する', () => {
    const screen = readSource('src/components/Screen.tsx');

    expect(screen.indexOf('styles.languageSwitcher')).toBeLessThan(
      screen.indexOf('{showHeader ? (')
    );
    expect(screen).toContain('accessibilityLabel="English"');
    expect(screen).toContain('accessibilityLabel="日本語"');
  });

  it('共通ナビゲータを作品・章・話を選択と表示する', () => {
    const translations = readSource('src/lib/i18nComponentMessages.ts');

    expect(translations).toContain(
      "'component.workspaceHierarchy.title': '作品・章・話を選択'"
    );
  });

  it('ページ設計をページ一覧より前に置き、話単位の既存APIを使う', () => {
    const pageScreen = readSource('src/screens/PagesScreen.tsx');
    const source = renderSource('PagesScreen');
    const pageDesign = source.indexOf('persistKey="pages:design"');
    const pageList = source.indexOf('persistKey="pages:list"');
    const skeletonMutation = pageScreen.slice(
      pageScreen.indexOf('const pageSkeletonMutation'),
      pageScreen.indexOf('const pageStoryAutofillMutation')
    );
    const autofillMutation = pageScreen.slice(
      pageScreen.indexOf('const pageStoryAutofillMutation'),
      pageScreen.indexOf('const cancelPageDesignJobMutation')
    );

    expect(pageDesign).toBeGreaterThanOrEqual(0);
    expect(pageList).toBeGreaterThan(pageDesign);
    expect(skeletonMutation.indexOf('await saveAllPageDrafts()')).toBeLessThan(
      skeletonMutation.indexOf('api.generatePageSkeleton(')
    );
    expect(autofillMutation.indexOf('await saveAllPageDrafts()')).toBeLessThan(
      autofillMutation.indexOf('api.autofillEpisodePagesFromStory(')
    );
    expect(pageScreen).toContain('displayedPageDesignJobId');
    expect(pageScreen).toContain('displayedJobId');
    expect(pageScreen).toContain('hasActiveJob={pageDesignOperationActive}');
    expect(pageScreen).toContain('pageDesignJobEnqueued ||');
  });

  it('ページ設計の操作場所をページ画面に一本化する', () => {
    expect(renderSource('StoryScreen')).not.toContain(
      '<StoryGenerationControls'
    );
    expect(renderSource('PagesScreen')).toContain('<StoryGenerationControls');
  });

  it('選択中ページ画像をページ生成操作と画像保存の間に置く', () => {
    const source = renderSource('PagesScreen');
    const pageList = source.indexOf('persistKey="pages:list"');
    const pageListEnd = source.indexOf('</Section>', pageList);
    const generate = source.indexOf('<PageGenerationActions');
    const image = source.indexOf('<View style={styles.pageImageFrame}>');
    const saveImage = source.indexOf(
      'generated.screens.PagesScreen.save.image.dd680bcb'
    );

    expect(source.slice(pageList, pageListEnd)).not.toContain('pageImageFrame');
    expect(image).toBeGreaterThan(generate);
    expect(image).toBeLessThan(saveImage);
  });

  it('指定された日本語説明を文字化けなく保持する', () => {
    const generatedTranslations = readSource('src/lib/i18nGenerated.ts');
    const screenTranslations = readSource('src/lib/i18nScreenMessages.ts');
    const baseTranslations = readSource('src/lib/i18n.ts');

    expect(generatedTranslations).toContain(
      '話全体の場所・時間・雰囲気をそろえ、ページをまたいだ背景の一貫性を保ちます'
    );
    expect(generatedTranslations).toContain(
      '手元のキャラクター画像をアップロードすると、その見た目を参考にLyraの漫画へ登場させられます。'
    );
    expect(screenTranslations).toContain(
      '横にスライドしてページを探し、タップするとそのページを編集できます'
    );
    expect(screenTranslations).toContain(
      'コマごとに状況、登場人物、セリフ、構図、背景などを整理します。コマを選択してください。'
    );
    expect(screenTranslations).toContain('次はキャラを設定してください！');
    expect(screenTranslations).toContain('次にプレビュー画像を作ってください！');
    expect(screenTranslations).toContain('気に入ったら「確定」してください');
    expect(screenTranslations).toContain('ページの設定に移ってください');
    expect(baseTranslations).toContain("storyAi: 'AIでストーリーを改善'");
    expect(baseTranslations).toContain("scenes: '背景や時間帯の設定'");
    expect(baseTranslations).toContain("panels: 'コマの設定'");
    expect(baseTranslations).toContain("referenceSet: '作成したキャラのプレビュー'");
  });
});
