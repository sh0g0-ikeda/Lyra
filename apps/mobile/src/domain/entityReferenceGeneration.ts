import type { GenerationJobRecord } from '../lib/api';

const MAX_REFERENCE_GENERATION_CANDIDATES = 3;
const RESPONSE_LOSS_CLOCK_SKEW_MS = 5_000;

export interface EntityReferenceGenerationCandidate {
  index: number;
  token: string;
}

export type EntityGenerationRecoveryResult =
  | { status: 'none' }
  | { status: 'ambiguous' }
  | { status: 'recovered'; job: GenerationJobRecord };

export function isEntityGenerationJobForEntity(
  job: GenerationJobRecord,
  entityId: string,
): boolean {
  return job.job_type === 'entity_generate'
    && job.params.entity_id === entityId;
}

export function findActiveEntityGenerationJob(
  jobs: readonly GenerationJobRecord[],
  entityId: string,
): GenerationJobRecord | null {
  return jobs.find((job) => (
    isEntityGenerationJobForEntity(job, entityId)
    && isActiveGenerationJob(job)
  )) ?? null;
}

export function recoverEntityGenerationJob(input: {
  jobs: readonly GenerationJobRecord[];
  entityId: string;
  startedAt: Date;
}): EntityGenerationRecoveryResult {
  const matchingActiveJobs = input.jobs.filter((job) => (
    isEntityGenerationJobForEntity(job, input.entityId)
    && isActiveGenerationJob(job)
  ));
  if (matchingActiveJobs.length === 1) {
    return { status: 'recovered', job: matchingActiveJobs[0]! };
  }
  if (matchingActiveJobs.length > 1) {
    return { status: 'ambiguous' };
  }

  const startedAtMs = input.startedAt.getTime();
  if (!Number.isFinite(startedAtMs)) {
    return { status: 'ambiguous' };
  }
  const earliestAcceptedMs = startedAtMs - RESPONSE_LOSS_CLOCK_SKEW_MS;
  const matchingNewJobs = input.jobs.filter((job) => {
    if (!isEntityGenerationJobForEntity(job, input.entityId)) {
      return false;
    }
    const createdAtMs = Date.parse(job.created_at);
    return Number.isFinite(createdAtMs) && createdAtMs >= earliestAcceptedMs;
  });
  if (matchingNewJobs.length === 1) {
    return { status: 'recovered', job: matchingNewJobs[0]! };
  }
  return matchingNewJobs.length === 0
    ? { status: 'none' }
    : { status: 'ambiguous' };
}

export function readCompletedEntityGenerationCandidates(
  job: GenerationJobRecord,
  entityId: string,
): EntityReferenceGenerationCandidate[] | null {
  if (
    !isEntityGenerationJobForEntity(job, entityId)
    || job.job_type !== 'entity_generate'
    || job.status !== 'completed'
  ) {
    return null;
  }
  const candidates = job.result?.candidates ?? [];
  if (
    candidates.length < 1
    || candidates.length > MAX_REFERENCE_GENERATION_CANDIDATES
  ) {
    return null;
  }
  const tokens = candidates.map((candidate) => candidate.candidate_token);
  if (
    tokens.some((token) => token.length === 0)
    || new Set(tokens).size !== tokens.length
  ) {
    return null;
  }
  return tokens.map((token, index) => ({ index, token }));
}

function isActiveGenerationJob(job: GenerationJobRecord): boolean {
  return job.status === 'queued' || job.status === 'processing';
}
