import type {
  PageGenerationMode,
  PageGenerationQuality,
  PageGenerationRequestKind,
} from './pageGeneration.js';

export type GenerationJobType = 'page_generate' | 'entity_generate' | 'episode_story_autofill';
export type GenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

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
  jobType: GenerationJobType;
  status: GenerationJobStatus;
  generationMode: PageGenerationMode | null;
  creditCost: number;
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
}
