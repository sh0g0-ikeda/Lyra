import { describe, expect, it } from 'vitest';

import {
  PanelInsertionError,
  PanelInsertionOperationError,
  buildEmptyPanelPayload,
  buildFramesForInsertedPanel,
  buildPanelInsertionPlan,
  executePanelInsertion,
  getPanelAppendOrder,
  inferPanelInsertionRecovery,
  recoverPanelInsertion
} from '@/domain/panelInsertion';
import type { PanelFrameRecord, PanelRecord } from '@/domain/types';

const panel = (id: string, order: number): PanelRecord => ({
  id,
  page_id: 'page-1',
  order,
  panel_role: 'action',
  panel_size: 'standard',
  situation_text: '既存入力',
  entities: [],
  composition: {
    source: 'ai_auto',
    gallery_item_id: null,
    composition_prompt: null,
    shot_type: null,
    angle: null,
    custom_note: null
  },
  dialogue_in_panel: true,
  dialogue: [],
  sfx_text: null,
  background_note: null,
  panel_notes: null,
  created_at: '2026-09-06T00:00:00.000Z',
  updated_at: '2026-09-06T00:00:00.000Z'
});

describe('選択中コマの直後への追加', () => {
  it('APIには末尾の安全な順序で作成し、作成後は選択中コマの直後へ並べる', () => {
    const plan = buildPanelInsertionPlan(
      [panel('panel-c', 3), panel('panel-a', 1), panel('panel-b', 2)],
      'panel-b',
      'panel-new'
    );

    expect(plan.appendOrder).toBe(4);
    expect(plan.reorderedPanelIds).toEqual([
      'panel-a',
      'panel-b',
      'panel-new',
      'panel-c'
    ]);
  });

  it('新規コマは選択中コマの下書きを複製しない', () => {
    expect(buildEmptyPanelPayload(3)).toEqual({
      order: 3,
      panel_role: 'action',
      panel_size: 'standard',
      situation_text: null,
      composition: {
        source: 'ai_auto',
        gallery_item_id: null,
        composition_prompt: null,
        shot_type: null,
        angle: null,
        custom_note: null
      },
      dialogue_in_panel: true,
      dialogue: [],
      sfx_text: null,
      background_note: null,
      panel_notes: null
    });
  });

  it('選択が最新一覧にない場合は追加しない', () => {
    expect(() =>
      buildPanelInsertionPlan([panel('panel-a', 1)], 'stale-panel', 'panel-new')
    ).toThrowError(
      expect.objectContaining<Partial<PanelInsertionError>>({
        code: 'SELECTED_PANEL_NOT_FOUND'
      })
    );
  });

  it('20コマあるページにはAPI上限を超えて追加しない', () => {
    const panels = Array.from({ length: 20 }, (_, index) => panel(`panel-${index + 1}`, index + 1));
    expect(() => getPanelAppendOrder(panels, 'panel-1')).toThrowError(
      expect.objectContaining<Partial<PanelInsertionError>>({ code: 'PANEL_LIMIT_REACHED' })
    );
  });

  it('作成済みIDが一覧と重複する場合は並べ替えを作らない', () => {
    expect(() =>
      buildPanelInsertionPlan([panel('panel-a', 1)], 'panel-a', 'panel-a')
    ).toThrowError(
      expect.objectContaining<Partial<PanelInsertionError>>({
        code: 'CREATED_PANEL_DUPLICATE'
      })
    );
  });

  it('選択中の横長枠を二分し既存枠を失わず新しいコマへ結び付ける', () => {
    const frame = (id: string, panelId: string, order: number): PanelFrameRecord => ({
      id,
      page_id: 'page-1',
      panel_id: panelId,
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 0.4 },
        { x: 0, y: 0.4 }
      ],
      border_style: 'solid',
      border_width: 3,
      border_color: '#000000',
      z_index: order,
      reading_order: order
    });
    const frames = buildFramesForInsertedPanel(
      [frame('frame-a', 'panel-a', 1), frame('frame-b', 'panel-b', 2)],
      'panel-a',
      'panel-new',
      'frame-new'
    );

    expect(frames.map((item) => item.panel_id)).toEqual([
      'panel-a',
      'panel-new',
      'panel-b'
    ]);
    expect(frames.map((item) => item.reading_order)).toEqual([1, 2, 3]);
    expect(frames[0]?.vertices).toEqual([
      { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 0.5, y: 0.4 }
    ]);
    expect(frames[1]?.vertices).toEqual([
      { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.4 }, { x: 0, y: 0.4 }
    ]);
    expect(frames[2]?.id).toBe('frame-b');
    expect(frames[2]?.z_index).toBe(2);
  });

  it('不正または面積のない枠はコマ作成前に拒否する', async () => {
    let created = false;
    await expect(executePanelInsertion({
      panels: [panel('panel-a', 1)],
      frames: [{
        id: 'frame-a', page_id: 'page-1', panel_id: 'panel-a',
        vertices: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
        border_style: 'solid', border_width: 3, border_color: '#000000', z_index: 1, reading_order: 1
      }],
      selectedPanelId: 'panel-a', createFrameId: () => 'frame-new',
      saveDrafts: async () => undefined,
      createPanel: async () => { created = true; return panel('panel-new', 2); },
      reorderPanels: async () => undefined,
      replaceFrames: async () => undefined
    })).rejects.toEqual(expect.objectContaining<Partial<PanelInsertionError>>({ code: 'INVALID_FRAME_SET' }));
    expect(created).toBe(false);
  });

  it('枠が一つだけ不足した状態を推定して既存コマを増やさず修復する', async () => {
    const panels = [panel('panel-a', 1), panel('panel-new', 2)];
    const frames: PanelFrameRecord[] = [{
      id: 'frame-a', page_id: 'page-1', panel_id: 'panel-a',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      border_style: 'solid', border_width: 3, border_color: '#000000', z_index: 1, reading_order: 1
    }];
    const recovery = inferPanelInsertionRecovery(panels, frames, 'frame-new');
    expect(recovery).toEqual({ createdPanelId: 'panel-new', selectedPanelId: 'panel-a', createdFrameId: 'frame-new' });
    const calls: string[] = [];
    const repaired = await recoverPanelInsertion({
      panels, frames, recovery: recovery!,
      reorderPanels: async (ids) => { calls.push(`reorder:${ids.join(',')}`); },
      replaceFrames: async (next) => { calls.push(`frames:${next.map((frame) => frame.panel_id).join(',')}`); }
    });
    expect(repaired.id).toBe('panel-new');
    expect(calls).toEqual(['reorder:panel-a,panel-new', 'frames:panel-a,panel-new']);
  });

  it('復旧用の分割が不正なら並べ替え前に停止する', async () => {
    const panels = [panel('panel-a', 1), panel('panel-new', 2)];
    const frames: PanelFrameRecord[] = [{
      id: 'frame-a', page_id: 'page-1', panel_id: 'panel-a',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.00015 }, { x: 0, y: 0.00015 }],
      border_style: 'solid', border_width: 3, border_color: '#000000', z_index: 1, reading_order: 1
    }];
    let reordered = false;
    let replaced = false;
    await expect(recoverPanelInsertion({
      panels,
      frames,
      recovery: { createdPanelId: 'panel-new', selectedPanelId: 'panel-a', createdFrameId: 'frame-new' },
      reorderPanels: async () => { reordered = true; },
      replaceFrames: async () => { replaced = true; }
    })).rejects.toEqual(expect.objectContaining<Partial<PanelInsertionError>>({ code: 'INVALID_FRAME_SET' }));
    expect(reordered).toBe(false);
    expect(replaced).toBe(false);
  });

  it('選択中コマに対応する枠がなければ既存枠を変更しない', () => {
    expect(() =>
      buildFramesForInsertedPanel([], 'panel-a', 'panel-new', 'frame-new')
    ).toThrowError(
      expect.objectContaining<Partial<PanelInsertionError>>({
        code: 'SELECTED_FRAME_NOT_FOUND'
      })
    );
  });

  it('下書き保存・空コマ作成・並べ替え・枠保存を順番に行う', async () => {
    const calls: string[] = [];
    const existingPanel = panel('panel-a', 1);
    const existingFrame: PanelFrameRecord = {
      id: 'frame-a',
      page_id: 'page-1',
      panel_id: 'panel-a',
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ],
      border_style: 'solid',
      border_width: 3,
      border_color: '#000000',
      z_index: 1,
      reading_order: 1
    };

    const created = await executePanelInsertion({
      panels: [existingPanel],
      frames: [existingFrame],
      selectedPanelId: 'panel-a',
      createFrameId: () => 'frame-new',
      saveDrafts: async () => { calls.push('save'); },
      createPanel: async (payload) => {
        calls.push(`create:${payload.order}:${payload.situation_text ?? 'empty'}`);
        return panel('panel-new', 2);
      },
      reorderPanels: async (ids) => { calls.push(`reorder:${ids.join(',')}`); },
      replaceFrames: async (frames) => {
        calls.push(`frames:${frames.map((frame) => frame.panel_id).join(',')}`);
      }
    });

    expect(created.id).toBe('panel-new');
    expect(calls).toEqual([
      'save',
      'create:2:empty',
      'reorder:panel-a,panel-new',
      'frames:panel-a,panel-new'
    ]);
  });

  it('並べ替えに失敗した場合は枠を保存せず失敗段階を返す', async () => {
    const existingPanel = panel('panel-a', 1);
    const existingFrame: PanelFrameRecord = {
      id: 'frame-a',
      page_id: 'page-1',
      panel_id: 'panel-a',
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ],
      border_style: 'solid',
      border_width: 3,
      border_color: '#000000',
      z_index: 1,
      reading_order: 1
    };
    let replaced = false;

    await expect(executePanelInsertion({
      panels: [existingPanel],
      frames: [existingFrame],
      selectedPanelId: 'panel-a',
      createFrameId: () => 'frame-new',
      saveDrafts: async () => undefined,
      createPanel: async () => panel('panel-new', 2),
      reorderPanels: async () => { throw new Error('conflict'); },
      replaceFrames: async () => { replaced = true; }
    })).rejects.toEqual(
      expect.objectContaining<Partial<PanelInsertionOperationError>>({ phase: 'reorder' })
    );
    expect(replaced).toBe(false);
  });
});
