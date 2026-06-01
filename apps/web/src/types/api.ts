export type StoryStatus = 'draft' | 'reviewing' | 'ready';
export type PageStatus = 'designing' | 'generating' | 'generated' | 'editing' | 'confirmed';
export type PageDialogueMode = 'image_baked' | 'balloon_only' | 'mixed';
export type GenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type GenerationJobType = 'page_generate' | 'entity_generate';

export interface WorkRecord {
  id: string;
  user_id: string;
  title: string;
  genre: string | null;
  world_setting: string | null;
  theme: string | null;
  main_entity_ids: string[];
  starting_point: string | null;
  ending_point: string | null;
  overall_flow: string | null;
  version: number;
  edit_history: Record<string, unknown>[];
  status: StoryStatus;
  created_at: string;
  updated_at: string;
}

export interface ChapterRecord {
  id: string;
  work_id: string;
  order: number;
  title: string | null;
  purpose: string | null;
  starting_state: string | null;
  ending_state: string | null;
  emotion_curve: string | null;
  entities_involved: string[];
  key_beats: string[];
  version: number;
  edit_history: Record<string, unknown>[];
  status: StoryStatus;
  created_at: string;
  updated_at: string;
}

export interface EpisodeRecord {
  id: string;
  chapter_id: string;
  order: number;
  title: string | null;
  purpose: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  estimated_pages: number;
  entities_involved: string[];
  page_skeleton_generated: boolean;
  version: number;
  edit_history: Record<string, unknown>[];
  status: StoryStatus;
  created_at: string;
  updated_at: string;
}

export interface EntityRecord {
  id: string;
  work_id: string;
  user_id: string;
  entity_type: 'character' | 'nonhuman' | 'object';
  name: string;
  free_description: string | null;
  structured_fields: Record<string, unknown>;
  prompt_supplement: string | null;
  speech_profile: Record<string, unknown>;
  status: 'draft' | 'ready';
  created_at: string;
  updated_at: string;
}

export interface EntityReferenceImageRecord {
  ref_id: string;
  s3_key: string;
  cdn_url: string;
  source: 'upload' | 'generated';
  created_at: string;
}

export interface EntityReferenceSetRecord {
  entity_id: string;
  primary_ref_id: string | null;
  status: 'empty' | 'partial' | 'ready';
  updated_at: string;
  reference_images: EntityReferenceImageRecord[];
}

export interface SceneRecord {
  id: string;
  episode_id: string;
  order: number;
  location: string | null;
  time: string | null;
  atmosphere: string | null;
  involved_entity_ids: string[];
  entity_states: Array<{
    entity_id: string;
    state_id: string;
  }>;
  status: StoryStatus;
  created_at: string;
  updated_at: string;
}

export interface GeneratedImageRecord {
  s3_key: string | null;
  cdn_url: string | null;
  generation_mode: 'standard' | 'thinking' | null;
  generated_at: string | null;
}

export interface PageRecord {
  id: string;
  episode_id: string;
  page_number: number;
  layout_config: Record<string, unknown>;
  story_source_scene_ids: string[];
  story_page_purpose: string | null;
  story_continuity_note: string | null;
  dialogue_mode: PageDialogueMode;
  page_dialogue_toggle: boolean;
  generation_mode: 'standard' | 'thinking' | null;
  generated_image: GeneratedImageRecord | null;
  status: PageStatus;
  panel_count: number;
  frame_count: number;
  balloon_count: number;
  created_at: string;
  updated_at: string;
}

export interface PanelEntityAssignmentRecord {
  entity_id: string;
  role: 'primary' | 'secondary' | 'background';
  expression: 'determined' | 'calm' | 'angry' | 'sad' | 'surprised' | 'custom';
  custom_expression: string | null;
  action: 'standing_firm' | 'attacking' | 'defending' | 'running' | 'custom';
  custom_action: string | null;
  position: 'left' | 'center' | 'right' | 'background';
  facing_direction:
    | 'front'
    | 'left'
    | 'right'
    | 'away'
    | 'three_quarter_left'
    | 'three_quarter_right'
    | null;
  effect_note: string | null;
  state_id: string | null;
}

export interface PanelRecord {
  id: string;
  page_id: string;
  order: number;
  panel_role: 'establish' | 'action' | 'reaction' | 'emphasis' | 'transition' | 'pause' | 'impact';
  panel_size: 'standard' | 'large' | 'wide' | 'narrow' | 'splash';
  situation_text: string | null;
  entities: PanelEntityAssignmentRecord[];
  composition: {
    source: 'gallery' | 'custom' | 'ai_auto';
    gallery_item_id: string | null;
    composition_prompt: string | null;
    shot_type: string | null;
    angle: string | null;
    custom_note: string | null;
  };
  dialogue_in_panel: boolean;
  dialogue: Array<{
    entity_id: string | null;
    text: string;
    type: 'speech' | 'thought' | 'narration' | 'shout' | 'whisper' | 'sfx';
    position: 'top' | 'bottom' | 'left' | 'right' | 'center';
  }>;
  sfx_text: string | null;
  background_note: string | null;
  panel_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PanelFrameRecord {
  id: string;
  page_id: string;
  panel_id: string | null;
  vertices: Array<{ x: number; y: number }>;
  border_style: 'solid' | 'dashed' | 'none';
  border_width: number;
  border_color: string;
  z_index: number;
  reading_order: number;
}

export interface BalloonRecord {
  id: string;
  page_id: string;
  speaker_entity_id: string | null;
  balloon_type: 'speech' | 'thought' | 'narration' | 'shout' | 'whisper';
  writing_mode: 'horizontal' | 'vertical';
  text: string;
  position: { x: number; y: number; width: number; height: number };
  tail: {
    base_x: number;
    base_y: number;
    tip_x: number;
    tip_y: number;
  } | null;
  font_size: number;
  font_family: string;
  panel_order_reference: number | null;
  z_index: number;
}

export interface GenerationJobRecord {
  id: string;
  job_type: GenerationJobType;
  status: GenerationJobStatus;
  generation_mode: 'standard' | 'thinking' | null;
  credit_cost: number;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

export interface CompositionRecord {
  id: string;
  name: string;
  category: string;
  entity_count: number;
  preview_s3_key: string | null;
  preview_cdn_url: string | null;
  composition_prompt: string;
  shot_type: string | null;
  angle: string | null;
  tags: string[];
  created_at: string;
}

export interface BillingBalanceRecord {
  monthly_credits: number;
  purchased_credits: number;
  total_credits: number;
  monthly_expires_at: string | null;
}

export interface StoryCollaborationInput {
  layer: 'work' | 'chapter' | 'episode';
  target_id: string;
  instruction: string;
  context: {
    current_draft?: string | null;
    selected_text?: string | null;
    user_notes?: string | null;
    focus_points?: string[];
    constraints?: string[];
  };
}

export interface StoryEpisodeImprovementRecord {
  draft: {
    title: string | null;
    purpose: string | null;
    introduction: string | null;
    middle: string | null;
    climax: string | null;
    ending_hook: string | null;
  };
  compiler_provider: 'anthropic' | 'hybrid' | 'fallback';
  compiler_model: string | null;
  compiler_prompt_version: string | null;
  compiler_error: string | null;
}
