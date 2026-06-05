import { DEFAULT_GENERATION_ACTIVE_JOB_LIMITS } from '../../domain/constants/generation.js';
import { ConflictError } from '../../domain/errors/index.js';

export interface GenerationCapacityRepository {
  countActiveGenerationJobsByUser(userId: string): Promise<number>;
  countActiveGenerationJobs(): Promise<number>;
}

export interface GenerationCapacityLimits {
  perUser: number;
  global: number;
}

export const DEFAULT_GENERATION_CAPACITY_LIMITS: GenerationCapacityLimits = {
  perUser: DEFAULT_GENERATION_ACTIVE_JOB_LIMITS.PER_USER,
  global: DEFAULT_GENERATION_ACTIVE_JOB_LIMITS.GLOBAL,
};

/**
 * Limits expensive generation fan-out before credits, queue messages, or
 * provider requests are created. DB resource locks still enforce final
 * correctness; this guard is the cost/backpressure layer.
 */
export async function assertGenerationCapacity(
  repository: GenerationCapacityRepository,
  userId: string,
  limits: GenerationCapacityLimits,
): Promise<void> {
  const activeForUser = await repository.countActiveGenerationJobsByUser(userId);
  if (activeForUser >= limits.perUser) {
    throw new ConflictError('User has too many active generation jobs');
  }

  const activeGlobally = await repository.countActiveGenerationJobs();
  if (activeGlobally >= limits.global) {
    throw new ConflictError('Generation queue is temporarily full');
  }
}
