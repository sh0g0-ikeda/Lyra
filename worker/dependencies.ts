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
import { PromptBuilder, type PromptBuilderPort } from '../src/services/page/PromptBuilder.js';
import { PostgresPageRepository } from '../src/repositories/PageRepository.js';
import { PostgresPanelRepository } from '../src/repositories/PanelRepository.js';
import { PostgresEntityRepository } from '../src/repositories/EntityRepository.js';
import { PostgresCompositionGalleryRepository } from '../src/repositories/CompositionGalleryRepository.js';
import { ConfigurationError } from '../src/domain/errors/index.js';
import { OpenAIClient } from '../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageGenerationPlanner } from '../src/infrastructure/openai/OpenAIPageGenerationPlanner.js';
import { OpenAIPageImageRenderer } from '../src/infrastructure/openai/OpenAIPageImageRenderer.js';
import { env } from '../src/lib/env.js';

export interface PageGenerationWorkerPort {
  processJob(jobId: string): Promise<ProcessPageGenerationJobResult>;
}

export interface WorkerDependencies {
  pageGenerationWorkerService: PageGenerationWorkerPort;
}

export interface WorkerDependencyOverrides {
  creditService?: CreditServicePort;
  promptBuilder?: PromptBuilderPort;
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
  const promptBuilder =
    overrides.promptBuilder ??
    new PromptBuilder(
      new PostgresPageRepository(db),
      new PostgresPanelRepository(db),
      new PostgresEntityRepository(db),
      new PostgresCompositionGalleryRepository(db),
    );
  const pageGenerationPlanner =
    overrides.pageGenerationPlanner ?? resolvePageGenerationPlanner();
  const pageImageRenderer =
    overrides.pageImageRenderer ?? resolvePageImageRenderer();
  const pageImageStorage =
    overrides.pageImageStorage ?? new UnconfiguredPageImageStorage();
  const pageGenerationExecutionRepository = new PostgresPageGenerationExecutionRepository(db);

  return {
    pageGenerationWorkerService: new PageGenerationWorkerService(
      pageGenerationExecutionRepository,
      promptBuilder,
      pageGenerationPlanner,
      pageImageRenderer,
      pageImageStorage,
      creditService,
    ),
  };
}

function resolvePageGenerationPlanner(): PageGenerationPlannerPort {
  const client = buildOpenAIClient();
  if (client === null) {
    return new UnconfiguredPageGenerationPlanner();
  }

  return new OpenAIPageGenerationPlanner(client);
}

function resolvePageImageRenderer(): PageImageRendererPort {
  const client = buildOpenAIClient();
  if (client === null) {
    return new UnconfiguredPageImageRenderer();
  }

  return new OpenAIPageImageRenderer(client);
}

function buildOpenAIClient(): OpenAIClient | null {
  if (env.OPENAI_API_KEY === undefined) {
    return null;
  }

  return new OpenAIClient({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    timeoutMs: env.OPENAI_TIMEOUT_MS,
  });
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
