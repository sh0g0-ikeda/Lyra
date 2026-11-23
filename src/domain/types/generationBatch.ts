import type { PageRenderStyle } from './pageGeneration.js';

export type GenerationBatchStatus =
  | 'quoted'
  | 'running'
  | 'paused'
  | 'needs_review'
  | 'completed'
  | 'cancelled';

export type GenerationBatchItemKind = 'entity_base' | 'entity_state' | 'page';
export type GenerationBatchItemStatus =
  | 'pending'
  | 'active'
  | 'confirming'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'needs_review';

export type GenerationBatchBlockerCode =
  | 'TARGET_NOT_READY'
  | 'TARGET_ALREADY_GENERATED'
  | 'DEPENDENCY_NOT_READY'
  | 'INPUT_CHANGED'
  | 'PRICE_CHANGED'
  | 'MODEL_CHANGED'
  | 'INSUFFICIENT_CREDITS'
  | 'CAPACITY_WAIT'
  | 'CHILD_FAILED'
  | 'CONFIRMATION_CONFLICT'
  | 'SCOPE_LOST';

export interface GenerationBatchBlocker {
  code: GenerationBatchBlockerCode;
  item_id: string | null;
  target_id: string | null;
  message: string;
  retryable: boolean;
}

export interface GenerationBatchQuotedItem {
  item_id: string;
  kind: GenerationBatchItemKind;
  label: string;
  status: GenerationBatchItemStatus;
  target_id: string;
  entity_id: string | null;
  depends_on_item_id: string | null;
  job_id: string | null;
  input_revision: string;
  operation: 'entity_preview' | 'entity_state_preview' | 'page_generate';
  image_model: string;
  provider_model_id: string;
  render_style: PageRenderStyle | null;
  amount_credits: number;
  pricing_version: string;
}

export interface GenerationBatchProgress {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  active: number;
  pending: number;
}

export interface GenerationBatchQuoteRequestBody {
  work_id: string;
  kind: 'character_references' | 'pages';
  episode_id?: string;
  selection: 'missing_only';
  render_style: PageRenderStyle;
}

export interface GenerationBatchAcceptRequestBody {
  request_key: string;
  auto_confirm: true;
}

export interface GenerationBatchResumeRequestBody {
  request_key: string;
}

export interface GenerationBatchCapabilitiesResponse {
  enabled: boolean;
  image_model: string;
  selections: readonly ['missing_only'];
  render_styles: readonly PageRenderStyle[];
  max_items: number;
  quote_ttl_seconds: number;
}

export interface GenerationBatchResponse {
  batch_id: string;
  work_id: string;
  kind: 'character_references' | 'pages';
  episode_id: string | null;
  status: GenerationBatchStatus;
  selection: 'missing_only';
  render_style: PageRenderStyle;
  image_model: string;
  pricing_version: string;
  maximum_credits: number;
  auto_confirm: boolean;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  progress: GenerationBatchProgress;
  items: GenerationBatchQuotedItem[];
  blockers: GenerationBatchBlocker[];
  active_job_ids: string[];
}

export interface GenerationBatchListResponse {
  batches: GenerationBatchResponse[];
}

export interface GenerationBatchCancelResponse {
  batch: GenerationBatchResponse;
  active_job_ids: string[];
}

export interface GenerationBatchApprovedItem {
  id: string;
  position: number;
  kind: GenerationBatchItemKind;
  label: string;
  targetId: string;
  entityId: string | null;
  dependsOnItemId: string | null;
  inputRevision: string;
  operation: GenerationBatchQuotedItem['operation'];
  imageModel: string;
  providerModelId: string;
  renderStyle: PageRenderStyle | null;
  amountCredits: number;
  pricingVersion: string;
  approvedRequest: Record<string, unknown>;
  approvedInput: Record<string, unknown>;
}

export interface GenerationBatchRecord {
  id: string;
  userId: string;
  organizationId: string | null;
  workId: string;
  episodeId: string | null;
  kind: 'character_references' | 'pages';
  status: GenerationBatchStatus;
  selection: 'missing_only';
  renderStyle: PageRenderStyle;
  imageModel: string;
  pricingVersion: string;
  maximumCredits: number;
  autoConfirm: boolean;
  expiresAt: Date;
  acceptedAt: Date | null;
  requestKey: string | null;
  blockers: GenerationBatchBlocker[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerationBatchItemRecord extends GenerationBatchApprovedItem {
  batchId: string;
  status: GenerationBatchItemStatus;
  childQuoteId: string | null;
  jobId: string | null;
  confirmation: Record<string, unknown> | null;
  blocker: GenerationBatchBlocker | null;
}

