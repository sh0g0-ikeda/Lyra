import type {
  PageGenerationMode,
  PageGenerationQuality,
  PageGenerationRequestKind,
} from './pageGeneration.js';

export type GenerationJobType =
  | 'page_generate'
  | 'entity_generate'
  | 'episode_story_autofill'
  | 'episode_page_skeleton';
export type GenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';

export const MAX_GENERATION_JOB_CREDIT_SETTLEMENT_CREDITS = 2_147_483_647;

export type GenerationJobCreditSettlementStatus =
  | 'not_charged'
  | 'charged'
  | 'refunded'
  | 'partially_refunded'
  | 'refund_pending';

export interface GenerationJobCreditSettlement {
  chargedCredits: number;
  refundedCredits: number;
  netCredits: number;
  status: GenerationJobCreditSettlementStatus;
}

export function createGenerationJobCreditSettlement(
  status: GenerationJobStatus,
  chargedCredits: number,
  refundedCredits: number,
): GenerationJobCreditSettlement {
  const charged = toBoundedCreditAmount(chargedCredits);
  const refunded = Math.min(charged, toBoundedCreditAmount(refundedCredits));
  const netCredits = charged - refunded;

  if (charged === 0) {
    return { chargedCredits: 0, refundedCredits: 0, netCredits: 0, status: 'not_charged' };
  }
  if (netCredits === 0) {
    return { chargedCredits: charged, refundedCredits: refunded, netCredits, status: 'refunded' };
  }
  if (refunded > 0) {
    return { chargedCredits: charged, refundedCredits: refunded, netCredits, status: 'partially_refunded' };
  }
  if (status === 'failed' || status === 'canceled') {
    return { chargedCredits: charged, refundedCredits: 0, netCredits, status: 'refund_pending' };
  }
  return { chargedCredits: charged, refundedCredits: 0, netCredits, status: 'charged' };
}

function toBoundedCreditAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(MAX_GENERATION_JOB_CREDIT_SETTLEMENT_CREDITS, Math.floor(value));
}

export interface PageGenerationJobParams {
  pageId: string;
  requestKind: PageGenerationRequestKind;
  generationMode: PageGenerationMode;
  quality: PageGenerationQuality;
  requiresPlanner: boolean;
}

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
  cancelRequestedAt?: Date | null;
  cancelRequestedByUserId?: string | null;
  retryCount: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
}
