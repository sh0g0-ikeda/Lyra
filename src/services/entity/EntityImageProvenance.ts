import { ConfigurationError, NotFoundError } from '../../domain/errors/index.js';
import { readGenerationImageProvenance, type ImageProvenance } from '../../domain/generation/ImageAccessPolicy.js';
import type { EntityReferenceImage } from '../../domain/types/entityReference.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import { ensureAllowedReferenceSourceKey } from './EntityReferenceSourceKeyPolicy.js';

/** Resolve generated output from its authorized job, never from a client label/token. */
export async function resolveEntityImageProvenance(input: {
  userId: string; entityId: string; organizationId: string | null; s3Key: string;
  references: readonly EntityReferenceImage[];
  jobs?: Pick<GenerationJobRepository, 'findByIdAndUserId'>;
}): Promise<ImageProvenance> {
  ensureAllowedReferenceSourceKey(input.s3Key, input.userId, input.entityId);
  const saved = input.references.find((image) => image.s3Key === input.s3Key);
  if (saved !== undefined) return { ...saved };
  if (input.s3Key.startsWith(`tmp/${input.userId}/entities/imports/`)) return {};
  const prefix = `session/${input.userId}/entities/${input.entityId}/`;
  const match = input.s3Key.startsWith(prefix)
    ? /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-\d+\.(?:png|jpe?g|webp)$/iu.exec(input.s3Key.slice(prefix.length))
    : null;
  if (match === null) throw new NotFoundError('Reference candidate is unavailable');
  if (input.jobs === undefined) throw new ConfigurationError('Reference candidate provenance is unavailable');
  const job = await input.jobs.findByIdAndUserId(match[1]!, input.userId, input.organizationId);
  const candidates = job?.result?.candidates;
  if (job === null || job.userId !== input.userId || (job.organizationId ?? null) !== input.organizationId
    || job.jobType !== 'entity_generate' || job.status !== 'completed' || job.params.entity_id !== input.entityId
    || job.params.target === 'entity_state' || !Array.isArray(candidates)
    || !candidates.some((candidate: unknown) => typeof candidate === 'object' && candidate !== null
      && 's3_key' in candidate && candidate.s3_key === input.s3Key)) {
    throw new NotFoundError('Reference candidate is unavailable');
  }
  return readGenerationImageProvenance(job.params, job.result);
}
