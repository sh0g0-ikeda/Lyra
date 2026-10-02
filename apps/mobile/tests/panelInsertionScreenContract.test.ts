import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { panelInsertionMessage } from '@/lib/panelInsertionMessages';
const screen = readFileSync(fileURLToPath(new URL('../src/screens/PagesScreen.tsx', import.meta.url)), 'utf8');

describe('panel insertion screen wiring', () => {
  it('保存済みコマの選択を原子挿入へ渡し、入力をコピーする旧作成CTAを表示しない', () => {
    expect(screen).toContain('const panelInsertion = usePanelInsertion({');
    expect(screen).toContain('selectedPanelId: panelId');
    expect(screen).toContain('dirty: pageDirty || panelDirty || framesDirty');
    expect(screen).toContain('onPress={confirmInsertPanelAfter}');
    expect(screen).not.toContain('onPress={() => createPanelMutation.mutate()}');
    expect(screen).toContain('void panelInsertion.reload();');
    expect(screen).toContain('selectedPanel === null || panelInsertion.operationActive');
  });
  it('日英に元の追加ラベルと原子APIの8コマ制限・結果不明時の再読込を明示する', () => {
    expect(panelInsertionMessage('ja', 'action')).toBe('このコマの後ろに追加');
    expect(panelInsertionMessage('en', 'action')).toBe('Add a panel after this');
    expect(panelInsertionMessage('ja', 'limit')).toContain('8個');
    expect(panelInsertionMessage('en', 'limit')).toContain('8 panels');
    expect(panelInsertionMessage('ja', 'failed')).toContain('追加し直す前に');
    expect(panelInsertionMessage('ja', 'refreshFailed')).toContain('コマを追加しました');
    expect(panelInsertionMessage('ja', 'checking')).not.toContain('追加しました');
  });
});
