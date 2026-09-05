import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
  'utf8'
);

describe('ページ編集の選択・追加契約', () => {
  it('画面タイトルに工程番号を付け導入文を表示しない', () => {
    expect(source).toContain("title={t(language, 'screen.pages.title')}");
    expect(source).not.toContain('review.each.page.scene.source.layout');
  });

  it('キャラクター割当は選択した一人だけを編集し全配列を更新する', () => {
    expect(source).toContain('selectedAssignmentEntityId');
    expect(source).toContain('setSelectedAssignmentEntityId');
    expect(source).toContain('const selectedAssignment = props.assignments.find');
    expect(source).toContain('props.assignments.map((assignment) =>');
  });

  it('重複するセリフ案内を描画しない', () => {
    expect(source).not.toContain('<PanelDialoguePlacementNotice');
    expect(source).not.toContain("import { PanelDialoguePlacementNotice }");
    expect(source).toMatch(/<PanelDialogueEditor[\s\S]*?key=\{selectedPanel\?\.id \?\? 'new-panel'\}/u);
  });

  it('途中まで追加されたコマは再作成せず修復できる', () => {
    expect(source).toContain('recoverPanelInsertion({');
    expect(source).toContain("t(language, 'screen.pages.panelInsert.repair')");
  });

  it('未保存入力を保存してから空コマを末尾作成し選択直後へ並べ替える', () => {
    expect(source).toContain('executePanelInsertion({');
    expect(source).toContain('saveDrafts: saveAllPageDrafts');
    expect(source).toContain('api.createPanel(selectedPage.id, payload');
    expect(source).toContain('api.reorderPanels(selectedPage.id, panelIds');
    expect(source).toContain('api.replaceFrames(selectedPage.id, { frames }');
  });

  it('追加中と編集不可・生成中では追加操作を無効にする', () => {
    expect(source).toContain('insertPanelAfterMutation.isPending');
    expect(source).toContain('selectedPage.status === \'generating\'');
    expect(source).toContain('selectedPage.status === \'confirmed\'');
    expect(source).toContain('panelInsertionOperationRef.current');
    expect(source).toContain('panelInsertionOperationActive');
    expect(source).toContain('accessibilityViewIsModal');
    expect(source).toContain('onRequestClose={() => undefined}');
    expect(source).toContain('currentPageIdRef.current !== pageId');
    expect(source).toContain('panelInsertionRecoveryPageId !== selectedPage?.id');
  });
});
