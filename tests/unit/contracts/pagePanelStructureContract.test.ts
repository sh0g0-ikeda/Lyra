import { describe, expect, it } from 'vitest';
import { pagePanelStructureRequestSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { applyPagePanelStructureBodySchema } from '../../../src/lib/validators/pagePanelStructure.schema.js';

const panelIds = Array.from({ length: 9 }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

describe('Page panel structure request contract', () => {
  it('Mobile共有契約とサーバー検証は同じschemaを使う', () => {
    expect(applyPagePanelStructureBodySchema).toBe(pagePanelStructureRequestSchema);
  });

  it.each([
    { type: 'append' },
    { type: 'insert_after', panel_id: panelIds[0] },
    { type: 'delete', panel_id: panelIds[0] },
    { type: 'reorder', panel_ids: panelIds.slice(0, 2).reverse() },
  ])('既存操作と直後追加の厳格な要求を受理する: %j', (operation) => {
    expect(pagePanelStructureRequestSchema.safeParse({
      expected_panel_ids: panelIds.slice(0, 2), operation,
    }).success).toBe(true);
  });

  it.each([
    { expected_panel_ids: [panelIds[0], panelIds[0]], operation: { type: 'insert_after', panel_id: panelIds[0] } },
    { expected_panel_ids: panelIds, operation: { type: 'insert_after', panel_id: panelIds[0] } },
    { expected_panel_ids: [panelIds[0]], operation: { type: 'insert_after' } },
    { expected_panel_ids: [panelIds[0]], operation: { type: 'insert_after', panel_id: 'not-a-uuid' } },
    { expected_panel_ids: [panelIds[0]], operation: { type: 'insert_after', panel_id: panelIds[0], entities: [] } },
    { expected_panel_ids: [panelIds[0]], operation: { type: 'insert_after', panel_id: panelIds[0] }, panel_notes: 'not allowed' },
    { expected_panel_ids: [panelIds[0]], operation: { type: 'reorder', panel_ids: [panelIds[0], panelIds[0]] } },
  ])('不正なsnapshotやクライアント指定の空でない内容を拒否する: %j', (request) => {
    expect(pagePanelStructureRequestSchema.safeParse(request).success).toBe(false);
  });
});
