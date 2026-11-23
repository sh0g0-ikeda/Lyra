// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.
import { z } from 'zod';

export const generationBatchKindSchema = z.enum(['character_references', 'pages']);
export const generationBatchRenderStyleSchema = z.enum(['color', 'monochrome']);
export const generationBatchStatusSchema = z.enum([
  'quoted',
  'running',
  'paused',
  'needs_review',
  'completed',
  'cancelled',
]);
export const generationBatchItemKindSchema = z.enum(['entity_base', 'entity_state', 'page']);
export const generationBatchItemStatusSchema = z.enum([
  'pending',
  'active',
  'confirming',
  'completed',
  'skipped',
  'failed',
  'cancelled',
  'needs_review',
]);

export const generationBatchCapabilitiesSchema = z.object({
  enabled: z.boolean(),
  image_model: z.string().min(1),
  selections: z.array(z.literal('missing_only')),
  render_styles: z.array(generationBatchRenderStyleSchema),
  max_items: z.number().int().positive(),
  quote_ttl_seconds: z.number().int().positive(),
}).strict();

export const generationBatchQuoteRequestSchema = z.object({
  work_id: z.string().uuid(),
  kind: generationBatchKindSchema,
  episode_id: z.string().uuid().optional(),
  selection: z.literal('missing_only'),
  render_style: generationBatchRenderStyleSchema,
}).strict().superRefine((value, context) => {
  if (value.kind === 'pages' && value.episode_id === undefined) {
    context.addIssue({ code: 'custom', path: ['episode_id'], message: 'episode_id is required for page batches' });
  }
  if (value.kind === 'character_references' && value.episode_id !== undefined) {
    context.addIssue({ code: 'custom', path: ['episode_id'], message: 'episode_id is not allowed for character batches' });
  }
});

export const generationBatchAcceptRequestSchema = z.object({
  request_key: z.string().uuid(),
  auto_confirm: z.literal(true),
}).strict();

export const generationBatchResumeRequestSchema = z.object({
  request_key: z.string().uuid(),
}).strict();

export const generationBatchProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
}).strict();

export const generationBatchItemSchema = z.object({
  item_id: z.string().uuid(),
  kind: generationBatchItemKindSchema,
  label: z.string().min(1),
  status: generationBatchItemStatusSchema,
  target_id: z.string().uuid(),
  entity_id: z.string().uuid().nullable(),
  depends_on_item_id: z.string().uuid().nullable(),
  job_id: z.string().uuid().nullable(),
  input_revision: z.string().min(1),
  operation: z.enum(['entity_preview', 'entity_state_preview', 'page_generate']),
  image_model: z.string().min(1),
  provider_model_id: z.string().min(1),
  render_style: generationBatchRenderStyleSchema.nullable(),
  amount_credits: z.number().nonnegative(),
  pricing_version: z.string().min(1),
}).strict();

export const generationBatchBlockerSchema = z.object({
  code: z.enum([
    'TARGET_NOT_READY', 'TARGET_ALREADY_GENERATED', 'DEPENDENCY_NOT_READY', 'INPUT_CHANGED',
    'PRICE_CHANGED', 'MODEL_CHANGED', 'INSUFFICIENT_CREDITS', 'CAPACITY_WAIT', 'CHILD_FAILED',
    'CONFIRMATION_CONFLICT', 'SCOPE_LOST',
  ]),
  item_id: z.string().uuid().nullable(),
  target_id: z.string().uuid().nullable(),
  message: z.string().min(1),
  retryable: z.boolean(),
}).strict();

export const generationBatchSchema = z.object({
  batch_id: z.string().uuid(),
  work_id: z.string().uuid(),
  kind: generationBatchKindSchema,
  episode_id: z.string().uuid().nullable(),
  status: generationBatchStatusSchema,
  selection: z.literal('missing_only'),
  render_style: generationBatchRenderStyleSchema,
  image_model: z.string().min(1),
  pricing_version: z.string().min(1),
  maximum_credits: z.number().nonnegative(),
  auto_confirm: z.boolean(),
  expires_at: z.string().datetime(),
  accepted_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  progress: generationBatchProgressSchema,
  items: z.array(generationBatchItemSchema),
  blockers: z.array(generationBatchBlockerSchema),
  active_job_ids: z.array(z.string().uuid()),
}).strict();

export const generationBatchesSchema = z.object({ batches: z.array(generationBatchSchema) }).strict();
export const generationBatchCancelResponseSchema = z.object({
  batch: generationBatchSchema,
  active_job_ids: z.array(z.string().uuid()),
}).strict();

export type GenerationBatchKind = z.infer<typeof generationBatchKindSchema>;
export type GenerationBatchRenderStyle = z.infer<typeof generationBatchRenderStyleSchema>;
export type GenerationBatchStatus = z.infer<typeof generationBatchStatusSchema>;
export type GenerationBatchCapabilities = z.infer<typeof generationBatchCapabilitiesSchema>;
export type GenerationBatchQuoteRequest = z.infer<typeof generationBatchQuoteRequestSchema>;
export type GenerationBatchAcceptRequest = z.infer<typeof generationBatchAcceptRequestSchema>;
export type GenerationBatchResumeRequest = z.infer<typeof generationBatchResumeRequestSchema>;
export type GenerationBatch = z.infer<typeof generationBatchSchema>;
export type GenerationBatchItem = z.infer<typeof generationBatchItemSchema>;

export interface GenerationBatchAcceptanceApi {
  accept: (batchId: string, request: GenerationBatchAcceptRequest) => Promise<GenerationBatch>;
  get: (batchId: string) => Promise<GenerationBatch>;
}

/**
 * Reuses one request key and one quoted batch. A transport failure is reconciled
 * against that batch; callers must not create a replacement quote implicitly.
 */
export async function acceptGenerationBatchWithReconciliation(
  api: GenerationBatchAcceptanceApi,
  batch: GenerationBatch,
  requestKey: string,
): Promise<GenerationBatch> {
  const request = generationBatchAcceptRequestSchema.parse({ request_key: requestKey, auto_confirm: true });
  try {
    return await api.accept(batch.batch_id, request);
  } catch (acceptError) {
    try {
      const reconciled = await api.get(batch.batch_id);
      if (reconciled.accepted_at !== null) return reconciled;
    } catch {
      // Preserve the accept error because the payment result remains unknown.
    }
    throw acceptError;
  }
}
