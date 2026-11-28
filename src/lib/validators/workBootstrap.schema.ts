import { z } from 'zod';

const titleSchema = z.string().trim().min(1).max(200);

export const workBootstrapBodySchema = z.object({
  title: titleSchema,
  mode: z.enum(['series', 'one_shot']),
  request_id: z.string().uuid(),
}).strict();

export const workCreationMetadataQuerySchema = z.object({
  work_ids: z.string().min(1).max(3700),
}).strict();

export function parseWorkIds(value: string): string[] {
  const ids = value.split(',');
  if (ids.length > 100 || ids.some((id) => !z.string().uuid().safeParse(id).success)) {
    throw new Error('work_ids must contain 1 to 100 UUIDs');
  }
  return [...new Set(ids)];
}
