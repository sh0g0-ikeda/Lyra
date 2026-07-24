import { z } from 'zod';
import { EXPORT_FORMATS, MAX_EXPORT_FILENAME_LENGTH, MAX_EXPORT_PAGE_COUNT } from '../../domain/exportJob.js';

export const createEpisodeExportBodySchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  page_ids: z.array(z.string().uuid()).min(1).max(MAX_EXPORT_PAGE_COUNT).superRefine((pageIds, context) => {
    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({ code: 'custom', message: 'page_ids must not contain duplicates' });
    }
  }),
  filename: z.string().trim().max(MAX_EXPORT_FILENAME_LENGTH).optional(),
}).strict();

export const exportIdempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
