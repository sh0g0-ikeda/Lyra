import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const mobileRoot = resolve(__dirname, '..');

const readMobileSource = (relativePath: string): string =>
  readFileSync(resolve(mobileRoot, relativePath), 'utf8');

describe('モバイルページ編集UIの表示契約', () => {
  it('構図ソース選択UIを表示せず既存の構図ソースを保存payloadへ保持する', () => {
    const source = readMobileSource('src/screens/PagesScreen.tsx');

    expect(source).not.toContain('panelCompositionSourceOptions');
    expect(source).not.toContain('<CompositionPicker');
    expect(source).not.toContain('generated.screens.PagesScreen.composition.source.1a1a1e08');
    expect(source).toContain("const [compositionSource, setCompositionSource] = useState<PanelRecord['composition']['source']>('ai_auto')");
    expect(source).toContain('setCompositionSource(selectedPanel?.composition.source ?? defaultComposition.source)');
    expect(source).toContain('source: compositionSource');
  });

  it('既存キャラは閉じた状態で始まり追加キャラだけを直後に展開する', () => {
    const source = readMobileSource('src/screens/PagesScreen.tsx');

    expect(source).toContain('() => new Set<string>()');
    expect(source).toContain('setExpandedEntityIds((current) => new Set([...current, entityId]))');
    expect(source).toContain("key={selectedPanel?.id ?? 'new-panel'}");
  });

  it('ページ編集の背景と階層UIに高コントラストの専用色を定義する', () => {
    const theme = readMobileSource('src/constants/theme.ts');
    const pagesScreen = readMobileSource('src/screens/PagesScreen.tsx');

    expect(theme).toContain("editorCanvas: '#050505'");
    expect(theme).toContain("editorSurface: '#292D34'");
    expect(theme).toContain("editorSection: '#1C2026'");
    expect(theme).toContain("editorCharacter: '#252A31'");
    expect(theme).toContain("editorControl: '#343A44'");
    expect(theme).toContain("editorText: '#FFFFFF'");
    expect(theme).toContain("editorMuted: '#D0D3D8'");
    expect(theme).toContain("editorBorder: '#5A5138'");
    expect(pagesScreen).toContain('contentStyle={styles.editorScreenContent}');
    expect(pagesScreen.match(/tone="raised"/g)).toHaveLength(2);
  });
});
