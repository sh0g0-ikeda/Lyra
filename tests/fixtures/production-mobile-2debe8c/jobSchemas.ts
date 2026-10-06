// Frozen production Mobile source; do not modernize this compatibility oracle.
// Source: 2debe8c:apps/mobile/src/domain/apiSchemas.ts (job schemas and exact dependencies)
// Full source SHA-256: 55136e342f0bfdf983785d7861b4f65c1e9eff6c668f17726d139160136f9185
// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.
import { z } from 'zod';

const id = z.string().min(1);
const timestamp = z.string().min(1);
const nullableString = z.string().nullable();
const unknownRecord = z.record(z.string(), z.unknown());

export const generationJobSchema = z.object({
  id,
  job_type: z.enum(['page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton']),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'canceled']),
  generation_mode: z.enum(['standard', 'thinking']).nullable(),
  credit_cost: z.number().int().nonnegative(),
  credit_settlement: z.object({
    charged_credits: z.number().int().nonnegative(),
    refunded_credits: z.number().int().nonnegative(),
    net_credits: z.number().int().nonnegative(),
    status: z.enum([
      'not_charged',
      'charged',
      'refunded',
      'partially_refunded',
      'refund_pending'
    ])
  }),
  params: unknownRecord,
  result: unknownRecord.nullable(),
  error_message: nullableString,
  error_code: nullableString,
  message_key: nullableString,
  retryable: z.boolean(),
  support_id: nullableString,
  progress_stage: z.enum(['queued', 'compiling', 'preparing_references', 'generating', 'saving', 'completed']).nullable(),
  progress_percent: z.number().min(0).max(100).nullable(),
  progress_updated_at: nullableString,
  updated_at: timestamp,
  actions: z.object({
    cancel: z.object({
      available: z.boolean(),
      reason_key: nullableString
    }),
    hide: z.object({
      available: z.boolean(),
      reason_key: nullableString
    })
  }),
  retry_count: z.number().int().nonnegative(),
  created_at: timestamp,
  started_at: nullableString,
  completed_at: nullableString,
  expires_at: nullableString,
  cancel_requested_at: nullableString.optional(),
  cancelled_at: nullableString.optional(),
  commit_started_at: nullableString.optional()
});

export const generationJobsResponseSchema = z.object({
  jobs: z.array(generationJobSchema),
  next_cursor: nullableString
});
