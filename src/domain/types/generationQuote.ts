import type { PageGenerationLayoutControl } from './pageGenerationLayout.js';
import type { EntityType } from './entity.js';
import type { EntityReferenceContext } from './entityReference.js';
import type { EntityStateReferenceContext } from './entityStateReference.js';
import type { EntityReferenceUploadMimeType } from '../constants/entityReferenceUpload.js';
import type { PageGenerationInputSnapshot, PageGenerationMode, PageRenderStyle } from './pageGeneration.js';

export type GenerationQuoteOperation = 'page_generate' | 'page_regenerate'
  | 'entity_preview' | 'entity_state_preview' | 'entity_import_analysis';

export interface GenerationQuoteRequest {
  operation: GenerationQuoteOperation;
  targetId?: string;
  entityId?: string;
  uploadTokenHash?: string;
  entityType?: EntityType;
  imageModel?: string;
  quality?: string;
  renderStyle?: PageRenderStyle;
  expectedRevision?: string;
  sourceRefId?: string;
  /** Server-decoded, authenticated candidate metadata; never a client storage key. */
  sourceCandidate?: { s3Key: string; expiresAt: number };
}

export interface QuotedCandidateSource {
  kind: 'candidate';
  s3Key: string;
  expiresAt: number;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  sha256: string;
}

export type PreparedGenerationQuoteSource = QuotedImportSource | QuotedCandidateSource | null;

export interface QuotedImportSource {
  uploadId: string;
  tokenHash: string;
  s3Key: string;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  eTag: string;
  sha256: string;
  entityId: string | null;
}

export type GenerationQuoteSnapshot =
  | { kind: 'page'; prompt: { layoutControl?: PageGenerationLayoutControl | null; workId: string; draftPrompt: string; compilerBrief: string; inputSnapshot: PageGenerationInputSnapshot }; layoutConfig: Record<string, unknown> }
  | { kind: 'entity'; entity: EntityReferenceContext; state: EntityStateReferenceContext | null; sourceS3Key: string | null; sourceImage?: QuotedCandidateSource }
  | { kind: 'import'; source: QuotedImportSource; entityType: EntityType };

export interface GenerationQuotePlan {
  operation: GenerationQuoteOperation;
  targetId: string;
  workId: string | null;
  inputRevision: string;
  imageModel: string | null;
  providerModelId: string;
  quality: 'medium' | null;
  renderStyle: PageRenderStyle | null;
  referenceCount: number;
  amountCredits: number;
  pricingVersion: string;
  generationMode: PageGenerationMode | null;
  jobParams: Record<string, unknown>;
  snapshot: GenerationQuoteSnapshot;
}

export interface GenerationQuote {
  id: string;
  userId: string;
  organizationId: string | null;
  request: GenerationQuoteRequest;
  plan: GenerationQuotePlan;
  expiresAt: Date;
  acceptedJobId: string | null;
  requestKey: string | null;
  acceptedAt: Date | null;
}

export interface GenerationQuoteReceipt {
  quote: GenerationQuote;
  jobStatus: string | null;
  chargedCredits: number;
  refundedCredits: number;
}
