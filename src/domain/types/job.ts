import type {
  PageGenerationMode,
  PageGenerationQuality,
  PageGenerationRequestKind,
} from './pageGeneration.js';

export type GenerationJobType =
  | 'page_generate'
  | 'entity_generate'
  | 'entity_import_analysis'
  | 'episode_story_autofill'
  | 'episode_page_skeleton';
export type GenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface PageGenerationJobParams {
  pageId: string;
  requestKind: PageGenerationRequestKind;
  generationMode: PageGenerationMode;
  quality: PageGenerationQuality;
  requiresPlanner: boolean;
}

export interface GenerationJobCreditSettlement { chargedCredits: number; refundedCredits: number; netCredits: number; status: 'not_charged' | 'charged' | 'refunded' | 'partially_refunded' | 'refund_pending'; }

export interface GenerationJob {
  id: string;
  userId: string;
  organizationId?: string | null;
  jobType: GenerationJobType;
  status: GenerationJobStatus;
  generationMode: PageGenerationMode | null;
  creditCost: number;
  creditSettlement?: GenerationJobCreditSettlement;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  sqsMessageId: string | null;
  openaiRequestId: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  cancelRequestedAt: Date | null;
  cancelRequestedBy: string | null;
  cancelledAt: Date | null;
  commitStartedAt: Date | null;
}
