import { NotFoundError } from '../../domain/errors/index.js';
import type { GenerationJob } from '../../domain/types/job.js';
import type { GenerationJobRepository } from '../../repositories/GenerationJobRepository.js';

export interface JobServicePort {
  getJob(userId: string, jobId: string): Promise<GenerationJob>;
}

export class JobService implements JobServicePort {
  public constructor(private readonly generationJobRepository: GenerationJobRepository) {}

  public async getJob(userId: string, jobId: string): Promise<GenerationJob> {
    const job = await this.generationJobRepository.findByIdAndUserId(jobId, userId);
    if (job === null) {
      throw new NotFoundError('Job not found');
    }

    return job;
  }
}
