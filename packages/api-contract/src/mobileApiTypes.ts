export type UiLanguage = 'ja' | 'en';
export type StoryStatus = 'draft' | 'reviewing' | 'ready';
export type PageStatus = 'designing' | 'generating' | 'generated' | 'editing' | 'confirmed';
export type PageDialogueMode = 'image_baked' | 'balloon_only' | 'mixed';
export type EntityType = 'character' | 'nonhuman' | 'object';
export type GenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';
export type GenerationJobType = 'page_generate' | 'entity_generate' | 'episode_story_autofill' | 'episode_page_skeleton';

export interface WorkRecord {
  id: string;
  organization_id: string | null;
  title: string;
  genre: string | null;
  world_setting: string | null;
  theme: string | null;
  main_entity_ids: string[];
  starting_point: string | null;
  ending_point: string | null;
  overall_flow: string | null;
  version: number;
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
  story_input_mode: 'structured' | 'full';
  story_full_draft: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
  estimated_pages: number;
  entities_involved: string[];
  page_skeleton_generated: boolean;
  version: number;
  status: StoryStatus;
  created_at: string;
  updated_at: string;
}

export interface EntityRecord {
  id: string;
  work_id: string;
  entity_type: EntityType;
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
  cdn_url?: string | null;
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
  entity_states: { entity_id: string; state_id: string }[];
  status: StoryStatus;
  created_at: string;
  updated_at: string;
}

export interface EntityStateRecord {
  id: string;
  entity_id: string;
  scene_id: string | null;
  costume_note: string | null;
  costume_ref_id: string | null;
  condition_note: string | null;
  hair_note: string | null;
  expression_default: string;
  extra_note: string | null;
  created_at: string;
}

export interface GeneratedImageRecord {
  cdn_url?: string | null;
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

export type PageGenerationBlockerCode =
  | 'GENERATION_DISABLED'
  | 'FRAME_REQUIRED'
  | 'PANEL_REQUIRED'
  | 'FRAME_PANEL_MISMATCH'
  | 'PANEL_ORDER_INVALID'
  | 'DIALOGUE_SPEAKER_REQUIRED'
  | 'DIALOGUE_SPEAKER_NOT_IN_PANEL'
  | 'ASSIGNED_ENTITY_INVALID'
  | 'PAGE_GENERATING'
  | 'PAGE_REOPEN_REQUIRED'
  | 'CHARACTER_REFERENCE_REQUIRED'
  | 'REFERENCE_IMAGE_LIMIT_EXCEEDED'
  | 'ACTIVE_GENERATION_JOB'
  | 'INSUFFICIENT_CREDITS';

export interface PageGenerationBlockerRecord {
  code: PageGenerationBlockerCode;
  entity_id: string | null;
  field: 'generation' | 'frames' | 'panels' | 'entities' | 'dialogue' | 'status';
  action:
    | 'open_layout'
    | 'open_panels'
    | 'open_characters'
    | 'reopen_page'
    | 'wait_for_generation'
    | 'none';
  message_key: string;
}

export interface PageGenerationReadinessRecord {
  ready: boolean;
  blockers: PageGenerationBlockerRecord[];
  warnings: string[];
  estimated_credit_cost: number;
  page_revision: string;
}

export interface SaveAndGeneratePageResultRecord {
  job_id: string;
  page_revision: string;
}

export interface PageLayoutTemplateFrameRecord {
  vertices: { x: number; y: number }[];
  border_style: 'solid' | 'dashed' | 'none';
  border_width: number;
  border_color: string;
  z_index: number;
  reading_order: number;
}

export interface PageLayoutTemplateRecord {
  id: string;
  label_key: string;
  panel_count: number;
  reading_direction: 'right_to_left_top_to_bottom';
  preview_aspect_ratio: number;
  supported_page_sizes: ['normalized_portrait'];
  frames: PageLayoutTemplateFrameRecord[];
}

export interface PanelDialogueLine {
  entity_id: string | null;
  text: string;
  type: 'speech' | 'thought' | 'narration' | 'shout' | 'whisper' | 'sfx';
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export interface PanelEntityAssignmentRecord {
  entity_id: string;
  role: 'primary' | 'secondary' | 'background';
  expression: 'determined' | 'calm' | 'angry' | 'sad' | 'surprised' | 'custom';
  custom_expression: string | null;
  action: 'standing_firm' | 'attacking' | 'defending' | 'running' | 'custom';
  custom_action: string | null;
  position: 'left' | 'center' | 'right' | 'background';
  facing_direction: 'front' | 'left' | 'right' | 'away' | 'three_quarter_left' | 'three_quarter_right' | null;
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
  dialogue: PanelDialogueLine[];
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
  vertices: { x: number; y: number }[];
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
  font_family: 'manga_gothic' | 'mincho' | 'rounded' | 'bold';
  panel_order_reference: number | null;
  z_index: number;
}

export type GenerationJobCreditSettlementStatus =
  | 'not_charged'
  | 'charged'
  | 'refunded'
  | 'partially_refunded'
  | 'refund_pending';

export interface GenerationJobCreditSettlementRecord {
  charged_credits: number;
  refunded_credits: number;
  net_credits: number;
  status: GenerationJobCreditSettlementStatus;
}

export interface GenerationJobRecord {
  id: string;
  job_type: GenerationJobType;
  status: GenerationJobStatus;
  generation_mode: 'standard' | 'thinking' | null;
  credit_cost: number;
  credit_settlement: GenerationJobCreditSettlementRecord;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  error_code: string | null;
  message_key: string | null;
  retryable: boolean;
  support_id: string | null;
  progress_stage: 'queued' | 'compiling' | 'preparing_references' | 'generating' | 'saving' | 'completed' | null;
  progress_percent: number | null;
  progress_updated_at: string | null;
  updated_at: string;
  actions: {
    cancel: {
      available: boolean;
      reason_key: string | null;
    };
    hide: {
      available: boolean;
      reason_key: string | null;
    };
  };
  retry_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

export interface GenerationJobsResponseRecord {
  jobs: GenerationJobRecord[];
  next_cursor: string | null;
}

export interface PushTokenRegistrationRecord {
  status: 'registered';
  installation_id: string;
  platform: 'ios' | 'android';
}

export type ExportFormat = 'pdf' | 'zip';
export type ExportJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';

export interface CreateEpisodeExportPayload {
  format: ExportFormat;
  page_ids: string[];
  filename?: string;
}

export interface CreateEpisodeExportResultRecord {
  job_id: string;
  status: ExportJobStatus;
}

export interface ExportJobRecord {
  id: string;
  episode_id: string;
  format: ExportFormat;
  filename: string;
  status: ExportJobStatus;
  progress_stage: string;
  progress_percent: number;
  error_code: string | null;
  message_key: string | null;
  expires_at: string;
  completed_at: string | null;
  cancel_supported: false;
  cancel_reason_code: 'EXPORT_CANCEL_UNSUPPORTED' | null;
  /** Present only for a completed, non-expired export artifact. */
  download_url?: string;
}

export interface CompositionRecord {
  id: string;
  name: string;
  category: string;
  entity_count: number;
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
  plan_code: 'free' | 'standard' | 'premium' | 'enterprise_a' | 'enterprise_b' | 'enterprise_c';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  subscription_store: 'apple' | 'google' | null;
  scheduled_plan_code: 'standard' | 'premium' | null;
  scheduled_plan_effective_at: string | null;
  subscription_plans: {
    plan_code: 'standard' | 'premium' | 'enterprise_a' | 'enterprise_b' | 'enterprise_c';
    display_name_ja: string;
    display_name_en: string;
    monthly_credits: number;
    amount_jpy: number;
    minimum_contract_months: number;
    trial_days: number;
    is_enterprise: boolean;
    configured: boolean;
  }[];
}

export interface MobilePurchaseAccountBindingRecord {
  apple_app_account_token: string;
  google_obfuscated_account_id: string;
  subscription_purchase_allowed: boolean;
}

export interface MobileStoreProductCatalogRecord {
  store: 'apple' | 'google';
  products: {
    product_id: string;
    kind: 'subscription' | 'credit_pack';
    plan_code: 'standard' | 'premium' | null;
    credit_package_code: 'credits_200' | 'credits_1000' | 'credits_3000' | null;
  }[];
}

export interface EntityReferenceGenerationAvailabilityRecord {
  enabled: boolean;
}

export interface MobileStorePurchaseResultRecord {
  store: 'apple' | 'google';
  state: 'pending' | 'active' | 'cancelled' | 'expired' | 'refunded' | 'revoked' | 'failed';
  product_kind: 'subscription' | 'credit_pack';
  plan_code: 'standard' | 'premium' | null;
  credit_package_code: 'credits_200' | 'credits_1000' | 'credits_3000' | null;
  credits_changed: number;
  is_duplicate: boolean;
}

export interface MobileStoreRestoreResultRecord {
  purchases: MobileStorePurchaseResultRecord[];
}

export interface CurrentUserRecord {
  id: string;
  email: string;
  display_name: string | null;
  plan_code: string;
}

export interface CurrentUserCreditRecord {
  monthly_credits: number;
  purchased_credits: number;
  total_credits: number;
  monthly_expires_at: string | null;
}

export interface CurrentUserOrganizationRecord {
  id: string;
  name: string;
  status: string;
  plan_key: string;
  role: OrganizationRole;
  membership_status: string;
  monthly_credits: number;
  purchased_credits: number;
  total_credits: number;
  monthly_expires_at: string | null;
}

export interface CurrentSessionRecord {
  user: CurrentUserRecord;
  personal_credits: CurrentUserCreditRecord | null;
  organizations: CurrentUserOrganizationRecord[];
}

export type OrganizationRole = 'owner' | 'admin' | 'billing' | 'editor' | 'viewer';
export type OrganizationStatus = 'active' | 'trialing' | 'past_due' | 'suspended' | 'canceled';
export type OrganizationMemberStatus = 'invited' | 'active' | 'suspended' | 'removed';
export type OrganizationInvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type OrganizationInvitationSendStatus = 'not_sent' | 'sending' | 'sent' | 'failed';
export type OrganizationEnterprisePlanCode = 'enterprise_a' | 'enterprise_b' | 'enterprise_c';
export type OrganizationSubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired';

export interface OrganizationDetailRecord {
  id: string;
  type: 'business' | 'internal';
  name: string;
  legal_name: string | null;
  status: OrganizationStatus;
  plan_key: OrganizationEnterprisePlanCode;
  billing_email: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMemberRecord {
  id: string;
  organization_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role: OrganizationRole;
  status: OrganizationMemberStatus;
  invited_by_user_id: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationInvitationRecord {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  status: OrganizationInvitationStatus;
  send_status: OrganizationInvitationSendStatus;
  sent_at: string | null;
  last_sent_at: string | null;
  resend_count: number;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationCreditBalanceRecord {
  organization_id: string;
  monthly_credits: number;
  purchased_credits: number;
  total_credits: number;
  monthly_expires_at: string | null;
  updated_at: string;
}

export interface OrganizationWorkspaceDetailRecord {
  organization: OrganizationDetailRecord;
  membership: OrganizationMemberRecord;
  balance: OrganizationCreditBalanceRecord | null;
}

export interface OrganizationSubscriptionPlanRecord {
  plan_code: OrganizationEnterprisePlanCode;
  display_name_ja: string;
  display_name_en: string;
  monthly_credits: number;
  amount_jpy: number;
  minimum_contract_months: number;
  trial_days: number;
  is_enterprise: boolean;
  configured: boolean;
}

export interface OrganizationSubscriptionSummaryRecord {
  organization_id: string;
  plan_code: OrganizationEnterprisePlanCode;
  status: OrganizationSubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface OrganizationBillingSummaryRecord {
  workspace: OrganizationWorkspaceDetailRecord;
  subscription: OrganizationSubscriptionSummaryRecord | null;
  subscription_plans: OrganizationSubscriptionPlanRecord[];
}

export interface OrganizationInvoiceRecord {
  id: string;
  organization_id: string | null;
  kind: 'subscription' | 'credit_purchase';
  amount_jpy: number;
  status: 'paid' | 'failed';
  invoice_url: string | null;
  created_at: string;
}

export interface OrganizationUsageEventRecord {
  id: string;
  organization_id: string;
  user_id: string | null;
  work_id: string | null;
  event_type: string;
  credit_amount: number;
  created_at: string;
}

export interface OrganizationUsageSummaryItemRecord {
  key: string;
  credits: number;
}

export interface OrganizationUsageSummaryRecord {
  current_month_total_credits: number;
  by_member: OrganizationUsageSummaryItemRecord[];
  by_work: OrganizationUsageSummaryItemRecord[];
  by_generation_type: OrganizationUsageSummaryItemRecord[];
}

export interface OrganizationAuditLogRecord {
  id: string;
  organization_id: string;
  action: string;
  target_type: string;
  created_at: string;
}

export interface OrganizationCheckoutRecord {
  session_id?: string;
  package_code?: 'credits_200' | 'credits_1000' | 'credits_3000';
  url: string;
}

export interface OrganizationInvitationPreviewRecord {
  organization: {
    id: string;
    name: string;
  };
  invitation: {
    email: string;
    role: OrganizationRole;
    status: 'pending' | 'accepted' | 'revoked' | 'expired';
    expires_at: string;
  };
}

export interface OrganizationWorkspaceRecord {
  organization: {
    id: string;
    name: string;
    status: string;
    plan_key: string;
  };
  membership: {
    role: OrganizationRole;
    status: string;
  };
  balance: {
    monthly_credits: number;
    purchased_credits: number;
    total_credits: number;
    monthly_expires_at: string | null;
  } | null;
}

export interface AccountDeletionPreviewRecord {
  personal_data: {
    account: 'anonymized';
    personal_works: 'deleted';
    organization_memberships: 'removed';
  };
  unique_owner_organizations: {
    id: string;
    name: string;
  }[];
  active_personal_subscription_count: number;
  active_stripe_subscription_count: number;
  active_mobile_store_subscription_count: number;
  confirmed_personal_asset_count: number;
}

export type AccountDeletionBlockerRecord =
  | {
      code: 'UNIQUE_ORGANIZATION_OWNER';
      organizations: { id: string; name: string }[];
    }
  | {
      code: 'ACTIVE_PERSONAL_SUBSCRIPTION';
      subscription_count: number;
    }
  | {
      code: 'CONFIRMED_PERSONAL_ASSETS';
      asset_count: number;
    };

export type AccountDeletionResultRecord =
  | { status: 'blocked'; blockers: AccountDeletionBlockerRecord[] }
  | { status: 'in_progress'; blockers: [] }
  | {
      status: 'pending_external_action';
      blockers: [];
      next_action:
        | 'cancel_subscription'
        | 'disable_identity'
        | 'delete_identity'
        | 'schedule_asset_lifecycle'
        | 'anonymize_personal_data';
    }
  | { status: 'completed'; blockers: [] };

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

export type PageSkeletonResultRecord =
  | {
      job_id: string;
      queued: true;
      story_plan_applied: boolean;
    }
  | {
      pages_created: number;
      panels_created: number;
      replaced_existing: boolean;
      story_plan_applied: boolean;
      story_plan_job_id: string | null;
    };

export interface StoryEpisodeImprovementRecord {
  draft: {
    title: string | null;
    purpose: string | null;
    story_input_mode: 'structured' | 'full';
    story_full_draft: string | null;
    introduction: string | null;
    middle: string | null;
    climax: string | null;
    ending_hook: string | null;
  };
  compiler_provider: 'openai' | 'fallback';
  compiler_model: string | null;
  compiler_prompt_version: string | null;
  compiler_error: string | null;
}

export interface AuthTokens {
  idToken: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  tokenType: string | null;
}

export interface PersistedWorkspaceSelection {
  workId: string | null;
  chapterId: string | null;
  episodeId: string | null;
  pageId: string | null;
  entityId: string | null;
  organizationId: string | null;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}
