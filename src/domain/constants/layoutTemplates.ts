export const LAYOUT_TEMPLATES = {
  standard_4: { panelCount: 4 },
  top_wide_3: { panelCount: 3 },
  standard_6: { panelCount: 6 },
  dense_8: { panelCount: 8 },
  climax_2: { panelCount: 2 },
  splash_1: { panelCount: 1 },
  action_5: { panelCount: 5 },
  battle_7: { panelCount: 7 },
} as const;

export type LayoutTemplateId = keyof typeof LAYOUT_TEMPLATES;

export const DEFAULT_LAYOUT_TEMPLATE_ID: LayoutTemplateId = 'standard_4';
