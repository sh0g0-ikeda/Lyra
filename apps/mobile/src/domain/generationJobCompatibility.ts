import { z, type ZodType } from 'zod';

import { generationJobSchema } from '@/domain/apiSchemas';
import type { GenerationJobRecord } from '@/domain/types';

export type CompatibleGenerationJobRecord = Omit<
  GenerationJobRecord,
  'credit_settlement'
> & {
  credit_settlement: GenerationJobRecord['credit_settlement'] | null;
};

const legacyGenerationJobSchema = generationJobSchema.pick({
  id: true,
  job_type: true,
  status: true,
  generation_mode: true,
  credit_cost: true,
  params: true,
  result: true,
  error_message: true,
  retry_count: true,
  created_at: true,
  started_at: true,
  completed_at: true,
  expires_at: true,
}).strict();

const normalizedLegacyGenerationJobSchema = legacyGenerationJobSchema.transform(
  (job): CompatibleGenerationJobRecord => {
    const updatedAt = job.completed_at ?? job.started_at ?? job.created_at;
    const progressStage =
      job.status === 'queued'
        ? 'queued'
        : job.status === 'completed'
          ? 'completed'
          : null;
    const progressPercent =
      job.status === 'queued' ? 0 : job.status === 'completed' ? 100 : null;

    return {
      ...job,
      credit_settlement: null,
      error_code: null,
      message_key: null,
      retryable: false,
      support_id: null,
      progress_stage: progressStage,
      progress_percent: progressPercent,
      progress_updated_at: updatedAt,
      updated_at: updatedAt,
      actions: {
        cancel: { available: false, reason_key: null },
        hide: { available: false, reason_key: null },
      },
    };
  },
);

export const generationJobCompatibilitySchema: ZodType<CompatibleGenerationJobRecord> =
  z.union([generationJobSchema, normalizedLegacyGenerationJobSchema]);
