import { describe, expect, it } from 'vitest';
import {
  calculatePageGenerationCreditCost,
  getEntityReferenceGenerationBlockers,
  getPageGenerationBlockers,
  getReferenceConfirmationBlockers,
  getStoryApplyBlockers,
} from '../../../apps/web/src/lib/generationReadiness.js';
import type {
  EntityRecord,
  PageRecord,
  PanelFrameRecord,
  PanelEntityAssignmentRecord,
  PanelRecord,
} from '../../../apps/web/src/types/api.js';

describe('generationReadiness', () => {
  it('ページ生成で確定画像のない登場キャラを案内する', () => {
    const blockers = getPageGenerationBlockers({
      page: pageRecord({ status: 'designing', panel_count: 1, frame_count: 1 }),
      panels: [panelRecord({ entities: [panelEntityAssignment({ entity_id: 'entity-1' })] })],
      frames: [frameRecord()],
      entities: [entityRecord({ id: 'entity-1', name: '蓮', status: 'draft' })],
      activePageJob: null,
      availableCredits: 10,
    });

    expect(blockers.map((blocker) => blocker.code)).toContain('page.missing_character_references');
    expect(blockers[0]?.detail.ja).toContain('蓮');
  });

  it('ページ生成でコマ数とコマ枠数の不一致を案内する', () => {
    const blockers = getPageGenerationBlockers({
      page: pageRecord({ status: 'designing', panel_count: 2, frame_count: 1 }),
      panels: [panelRecord({ id: 'panel-1' }), panelRecord({ id: 'panel-2' })],
      frames: [frameRecord()],
      entities: [],
      activePageJob: null,
      availableCredits: 10,
    });

    expect(blockers.map((blocker) => blocker.code)).toContain('page.frame_panel_mismatch');
  });

  it('ページ生成で確定済みページの再オープンを案内する', () => {
    const blockers = getPageGenerationBlockers({
      page: pageRecord({ status: 'confirmed', panel_count: 1, frame_count: 1 }),
      panels: [panelRecord()],
      frames: [frameRecord()],
      entities: [],
      activePageJob: null,
      availableCredits: 10,
    });

    expect(blockers.map((blocker) => blocker.code)).toContain('page.confirmed');
  });

  it('話全体反映でページ未作成と確定済みページを案内する', () => {
    const noPageBlockers = getStoryApplyBlockers({
      episodeSelected: true,
      pages: [],
      activeStoryJob: null,
      activeSkeletonJob: null,
    });
    const confirmedPageBlockers = getStoryApplyBlockers({
      episodeSelected: true,
      pages: [pageRecord({ status: 'confirmed' })],
      activeStoryJob: null,
      activeSkeletonJob: null,
    });

    expect(noPageBlockers.map((blocker) => blocker.code)).toContain('story.pages_missing');
    expect(confirmedPageBlockers.map((blocker) => blocker.code)).toContain('story.confirmed_pages');
  });

  it('キャラプレビュー生成でキャラ未選択とクレジット不足を案内する', () => {
    const noEntityBlockers = getEntityReferenceGenerationBlockers({
      entity: null,
      activeEntityJob: null,
      availableCredits: 10,
    });
    const creditBlockers = getEntityReferenceGenerationBlockers({
      entity: entityRecord({ id: 'entity-1', status: 'draft' }),
      activeEntityJob: null,
      availableCredits: 0,
    });

    expect(noEntityBlockers.map((blocker) => blocker.code)).toContain('entity.not_selected');
    expect(creditBlockers.map((blocker) => blocker.code)).toContain('entity.insufficient_credits');
  });

  it('レファレンス確定でメイン画像未選択と候補未選択を案内する', () => {
    const blockers = getReferenceConfirmationBlockers({
      selectedCandidateTokens: [],
      primaryCandidateToken: '',
    });

    expect(blockers.map((blocker) => blocker.code)).toContain('reference.no_primary');
    expect(blockers.map((blocker) => blocker.code)).toContain('reference.no_selection');
  });

  it('ページ生成の概算クレジットは4人目以降で増える', () => {
    expect(calculatePageGenerationCreditCost(0)).toBe(3);
    expect(calculatePageGenerationCreditCost(3)).toBe(3);
    expect(calculatePageGenerationCreditCost(4)).toBe(4);
  });
});

function entityRecord(input: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: input.id ?? 'entity-1',
    work_id: input.work_id ?? 'work-1',
    entity_type: input.entity_type ?? 'character',
    name: input.name ?? 'キャラ',
    free_description: input.free_description ?? null,
    structured_fields: input.structured_fields ?? {},
    prompt_supplement: input.prompt_supplement ?? null,
    speech_profile: input.speech_profile ?? {},
    status: input.status ?? 'ready',
    created_at: input.created_at ?? '2026-07-23T00:00:00.000Z',
    updated_at: input.updated_at ?? '2026-07-23T00:00:00.000Z',
  };
}

function pageRecord(input: Partial<PageRecord> = {}): PageRecord {
  return {
    id: input.id ?? 'page-1',
    episode_id: input.episode_id ?? 'episode-1',
    page_number: input.page_number ?? 1,
    layout_config: input.layout_config ?? {},
    story_source_scene_ids: input.story_source_scene_ids ?? [],
    story_page_purpose: input.story_page_purpose ?? null,
    story_continuity_note: input.story_continuity_note ?? null,
    dialogue_mode: input.dialogue_mode ?? 'image_baked',
    page_dialogue_toggle: input.page_dialogue_toggle ?? true,
    generation_mode: input.generation_mode ?? null,
    generated_image: input.generated_image ?? null,
    status: input.status ?? 'designing',
    panel_count: input.panel_count ?? 1,
    frame_count: input.frame_count ?? 1,
    balloon_count: input.balloon_count ?? 0,
    created_at: input.created_at ?? '2026-07-23T00:00:00.000Z',
    updated_at: input.updated_at ?? '2026-07-23T00:00:00.000Z',
  };
}

function panelRecord(input: Partial<PanelRecord> = {}): PanelRecord {
  return {
    id: input.id ?? 'panel-1',
    page_id: input.page_id ?? 'page-1',
    order: input.order ?? 1,
    panel_role: input.panel_role ?? 'establish',
    panel_size: input.panel_size ?? 'standard',
    situation_text: input.situation_text ?? '状況',
    entities: input.entities ?? [],
    composition: input.composition ?? {
      source: 'ai_auto',
      gallery_item_id: null,
      composition_prompt: null,
      shot_type: null,
      angle: null,
      custom_note: null,
    },
    dialogue_in_panel: input.dialogue_in_panel ?? true,
    dialogue: input.dialogue ?? [],
    sfx_text: input.sfx_text ?? null,
    background_note: input.background_note ?? null,
    panel_notes: input.panel_notes ?? null,
    created_at: input.created_at ?? '2026-07-23T00:00:00.000Z',
    updated_at: input.updated_at ?? '2026-07-23T00:00:00.000Z',
  };
}

function panelEntityAssignment(input: Partial<PanelEntityAssignmentRecord> = {}): PanelEntityAssignmentRecord {
  return {
    entity_id: input.entity_id ?? 'entity-1',
    role: input.role ?? 'primary',
    expression: input.expression ?? 'calm',
    custom_expression: input.custom_expression ?? null,
    action: input.action ?? 'standing_firm',
    custom_action: input.custom_action ?? null,
    position: input.position ?? 'center',
    facing_direction: input.facing_direction ?? 'front',
    effect_note: input.effect_note ?? null,
    state_id: input.state_id ?? null,
  };
}

function frameRecord(input: Partial<PanelFrameRecord> = {}): PanelFrameRecord {
  return {
    id: input.id ?? 'frame-1',
    page_id: input.page_id ?? 'page-1',
    panel_id: input.panel_id ?? null,
    vertices: input.vertices ?? [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    border_style: input.border_style ?? 'solid',
    border_width: input.border_width ?? 2,
    border_color: input.border_color ?? '#111111',
    z_index: input.z_index ?? 1,
    reading_order: input.reading_order ?? 1,
  };
}
