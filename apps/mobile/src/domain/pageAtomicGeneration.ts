import type {
  PageDialogueMode,
  PageRecord,
  PanelEntityAssignmentRecord,
  PanelFrameRecord,
  PanelRecord
} from '@/domain/types';

export type AtomicPagePayloadErrorCode =
  | 'PAGE_INPUT_REQUIRED'
  | 'PANEL_OVERRIDE_NOT_FOUND'
  | 'PANEL_ID_DUPLICATE'
  | 'PANEL_ORDER_INVALID'
  | 'PANEL_PAGE_MISMATCH'
  | 'PANEL_FRAME_MISMATCH'
  | 'FRAME_READING_ORDER_INVALID'
  | 'FRAME_PAGE_MISMATCH';

export class AtomicPagePayloadError extends Error {
  public readonly code: AtomicPagePayloadErrorCode;

  public constructor(code: AtomicPagePayloadErrorCode, message: string) {
    super(message);
    this.name = 'AtomicPagePayloadError';
    this.code = code;
  }
}

export interface AtomicPagePatch {
  dialogue_mode?: PageDialogueMode;
  page_dialogue_toggle?: boolean;
  style_reference?: {
    title: string;
    notes?: string | null;
  } | null;
  story_source_scene_ids?: string[];
  story_page_purpose?: string | null;
  story_continuity_note?: string | null;
}

export interface AtomicPanelEditableFields {
  panel_role: PanelRecord['panel_role'];
  panel_size: PanelRecord['panel_size'];
  situation_text: string | null;
  entities: PanelEntityAssignmentRecord[];
  composition: PanelRecord['composition'];
  dialogue_in_panel: boolean;
  dialogue: PanelRecord['dialogue'];
  sfx_text: string | null;
  background_note: string | null;
  panel_notes: string | null;
}

export interface AtomicPanelInput extends AtomicPanelEditableFields {
  id: string;
  order: number;
}

export interface AtomicFrameInput {
  panel_id: string;
  vertices: { x: number; y: number }[];
  border_style: PanelFrameRecord['border_style'];
  border_width: number;
  border_color: string;
  z_index: number;
  reading_order: number;
}

export interface AtomicSaveAndGeneratePayload {
  expected_updated_at: string;
  page: {
    dialogue_mode: PageDialogueMode;
    page_dialogue_toggle: boolean;
    style_reference?: AtomicPagePatch['style_reference'];
    story_source_scene_ids: string[];
    story_page_purpose: string | null;
    story_continuity_note: string | null;
  };
  panels: AtomicPanelInput[];
  frames: AtomicFrameInput[];
  generation: {
    language: 'ja' | 'en';
  };
}

interface BuildAtomicSaveAndGeneratePayloadInput {
  page: PageRecord;
  pagePatch: AtomicPagePatch;
  panels: readonly PanelRecord[];
  selectedPanelOverride: {
    panelId: string;
    fields: AtomicPanelEditableFields;
  } | null;
  frames: readonly PanelFrameRecord[];
  language: 'ja' | 'en';
}

const panelFields = (panel: AtomicPanelEditableFields): AtomicPanelEditableFields => ({
  panel_role: panel.panel_role,
  panel_size: panel.panel_size,
  situation_text: panel.situation_text,
  entities: panel.entities,
  composition: panel.composition,
  dialogue_in_panel: panel.dialogue_in_panel,
  dialogue: panel.dialogue,
  sfx_text: panel.sfx_text,
  background_note: panel.background_note,
  panel_notes: panel.panel_notes
});

const assertContiguousOrders = (
  orders: readonly number[],
  code: 'PANEL_ORDER_INVALID' | 'FRAME_READING_ORDER_INVALID',
  label: string
): void => {
  const sorted = [...orders].sort((left, right) => left - right);
  const valid = sorted.every((order, index) => order === index + 1);
  if (!valid) {
    throw new AtomicPagePayloadError(code, `${label} must be unique and contiguous from 1.`);
  }
};

export const buildAtomicSaveAndGeneratePayload = (
  input: BuildAtomicSaveAndGeneratePayloadInput
): AtomicSaveAndGeneratePayload => {
  if (input.panels.length === 0 || input.frames.length === 0) {
    throw new AtomicPagePayloadError('PAGE_INPUT_REQUIRED', 'At least one panel and frame are required.');
  }

  const panelIds = new Set<string>();
  input.panels.forEach((panel) => {
    if (panel.page_id !== input.page.id) {
      throw new AtomicPagePayloadError('PANEL_PAGE_MISMATCH', 'Every panel must belong to the selected page.');
    }
    if (panelIds.has(panel.id)) {
      throw new AtomicPagePayloadError('PANEL_ID_DUPLICATE', 'Panel IDs must be unique.');
    }
    panelIds.add(panel.id);
  });
  assertContiguousOrders(
    input.panels.map((panel) => panel.order),
    'PANEL_ORDER_INVALID',
    'Panel order'
  );

  if (
    input.selectedPanelOverride !== null &&
    !panelIds.has(input.selectedPanelOverride.panelId)
  ) {
    throw new AtomicPagePayloadError(
      'PANEL_OVERRIDE_NOT_FOUND',
      'The selected panel draft does not belong to the selected page.'
    );
  }

  if (input.frames.length !== input.panels.length) {
    throw new AtomicPagePayloadError(
      'PANEL_FRAME_MISMATCH',
      'Every panel must have exactly one frame.'
    );
  }

  const framePanelIds = new Set<string>();
  input.frames.forEach((frame) => {
    if (frame.page_id !== input.page.id) {
      throw new AtomicPagePayloadError('FRAME_PAGE_MISMATCH', 'Every frame must belong to the selected page.');
    }
    if (
      frame.panel_id === null ||
      !panelIds.has(frame.panel_id) ||
      framePanelIds.has(frame.panel_id)
    ) {
      throw new AtomicPagePayloadError(
        'PANEL_FRAME_MISMATCH',
        'Every panel must have exactly one matching frame.'
      );
    }
    framePanelIds.add(frame.panel_id);
  });
  if ([...panelIds].some((panelId) => !framePanelIds.has(panelId))) {
    throw new AtomicPagePayloadError(
      'PANEL_FRAME_MISMATCH',
      'Every panel must have exactly one matching frame.'
    );
  }
  assertContiguousOrders(
    input.frames.map((frame) => frame.reading_order),
    'FRAME_READING_ORDER_INVALID',
    'Frame reading order'
  );

  const panels = input.panels
    .map<AtomicPanelInput>((panel) => ({
      id: panel.id,
      order: panel.order,
      ...panelFields(
        input.selectedPanelOverride?.panelId === panel.id
          ? input.selectedPanelOverride.fields
          : panel
      )
    }))
    .sort((left, right) => left.order - right.order);

  const frames = input.frames
    .map<AtomicFrameInput>((frame) => ({
      panel_id: frame.panel_id as string,
      vertices: frame.vertices,
      border_style: frame.border_style,
      border_width: frame.border_width,
      border_color: frame.border_color,
      z_index: frame.z_index,
      reading_order: frame.reading_order
    }))
    .sort((left, right) => left.reading_order - right.reading_order);

  return {
    expected_updated_at: input.page.updated_at,
    page: {
      dialogue_mode: input.pagePatch.dialogue_mode ?? input.page.dialogue_mode,
      page_dialogue_toggle:
        input.pagePatch.page_dialogue_toggle ?? input.page.page_dialogue_toggle,
      ...(input.pagePatch.style_reference === undefined
        ? {}
        : { style_reference: input.pagePatch.style_reference }),
      story_source_scene_ids:
        input.pagePatch.story_source_scene_ids ?? input.page.story_source_scene_ids,
      story_page_purpose:
        input.pagePatch.story_page_purpose ?? input.page.story_page_purpose,
      story_continuity_note:
        input.pagePatch.story_continuity_note ?? input.page.story_continuity_note
    },
    panels,
    frames,
    generation: {
      language: input.language
    }
  };
};
