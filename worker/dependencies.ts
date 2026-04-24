import { db } from '../src/lib/db.js';
import { PostgresCreditRepository } from '../src/repositories/CreditRepository.js';
import { PostgresPageGenerationExecutionRepository } from '../src/repositories/PageGenerationExecutionRepository.js';
import { CreditService, type CreditServicePort } from '../src/services/credit/CreditService.js';
import {
  PageGenerationWorkerService,
  type PageGenerationPlannerPort,
  type PageGenerationPlanInput,
  type ProcessPageGenerationJobResult,
  type PageImageRendererPort,
  type PageImageStoragePort,
  type RenderPageImageInput,
  type RenderPageImageResult,
  type StorePageImageInput,
  type StoredPageImage,
} from '../src/services/page/PageGenerationWorkerService.js';
import { ConfigurationError } from '../src/domain/errors/index.js';

export interface PageGenerationWorkerPort {
  processJob(jobId: string): Promise<ProcessPageGenerationJobResult>;
}

export interface WorkerDependencies {
  pageGenerationWorkerService: PageGenerationWorkerPort;
}

export interface WorkerDependencyOverrides {
  creditService?: CreditServicePort;
  pageGenerationPlanner?: PageGenerationPlannerPort;
  pageImageRenderer?: PageImageRendererPort;
  pageImageStorage?: PageImageStoragePort;
  pageGenerationWorkerService?: PageGenerationWorkerPort;
}

export function resolveWorkerDependencies(
  overrides: WorkerDependencyOverrides = {},
): WorkerDependencies {
  if (overrides.pageGenerationWorkerService !== undefined) {
    return {
      pageGenerationWorkerService: overrides.pageGenerationWorkerService,
    };
  }

  const creditService =
    overrides.creditService ?? new CreditService(new PostgresCreditRepository(db, db));
  const pageGenerationPlanner =
    overrides.pageGenerationPlanner ?? new UnconfiguredPageGenerationPlanner();
  const pageImageRenderer =
    overrides.pageImageRenderer ?? new UnconfiguredPageImageRenderer();
  const pageImageStorage =
    overrides.pageImageStorage ?? new UnconfiguredPageImageStorage();
  const pageGenerationExecutionRepository = new PostgresPageGenerationExecutionRepository(db);

  return {
    pageGenerationWorkerService: new PageGenerationWorkerService(
      pageGenerationExecutionRepository,
      pageGenerationPlanner,
      pageImageRenderer,
      pageImageStorage,
      creditService,
    ),
  };
}

class UnconfiguredPageGenerationPlanner implements PageGenerationPlannerPort {
  public async buildPlan(_input: PageGenerationPlanInput): Promise<string> {
    throw new ConfigurationError('Page generation planner is not configured');
  }
}

class UnconfiguredPageImageRenderer implements PageImageRendererPort {
  public async render(_input: RenderPageImageInput): Promise<RenderPageImageResult> {
    throw new ConfigurationError('Page image renderer is not configured');
  }
}

class UnconfiguredPageImageStorage implements PageImageStoragePort {
  public async store(_input: StorePageImageInput): Promise<StoredPageImage> {
    throw new ConfigurationError('Page image storage is not configured');
  }
}
