import type { GenerationJobRecord,GenerationJobStatus } from '../types/api.js';
export type GenerationJobWireRecord=Omit<GenerationJobRecord,'status'>&{status:GenerationJobStatus|'canceled'};
export function normalizeGenerationJobRecord(job:GenerationJobWireRecord):GenerationJobRecord {
  return {...job,status:job.status==='canceled'?'cancelled':job.status};
}
