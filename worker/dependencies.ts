import { db } from '../src/lib/db.js';
import { PostgresCreditRepository } from '../src/repositories/CreditRepository.js';
import { PostgresEntityGenerationExecutionRepository } from '../src/repositories/EntityGenerationExecutionRepository.js';
import { PostgresPageGenerationExecutionRepository } from '../src/repositories/PageGenerationExecutionRepository.js';
import { CreditService, type CreditServicePort } from '../src/services/credit/CreditService.js';
import {
  EntityGenerationWorkerService,
  type ProcessEntityGenerationJobResult,
} from '../src/services/entity/EntityGenerationWorkerService.js';
import {
  EntityReferencePromptBuilder,
  type EntityReferencePromptBuilderPort,
} from '../src/services/entity/EntityReferencePromptBuilder.js';
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
import {
  OpenAIEntityReferenceGenerator,
  type EntityReferenceGeneratorPort,
} from '../src/infrastructure/openai/OpenAIEntityReferenceGenerator.js';
import { OpenAIPageGenerationPlanner } from '../src/infrastructure/openai/OpenAIPageGenerationPlanner.js';
import { OpenAIPageImageRenderer } from '../src/infrastructure/openai/OpenAIPageImageRenderer.js';
import {
  createPageImageStorageClient,
  S3PageImageStorage,
} from '../src/infrastructure/aws/S3PageImageStorage.js';
import { S3EntityImageStorage, type EntityImageStoragePort } from '../src/infrastructure/aws/S3EntityImageStorage.js';
import { S3StoredImageLoader } from '../src/infrastructure/aws/S3StoredImageLoader.js';
import { env } from '../src/lib/env.js';
import {
  PageGenerationInputImageBuilder,
  type PageGenerationInputImageBuilderPort,
} from '../src/services/page/PageGenerationInputImageBuilder.js';
import { LayoutGuideImageRenderer } from '../src/services/page/LayoutGuideImageRenderer.js';

export interface PageGenerationWorkerPort {
  processJob(jobId: string): Promise<ProcessPageGenerationJobResult>;
}

export interface EntityGenerationWorkerPort {
  processJob(jobId: string): Promise<ProcessEntityGenerationJobResult>;
}

export interface WorkerDependencies {
  pageGenerationWorkerService: PageGenerationWorkerPort;
  entityGenerationWorkerService: EntityGenerationWorkerPort;
}

export interface WorkerDependencyOverrides {
  creditService?: CreditServicePort;
  promptBuilder?: PromptBuilderPort;
  pageGenerationInputImageBuilder?: PageGenerationInputImageBuilderPort;
  pageGenerationPlanner?: PageGenerationPlannerPort;
  pageImageRenderer?: PageImageRendererPort;
  pageImageStorage?: PageImageStoragePort;
  entityReferencePromptBuilder?: EntityReferencePromptBuilderPort;
  entityReferenceGenerator?: EntityReferenceGeneratorPort;
  entityImageStorage?: EntityImageStoragePort;
  pageGenerationWorkerService?: PageGenerationWorkerPort;
  entityGenerationWorkerService?: EntityGenerationWorkerPort;
}

export function resolveWorkerDependencies(
  overrides: WorkerDependencyOverrides = {},
): WorkerDependencies {
  if (overrides.pageGenerationWorkerService !== undefined) {
    return {
      pageGenerationWorkerService: overrides.pageGenerationWorkerService,
      entityGenerationWorkerService:
        overrides.entityGenerationWorkerService ?? new UnconfiguredEntityGenerationWorker(),
    };
  }

  if (overrides.entityGenerationWorkerService !== undefined) {
    return {
      pageGenerationWorkerService:
        overrides.pageGenerationWorkerService ?? new UnconfiguredPageGenerationWorker(),
      entityGenerationWorkerService: overrides.entityGenerationWorkerService,
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
  const pageGenerationInputImageBuilder =
    overrides.pageGenerationInputImageBuilder ?? resolvePageGenerationInputImageBuilder();
  const pageGenerationPlanner =
    overrides.pageGenerationPlanner ?? resolvePageGenerationPlanner();
  const pageImageRenderer =
    overrides.pageImageRenderer ?? resolvePageImageRenderer();
  const pageImageStorage =
    overrides.pageImageStorage ?? resolvePageImageStorage();
  const pageGenerationExecutionRepository = new PostgresPageGenerationExecutionRepository(db);
  const entityGenerationExecutionRepository = new PostgresEntityGenerationExecutionRepository(db);
  const entityReferencePromptBuilder =
    overrides.entityReferencePromptBuilder ?? new EntityReferencePromptBuilder();
  const entityReferenceGenerator =
    overrides.entityReferenceGenerator ?? resolveEntityReferenceGenerator();
  const entityImageStorage =
    overrides.entityImageStorage ?? resolveEntityImageStorage();

  return {
    pageGenerationWorkerService: new PageGenerationWorkerService(
      pageGenerationExecutionRepository,
      promptBuilder,
      pageGenerationInputImageBuilder,
      pageGenerationPlanner,
      pageImageRenderer,
      pageImageStorage,
      creditService,
    ),
    entityGenerationWorkerService: new EntityGenerationWorkerService(
      entityGenerationExecutionRepository,
      new PostgresEntityRepository(db),
      entityReferencePromptBuilder,
      entityReferenceGenerator,
      entityImageStorage,
      creditService,
    ),
  };
}

function resolvePageGenerationInputImageBuilder(): PageGenerationInputImageBuilderPort {
  if (env.S3_BUCKET_IMAGES === undefined) {
    return new UnconfiguredPageGenerationInputImageBuilder();
  }

  return new PageGenerationInputImageBuilder(
    new PostgresPageRepository(db),
    new PostgresEntityRepository(db),
    new S3StoredImageLoader(createPageImageStorageClient(env.AWS_REGION), env.S3_BUCKET_IMAGES),
    new LayoutGuideImageRenderer(),
  );
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

function resolvePageImageStorage(): PageImageStoragePort {
  if (env.S3_BUCKET_IMAGES === undefined || env.IMAGES_CDN_BASE_URL === undefined) {
    return new UnconfiguredPageImageStorage();
  }

  return new S3PageImageStorage(createPageImageStorageClient(env.AWS_REGION), {
    bucketName: env.S3_BUCKET_IMAGES,
    cdnBaseUrl: env.IMAGES_CDN_BASE_URL,
  });
}

function resolveEntityReferenceGenerator(): EntityReferenceGeneratorPort {
  const client = buildOpenAIClient();
  if (client === null) {
    return new UnconfiguredEntityReferenceGenerator();
  }

  return new OpenAIEntityReferenceGenerator(client);
}

function resolveEntityImageStorage(): EntityImageStoragePort {
  if (env.S3_BUCKET_IMAGES === undefined || env.IMAGES_CDN_BASE_URL === undefined) {
    return new UnconfiguredEntityImageStorage();
  }

  return new S3EntityImageStorage(createPageImageStorageClient(env.AWS_REGION), {
    bucketName: env.S3_BUCKET_IMAGES,
    cdnBaseUrl: env.IMAGES_CDN_BASE_URL,
  });
}

class UnconfiguredPageGenerationInputImageBuilder implements PageGenerationInputImageBuilderPort {
  public async buildInputImages(): Promise<[]> {
    return [];
  }
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

class UnconfiguredPageGenerationWorker implements PageGenerationWorkerPort {
  public async processJob(): Promise<never> {
    throw new ConfigurationError('Page generation worker is not configured');
  }
}

class UnconfiguredEntityGenerationWorker implements EntityGenerationWorkerPort {
  public async processJob(): Promise<never> {
    throw new ConfigurationError('Entity generation worker is not configured');
  }
}

class UnconfiguredEntityReferenceGenerator implements EntityReferenceGeneratorPort {
  public async generateCandidates(): Promise<never> {
    throw new ConfigurationError('Entity reference generator is not configured');
  }
}

class UnconfiguredEntityImageStorage implements EntityImageStoragePort {
  public async storeImportedImage(): Promise<never> {
    throw new ConfigurationError('Entity image storage is not configured');
  }

  public async storeGeneratedCandidate(): Promise<never> {
    throw new ConfigurationError('Entity image storage is not configured');
  }

  public async finalizeReferenceImage(): Promise<never> {
    throw new ConfigurationError('Entity image storage is not configured');
  }
}
