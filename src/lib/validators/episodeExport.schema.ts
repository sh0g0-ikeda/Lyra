import { z } from 'zod';
import {
  EPISODE_EXPORT_FORMATS,
  EPISODE_EXPORT_MAX_FILENAME_LENGTH,
  EPISODE_EXPORT_MAX_PAGE_COUNT,
} from '../../domain/episodeExportJob.js';

const visibleAsciiPattern = /^[\x21-\x7e]+$/u;

export const episodeExportUuidSchema = z.string().uuid();

export const episodeExportIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(visibleAsciiPattern);

export const createEpisodeExportBodySchema = z
  .object({
    format: z.enum(EPISODE_EXPORT_FORMATS),
    page_ids: z
      .array(episodeExportUuidSchema)
      .min(1)
      .max(EPISODE_EXPORT_MAX_PAGE_COUNT),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(EPISODE_EXPORT_MAX_FILENAME_LENGTH)
      .optional(),
  })
  .strict()
  .refine(
    (body) => new Set(body.page_ids).size === body.page_ids.length,
    { message: 'page_ids must be unique', path: ['page_ids'] },
  );
