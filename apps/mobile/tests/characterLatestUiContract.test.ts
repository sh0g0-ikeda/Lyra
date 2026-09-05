import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('MOB-ENTITY-002 latest character UI contract', () => {
  it('新しいキャラクターを独立ボタンではなく選択肢として表示する', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');
    const renderSource = source.slice(source.indexOf('  return (\n    <Screen'));

    expect(source).toContain("const NEW_ENTITY_PICKER_ID = 'new-entity'");
    expect(renderSource).toContain('id: NEW_ENTITY_PICKER_ID');
    expect(renderSource).toContain('onSelect={selectEntityPickerOption}');
    expect(renderSource).not.toContain(
      'label={t(language, "generated.screens.CharactersScreen.new.character.899f7080")}'
    );
  });

  it('renders list, name, type, import, description/save, and references in order within unified character details', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');
    const renderSource = source.slice(source.indexOf('  return (\n    <Screen'));
    const orderedMarkers = [
      'persistKey="characters:list"',
      "label={t(language, 'name')}",
      '<SegmentedControl onChange={setEntityType}',
      "onLayout={recordSectionOffset('import')}",
      'persistKey="characters:reference-set"'
    ];
    const positions = orderedMarkers.map((marker) => renderSource.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('keeps the free-input and save controls inside the character editor', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');
    const renderSource = source.slice(source.indexOf('  return (\n    <Screen'));
    const editorStart = renderSource.indexOf('persistKey="characters:editor"');
    const editorEnd = renderSource.indexOf('</Section>', editorStart);
    const editor = renderSource.slice(editorStart, editorEnd);

    expect(renderSource).not.toContain('persistKey="characters:description-save"');
    expect(editor).toContain("label={t(language, 'screen.characters.freeInput.label')}");
    expect(editor).toContain('onChangeText={setDescription}');
    expect(editor).toContain('createEntityMutation.isPending');
    expect(editor).toContain('updateEntityMutation.isPending');
  });

  it('hides aliases and nonhuman/object structured fields without dropping their stored data', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');
    const renderSource = source.slice(source.indexOf('  return (\n    <Screen'));

    expect(renderSource).not.toContain('CharactersScreen.aliases.658c65b6');
    expect(renderSource).not.toContain('activeFieldKeys.map((key) => (');
    expect(source).toContain("assignArrayOrDelete(characterIdentity, 'aliases', draft.aliases ?? '', 12);");
    expect(source).toContain('const genericStructuredFields = safeParseRecord(extras);');
    expect(source).toContain('const structuredExtrasFromRecord = (');
    expect(source).toContain(': JSON.stringify(record);');
  });

  it('uses confirmation instead of saving a candidate image, while keeping confirmed-image saves', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');
    const renderSource = source.slice(source.indexOf('  return (\n    <Screen'));

    expect(renderSource).not.toContain('save.candidate.image.9e676bff');
    expect(renderSource).toContain("label={t(language, 'confirmReference')}");
    expect(renderSource).not.toContain(
      'generated.screens.CharactersScreen.editing.the.selected.character.9454ccd6',
    );
    expect(source).toContain('filename: `lyra-character-reference-${refId}.png`');
  });

  it('keeps AI-only and deprecated detail fields out of rendered UI', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');
    const renderSource = source.slice(source.indexOf('  return (\n    <Screen'));

    expect(renderSource).not.toContain('promptSupplement');
    expect(renderSource).not.toContain('visual_anchor');
    expect(renderSource).not.toContain('reappearance_anchor');
    expect(renderSource).not.toContain('silhouette_keywords');
    expect(renderSource).not.toContain('distinguishing_features');
    expect(renderSource).not.toContain(
      'generated.screens.CharactersScreen.speech.profile.84432725'
    );
  });

  it('uses the required Japanese import and free-input guidance', () => {
    const translations = readSource('src/lib/i18nGenerated.ts');

    expect(translations).toContain(
      'アップロードした画像のキャラクターを漫画に登場させられます！'
    );
    expect(translations).toContain(
      '選択肢にない特徴などを記入出来ます'
    );
    expect(translations).toContain('すべての項目を埋める必要はありません');
  });

  it('個別のキャラクター画像は共有シートではなく写真ライブラリへ保存する', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');

    expect(source).toContain(
      "import { appendOrganizationQuery, saveAuthenticatedImageToPhotoLibrary } from '@/lib/download';"
    );
    expect(source).toContain('saveAuthenticatedImageToPhotoLibrary({');
    expect(source).toContain('filename: `lyra-character-reference-${refId}.png`');
    expect(source).not.toContain('filename: `lyra-character-candidate-${candidateToken.trim()}.png`');
    expect(source).not.toContain('downloadAuthenticatedFile({');
  });
});
