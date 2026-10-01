import type { z } from 'zod';
import type { pagePanelStructureRequestSchema, pagePanelStructureResponseSchema } from '@/domain/apiSchemas';
import type { PageRecord, PanelRecord } from '@/domain/types';

export type PanelStructureResult = z.infer<typeof pagePanelStructureResponseSchema>;
type PanelStructurePayload = z.infer<typeof pagePanelStructureRequestSchema>;
export type InsertPanelAfterPayload = PanelStructurePayload & {
  operation: Extract<PanelStructurePayload['operation'], { type: 'insert_after' }>;
};
export type PanelInsertionBlocker = 'permission' | 'selection' | 'dirty' | 'busy' | 'confirmed' | 'limit';
type OrderedPanel = Pick<PanelRecord, 'id' | 'order'>;
export const MAX_PAGE_PANELS = 8;

// The server owns blank defaults, ordering, frame replacement and balloon remapping.
// Never emulate insertion with separate append/reorder/frame requests.
export function buildPanelInsertionPayload(
  panels: readonly OrderedPanel[], selectedPanelId: string
): InsertPanelAfterPayload {
  const expectedPanelIds = [...panels].sort((left, right) => left.order - right.order).map((panel) => panel.id);
  if (expectedPanelIds.length >= MAX_PAGE_PANELS ||
      new Set(expectedPanelIds).size !== expectedPanelIds.length ||
      !expectedPanelIds.includes(selectedPanelId)) {
    throw new Error('Invalid panel insertion snapshot');
  }
  return { expected_panel_ids: expectedPanelIds, operation: { type: 'insert_after', panel_id: selectedPanelId } };
}

export function panelInsertionBlocker(input: {
  canEdit: boolean; pageId: string | null; selectedPanelId: string | null;
  panels: readonly OrderedPanel[] | undefined; dirty: boolean; busy: boolean;
  status: PageRecord['status'] | undefined;
}): PanelInsertionBlocker | null {
  if (!input.canEdit) return 'permission';
  if (input.busy || input.status === 'generating') return 'busy';
  if (input.status === 'confirmed') return 'confirmed';
  if (input.pageId === null || input.selectedPanelId === null || input.panels === undefined ||
      !input.panels.some((panel) => panel.id === input.selectedPanelId)) return 'selection';
  if (input.dirty) return 'dirty';
  if (input.panels.length >= MAX_PAGE_PANELS) return 'limit';
  return null;
}

// A late response must not move selection in a different workspace/page or replace
// an explicitly selected panel. Wait for authoritative content before selecting it.
export function canSelectInsertedPanel(input: {
  currentScope: string; requestScope: string; currentPanelId: string | null;
  selectedPanelId: string; createdPanelId: string; panels: readonly OrderedPanel[];
}): boolean {
  return input.currentScope === input.requestScope && input.currentPanelId === input.selectedPanelId &&
    input.panels.some((panel) => panel.id === input.createdPanelId);
}
