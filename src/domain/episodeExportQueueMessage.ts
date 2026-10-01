import { z } from 'zod';
const versioned = z.object({ version: z.literal(1), export_job_id: z.string().uuid() }).strict();
const deployed = z.object({ job_id: z.string().uuid(), job_type: z.literal('episode_export') }).strict();
/** Both public queue envelopes carry only an opaque owned export job ID. */
export function parseEpisodeExportQueueMessage(payload: unknown): string | null {
  const current = versioned.safeParse(payload);
  if (current.success) return current.data.export_job_id;
  const legacy = deployed.safeParse(payload);
  return legacy.success ? legacy.data.job_id : null;
}
