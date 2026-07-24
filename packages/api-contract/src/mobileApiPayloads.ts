import type {
  EntityType,
  OrganizationEnterprisePlanCode,
  OrganizationMemberStatus,
  OrganizationRole,
  PageDialogueMode,
  PanelDialogueLine,
  PanelEntityAssignmentRecord,
  PanelRecord
} from '@/domain/types';

export interface UpdateOrganizationPayload {
  name?: string;
  legal_name?: string | null;
  billing_email?: string | null;
}

/** Mirrors the bounded public organization-creation contract. */
export interface CreateOrganizationPayload {
  name: string;
}

export interface CreateOrganizationInvitationPayload {
  email: string;
  role: OrganizationRole;
}

export interface UpdateOrganizationMemberPayload {
  role?: OrganizationRole;
  status?: Exclude<OrganizationMemberStatus, 'invited'>;
}

export interface CreateOrganizationSubscriptionCheckoutPayload {
  plan_code: OrganizationEnterprisePlanCode;
}

export interface CreateOrganizationCreditCheckoutPayload {
  package_code: 'credits_200' | 'credits_1000' | 'credits_3000';
}

export interface VerifyAppleMobilePurchasePayload {
  signed_transaction: string;
  environment: 'sandbox' | 'production';
}

export interface VerifyGoogleMobilePurchasePayload {
  purchase_token: string;
}

export interface RestoreMobilePurchasesPayload {
  apple_signed_transactions: string[];
  google_purchase_tokens: string[];
}

export interface PushTokenRegistrationPayload {
  installation_id: string;
  platform: 'ios' | 'android';
  device_token: string;
  locale: 'ja' | 'en';
}

export interface CreateWorkPayload {
  title: string;
  genre: string | null;
  world_setting: string | null;
  theme: string | null;
  main_entity_ids: string[];
  starting_point: string | null;
  ending_point: string | null;
  overall_flow: string | null;
}

export type UpdateWorkPayload = Partial<CreateWorkPayload> & {
  expected_updated_at: string;
  status?: 'draft' | 'reviewing' | 'ready';
};

export interface CreateChapterPayload {
  order: number;
  title: string | null;
  purpose: string | null;
  starting_state: string | null;
  ending_state: string | null;
  emotion_curve: string | null;
  entities_involved: string[];
  key_beats: string[];
}

export type UpdateChapterPayload = Partial<CreateChapterPayload> & {
  expected_updated_at: string;
  status?: 'draft' | 'reviewing' | 'ready';
};

export interface CreateEpisodePayload {
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
}

export type UpdateEpisodePayload = Partial<CreateEpisodePayload> & {
  expected_updated_at: string;
  status?: 'draft' | 'reviewing' | 'ready';
};

export interface CreateEntityPayload {
  entity_type: EntityType;
  name: string;
  free_description: string | null;
  prompt_supplement: string | null;
  structured_fields: Record<string, unknown>;
  speech_profile: Record<string, unknown>;
}

export type UpdateEntityPayload = Partial<CreateEntityPayload> & {
  expected_updated_at: string;
  status?: 'draft' | 'ready';
};

export type EntityReferenceUploadMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface CreateEntityReferenceUploadPayload {
  mime_type: EntityReferenceUploadMimeType;
  size_bytes: number;
  entity_id?: string;
}

export interface ImportEntityImageBase64Payload {
  image_base64: string;
  entity_type: EntityType;
  entity_id?: string;
}

export interface ImportEntityImageUploadTokenPayload {
  upload_token: string;
  entity_type: EntityType;
  entity_id?: string;
}

export type ImportEntityImagePayload =
  | ImportEntityImageBase64Payload
  | ImportEntityImageUploadTokenPayload;

export interface GeneratePageSkeletonPayload {
  overwrite_existing?: boolean;
  apply_story_plan?: boolean;
  language?: 'ja' | 'en';
}

export interface CreateScenePayload {
  order: number;
  location: string | null;
  time: string | null;
  atmosphere: string | null;
  involved_entity_ids: string[];
}

export type UpdateScenePayload = Partial<CreateScenePayload> & {
  status?: 'draft' | 'reviewing' | 'ready';
};

export interface CreateEntityStatePayload {
  scene_id: string | null;
  costume_note: string | null;
  costume_ref_id: string | null;
  condition_note: string | null;
  hair_note: string | null;
  expression_default: string;
  extra_note: string | null;
}

export type UpdateEntityStatePayload = Partial<CreateEntityStatePayload>;

export interface UpdatePagePayload {
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

export interface CreatePanelPayload {
  order: number;
  panel_role: PanelRecord['panel_role'];
  panel_size: PanelRecord['panel_size'];
  situation_text: string | null;
  composition: PanelRecord['composition'];
  dialogue_in_panel: boolean;
  dialogue: PanelDialogueLine[];
  sfx_text: string | null;
  background_note: string | null;
  panel_notes: string | null;
}

export type UpdatePanelPayload = Partial<CreatePanelPayload>;

export interface ReplacePanelAssignmentsPayload {
  entities: PanelEntityAssignmentRecord[];
}

export interface ApplyPageLayoutTemplatePayload {
  template_id: string;
  allow_panel_truncation: boolean;
}

export interface ConfirmEntityReferencePayload {
  selected_s3_keys?: string[];
  selected_candidate_tokens?: string[];
  primary_s3_key?: string;
  primary_candidate_token?: string;
  prompt_supplement?: string | null;
}
