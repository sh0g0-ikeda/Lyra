import type { ApplyPageLayoutTemplatePayload } from '@/domain/payloads';

export const createSafeLayoutTemplatePayload = (
  templateId: string
): ApplyPageLayoutTemplatePayload => ({
  template_id: templateId,
  allow_panel_truncation: false
});

export const selectExcessPanels = <Panel extends { order: number }>(
  panels: readonly Panel[],
  targetPanelCount: number
): Panel[] =>
  [...panels]
    .sort((left, right) => left.order - right.order)
    .slice(Math.max(0, targetPanelCount));
