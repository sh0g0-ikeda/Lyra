import { describe, expect, it } from 'vitest';
import { buildPanelInsertionPayload, panelInsertionBlocker, canSelectInsertedPanel } from '@/domain/panelInsertion';

const panels = [{ id: 'b', order: 2 }, { id: 'a', order: 1 }];
const ready = { canEdit: true, pageId: 'page', selectedPanelId: 'a', panels, dirty: false, busy: false, status: 'designing' as const };

describe('atomic panel insertion', () => {
  it('選択したコマの後ろに空のコマを作る命令だけを送る', () => {
    expect(buildPanelInsertionPayload(panels, 'a')).toEqual({
      expected_panel_ids: ['a', 'b'], operation: { type: 'insert_after', panel_id: 'a' }
    });
    expect(panels.map((panel) => panel.id)).toEqual(['b', 'a']);
  });
  it('選択なし・重複・上限・範囲外の選択を送信前に拒否する', () => {
    expect(() => buildPanelInsertionPayload(panels, 'gone')).toThrow();
    expect(() => buildPanelInsertionPayload([...panels, panels[0]!], 'a')).toThrow();
    expect(() => buildPanelInsertionPayload(Array.from({ length: 8 }, (_, order) => ({ id: `p${order}`, order })), 'p0')).toThrow();
  });
  it('未保存・処理中・権限・生成中・確定済み・未読込・選択不整合では追加しない', () => {
    expect(panelInsertionBlocker(ready)).toBeNull();
    expect(panelInsertionBlocker({ ...ready, dirty: true })).toBe('dirty');
    expect(panelInsertionBlocker({ ...ready, busy: true })).toBe('busy');
    expect(panelInsertionBlocker({ ...ready, canEdit: false })).toBe('permission');
    expect(panelInsertionBlocker({ ...ready, status: 'generating' })).toBe('busy');
    expect(panelInsertionBlocker({ ...ready, status: 'confirmed' })).toBe('confirmed');
    expect(panelInsertionBlocker({ ...ready, panels: undefined })).toBe('selection');
    expect(panelInsertionBlocker({ ...ready, selectedPanelId: 'gone' })).toBe('selection');
    expect(panelInsertionBlocker({ ...ready, pageId: null })).toBe('selection');
    expect(panelInsertionBlocker({ ...ready, panels: Array.from({ length: 8 }, (_, order) => ({ id: order === 0 ? 'a' : `p${order}`, order })) })).toBe('limit');
  });
  it('新コマの取得完了前・別ページや法人への移動後・別コマ選択後に選択を奪わない', () => {
    const input = { currentScope: 'scope-a', requestScope: 'scope-a', currentPanelId: 'a', selectedPanelId: 'a', createdPanelId: 'c', panels: [...panels, { id: 'c', order: 2 }] };
    expect(canSelectInsertedPanel(input)).toBe(true);
    expect(canSelectInsertedPanel({ ...input, currentScope: 'scope-b' })).toBe(false);
    expect(canSelectInsertedPanel({ ...input, currentPanelId: 'b' })).toBe(false);
    expect(canSelectInsertedPanel({ ...input, panels })).toBe(false);
  });
});
