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

  it('renders list, name, type, import, description/save, and references in order', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');
    const renderSource = source.slice(source.indexOf('  return (\n    <Screen'));
    const orderedMarkers = [
      'persistKey="characters:list"',
      "label={t(language, 'name')}",
      '<SegmentedControl onChange={setEntityType}',
      "onLayout={recordSectionOffset('import')}",
      'persistKey="characters:description-save"',
      'persistKey="characters:reference-set"'
    ];
    const positions = orderedMarkers.map((marker) => renderSource.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('keeps AI-only and deprecated detail fields out of rendered UI', () => {
    const source = readSource('src/screens/CharactersScreen.tsx');
    const renderSource = source.slice(source.indexOf('  return (\n    <Screen'));

    expect(renderSource).not.toContain('promptSupplement');
    expect(renderSource).not.toContain('visual_anchor');
    expect(renderSource).not.toContain('reappearance_anchor');
    expect(renderSource).not.toContain('silhouette_keywords');
    expect(renderSource).not.toContain('distinguishing_features');
  });

  it('uses the required Japanese import and free-description guidance', () => {
    const translations = readSource('src/lib/i18nGenerated.ts');

    expect(translations).toContain(
      '手元のキャラクター画像をアップロードすると、その見た目を参考にLyraの漫画へ登場させられます。'
    );
    expect(translations).toContain(
      '選択肢にない特徴や、特別に守りたい条件を書いてください'
    );
    expect(translations).toContain('すべての空欄を埋める必要はありません');
  });
});
