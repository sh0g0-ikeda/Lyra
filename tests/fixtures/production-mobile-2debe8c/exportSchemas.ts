// Frozen production Mobile source; do not modernize this compatibility oracle.
// Source: 2debe8c:apps/mobile/src/domain/apiSchemas.ts (export schemas and exact dependencies)
// Full source SHA-256: 55136e342f0bfdf983785d7861b4f65c1e9eff6c668f17726d139160136f9185
// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.
import { z } from 'zod';

const id = z.string().min(1);
const exportTimestampSchema = z.string().datetime({ offset: true }).max(64);
const boundedExportKeySchema = z.string().min(1).max(128).nullable();

const exportJobBaseSchema = z.object({
  id: id.max(128),
  episode_id: id.max(128),
  format: z.enum(['pdf', 'zip']),
  filename: z.string().min(1).max(160),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'canceled']),
  progress_stage: z.string().min(1).max(100),
  progress_percent: z.number().int().min(0).max(100),
  error_code: boundedExportKeySchema,
  message_key: boundedExportKeySchema,
  expires_at: exportTimestampSchema,
  completed_at: exportTimestampSchema.nullable(),
  cancel_supported: z.literal(false),
  cancel_reason_code: z.literal('EXPORT_CANCEL_UNSUPPORTED').nullable(),
  download_url: z.string().url().max(2048).optional()
});

export const exportJobSchema = exportJobBaseSchema.superRefine((value, context) => {
  if (value.status !== 'completed' && value.download_url !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'download_url is only available after export completion',
      path: ['download_url']
    });
  }
});

export const createEpisodeExportResponseSchema = z.object({
  job_id: id.max(128),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'canceled'])
});
