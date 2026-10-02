import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// Source contracts must inspect the same logical text on LF and CRLF checkouts.
const read = (file: string): string => readFileSync(`src/${file}`, 'utf8').replace(/\r\n?/gu, '\n');
const render = (file: string): string => { const source = read(`screens/${file}.tsx`); return source.slice(source.indexOf('  return (\n    <Screen')); };
describe('U20–23 明示された編集UI整理', () => {
  it('3画面を番号付きタイトルとし導入subtitleを置かずsectionを黄色にする', () => {
    for (const [screen, key] of [['StoryScreen', 'storyTitle'], ['CharactersScreen', 'charactersTitle'], ['PagesScreen', 'pagesTitle']]) {
      const source = render(screen); const header = source.slice(0, source.indexOf('    >'));
      expect(header).toContain(`title={editorMessage(language, '${key}')}`); expect(header).not.toContain('subtitle=');
    }
    expect(read('components/Section.tsx')).toContain('color: colors.primary');
    expect(read('constants/theme.ts')).toContain("border: 'rgba(229, 199, 107, 0.34)'");
  });
  it('Storyのscene人物chipsを隠してもhydrateと保存対象のIDを保持する', () => {
    const source = read('screens/StoryScreen.tsx'); expect(render('StoryScreen')).not.toContain('<EntityChips'); expect(render('StoryScreen')).not.toContain('use.one.full.story.draft');
    expect(source).toContain('setSceneEntityIds(selectedScene?.involved_entity_ids ?? [])'); expect(source.match(/involved_entity_ids: sceneEntityIds/g)).toHaveLength(2);
  });
  it('alias入力を隠し自由入力を作成内へ統合してもaliasと既存構造化値を保持する', () => {
    const source = read('screens/CharactersScreen.tsx'); const ui = render('CharactersScreen');
    expect(ui).not.toContain("setStructuredValue('aliases'"); expect(ui).not.toContain('persistKey="characters:description-save"');
    expect(ui.indexOf("editorMessage(language, 'additionalDetails')")).toBeGreaterThan(-1);
    expect(ui.indexOf("editorMessage(language, 'additionalDetails')")).toBeLessThan(ui.indexOf('</Section>', ui.indexOf('persistKey="characters:editor"')));
    expect(source).toContain('characterIdentity.aliases'); expect(source).toContain("assignArrayOrDelete(characterIdentity, 'aliases', draft.aliases ?? '', 12)");
    expect(source).toContain("gender_expression: readString(record, 'gender_expression')"); expect(source).toContain("age_range: readString(record, 'age_range')");
  });
  it('候補ダウンロード専用ボタンを減らしても明示confirmとimportを保持する', () => {
    const ui = render('CharactersScreen'); const source = read('screens/CharactersScreen.tsx');
    expect(ui).not.toContain('save.candidate.image'); expect(ui).toContain('<QuotedEntityImport'); expect(ui).toContain('confirmReferenceMutation.mutate()');
    expect(source).toContain('api.confirmEntityReference('); expect(source).toContain('buildSingleCandidateConfirmation(');
    expect(ui).not.toContain('creating.a.new.character.existing.charac'); expect(ui).not.toContain('imported.generated.and.confirmed.referen');
  });
  it('Pagesの二つの選択詳細はpageとpanelの両scopeでremountしコマ一覧は短い行にする', () => {
    const ui = render('PagesScreen');
    for (const component of ['AssignmentEditor', 'PanelDialogueEditor']) {
      const node = ui.slice(ui.indexOf(`<${component}`), ui.indexOf('/>', ui.indexOf(`<${component}`)));
      expect(node).toContain("key={`${selection.pageId ?? 'no-page'}:${panelId ?? 'new-panel'}`}");
    }
    const list = read('components/PanelOrderList.tsx'); const main = list.slice(list.indexOf('style={styles.rowMain}'), list.indexOf('</Pressable>', list.indexOf('style={styles.rowMain}')));
    expect(main).not.toContain('situationSummary'); expect(main).toContain('accessibilityRole="image"');
  });
});
