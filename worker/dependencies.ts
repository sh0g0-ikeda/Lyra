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
  PassthroughEntityReferencePromptCompiler,
  type EntityReferencePromptCompilerPort,
} from '../src/services/entity/EntityReferencePromptCompiler.js';
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
import {
  PassthroughPagePromptCompiler,
  type PagePromptCompilerPort,
} from '../src/services/page/PagePromptCompiler.js';
import { PostgresPageRepository } from '../src/repositories/PageRepository.js';
import { PostgresPanelRepository } from '../src/repositories/PanelRepository.js';
import { PostgresEntityRepository } from '../src/repositories/EntityRepository.js';
import { PostgresCompositionGalleryRepository } from '../src/repositories/CompositionGalleryRepository.js';
import { ConfigurationError } from '../src/domain/errors/index.js';
import { IMAGE_GENERATION_OPENAI_MAX_RETRIES } from '../src/domain/constants/generation.js';
import { shouldUseLocalImageFallback } from '../src/domain/generation/LocalImageFallbackPolicy.js';
import { OpenAIClient } from '../src/infrastructure/openai/OpenAIClient.js';
import {
  OpenAIEntityReferenceGenerator,
  type GenerateEntityReferenceCandidatesInput,
  type GeneratedEntityReferenceCandidate,
  type EntityReferenceGeneratorPort,
} from '../src/infrastructure/openai/OpenAIEntityReferenceGenerator.js';
import { OpenAIPageGenerationPlanner } from '../src/infrastructure/openai/OpenAIPageGenerationPlanner.js';
import { OpenAIPageImageRenderer } from '../src/infrastructure/openai/OpenAIPageImageRenderer.js';
import { OpenAIPagePromptCompiler } from '../src/infrastructure/openai/OpenAIPagePromptCompiler.js';
import { OpenAIEntityReferencePromptCompiler } from '../src/infrastructure/openai/OpenAIEntityReferencePromptCompiler.js';
import {
  createPageImageStorageClient,
  S3PageImageStorage,
} from '../src/infrastructure/aws/S3PageImageStorage.js';
import { S3EntityImageStorage, type EntityImageStoragePort } from '../src/infrastructure/aws/S3EntityImageStorage.js';
import { S3StoredImageLoader, type StoredImageLoaderPort } from '../src/infrastructure/aws/S3StoredImageLoader.js';
import { LocalFilePageImageStorage } from '../src/infrastructure/local/LocalFilePageImageStorage.js';
import { LocalFileEntityImageStorage } from '../src/infrastructure/local/LocalFileEntityImageStorage.js';
import { LocalFileStoredImageLoader } from '../src/infrastructure/local/LocalFileStoredImageLoader.js';
import { LocalPreviewPageImageRenderer } from '../src/infrastructure/local/LocalPreviewPageImageRenderer.js';
import { LocalPreviewEntityReferenceGenerator } from '../src/infrastructure/local/LocalPreviewEntityReferenceGenerator.js';
import { resolveLocalAssetConfig } from '../src/infrastructure/local/LocalAssetFiles.js';
import { env } from '../src/lib/env.js';
import { assertProductionRuntimeConfig } from '../src/lib/runtimeGuards.js';
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
  pagePromptCompiler?: PagePromptCompilerPort;
  pageGenerationInputImageBuilder?: PageGenerationInputImageBuilderPort;
  pageGenerationPlanner?: PageGenerationPlannerPort;
  pageImageRenderer?: PageImageRendererPort;
  pageImageStorage?: PageImageStoragePort;
  entityReferencePromptBuilder?: EntityReferencePromptBuilderPort;
  entityReferencePromptCompiler?: EntityReferencePromptCompilerPort;
  entityReferenceGenerator?: EntityReferenceGeneratorPort;
  entityImageStorage?: EntityImageStoragePort;
  pageGenerationWorkerService?: PageGenerationWorkerPort;
  entityGenerationWorkerService?: EntityGenerationWorkerPort;
}

export function resolveWorkerDependencies(
  overrides: WorkerDependencyOverrides = {},
): WorkerDependencies {
  assertProductionRuntimeConfig(env);

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
  const pagePromptCompiler =
    overrides.pagePromptCompiler ?? resolvePagePromptCompiler();
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
  const entityReferencePromptCompiler =
    overrides.entityReferencePromptCompiler ?? resolveEntityReferencePromptCompiler();
  const entityReferenceGenerator =
    overrides.entityReferenceGenerator ?? resolveEntityReferenceGenerator();
  const entityImageStorage =
    overrides.entityImageStorage ?? resolveEntityImageStorage();
  const storedImageLoader = resolveStoredImageLoader();

  return {
    pageGenerationWorkerService: new PageGenerationWorkerService(
      pageGenerationExecutionRepository,
      promptBuilder,
      pagePromptCompiler,
      pageGenerationInputImageBuilder,
      pageGenerationPlanner,
      pageImageRenderer,
      pageImageStorage,
      creditService,
      env.GENERATION_ENABLED && env.PAGE_GENERATION_ENABLED,
    ),
    entityGenerationWorkerService: new EntityGenerationWorkerService(
      entityGenerationExecutionRepository,
      new PostgresEntityRepository(db),
      entityReferencePromptBuilder,
      entityReferencePromptCompiler,
      entityReferenceGenerator,
      entityImageStorage,
      creditService,
      storedImageLoader,
      env.OPENAI_IMAGE_MODEL,
      env.GENERATION_ENABLED && env.ENTITY_GENERATION_ENABLED,
    ),
  };
}

function resolvePagePromptCompiler(): PagePromptCompilerPort {
  if (!env.LLM_PAGE_PROMPT_COMPILER_ENABLED) {
    return new PassthroughPagePromptCompiler();
  }

  const client = buildOpenAIClient();
  if (client === null) {
    return new PassthroughPagePromptCompiler();
  }

  return new OpenAIPagePromptCompiler(client);
}

function resolvePageGenerationInputImageBuilder(): PageGenerationInputImageBuilderPort {
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  if (localAssetConfig !== null) {
    return new PageGenerationInputImageBuilder(
      new PostgresPageRepository(db),
      new PostgresEntityRepository(db),
      new LocalFileStoredImageLoader(localAssetConfig),
      new LayoutGuideImageRenderer(),
    );
  }

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
  if (!env.LLM_PAGE_GENERATION_PLANNER_ENABLED) {
    return new NoopPageGenerationPlanner();
  }

  const client = buildOpenAIClient();
  if (client === null) {
    return new NoopPageGenerationPlanner();
  }

  return new OpenAIPageGenerationPlanner(client);
}

function resolvePageImageRenderer(): PageImageRendererPort {
  const client = buildOpenAIClient({ maxRetries: IMAGE_GENERATION_OPENAI_MAX_RETRIES });
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  const localFallbackEnabled = shouldUseLocalImageFallback({
    localAssetStorageConfigured: localAssetConfig !== null,
    localImageFallbackEnabled: env.LOCAL_IMAGE_FALLBACK_ENABLED,
  });

  if (client === null) {
    return localFallbackEnabled
      ? new LocalPreviewPageImageRenderer()
      : new UnconfiguredPageImageRenderer();
  }

  const primaryRenderer = new OpenAIPageImageRenderer(client, env.OPENAI_IMAGE_MODEL);
  if (localFallbackEnabled) {
    return new LocalResilientPageImageRenderer(primaryRenderer, new LocalPreviewPageImageRenderer());
  }

  return primaryRenderer;
}

function buildOpenAIClient(options: { maxRetries?: number } = {}): OpenAIClient | null {
  if (env.OPENAI_API_KEY === undefined) {
    return null;
  }

  return new OpenAIClient({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    timeoutMs: env.OPENAI_TIMEOUT_MS,
    maxRetries: options.maxRetries,
  });
}

function resolvePageImageStorage(): PageImageStoragePort {
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  if (localAssetConfig !== null) {
    return new LocalFilePageImageStorage(localAssetConfig);
  }

  if (env.S3_BUCKET_IMAGES === undefined) {
    return new UnconfiguredPageImageStorage();
  }

  return new S3PageImageStorage(createPageImageStorageClient(env.AWS_REGION), {
    bucketName: env.S3_BUCKET_IMAGES,
    cdnBaseUrl: resolveS3ImageStorageCdnBaseUrl(),
  });
}

function resolveEntityReferenceGenerator(): EntityReferenceGeneratorPort {
  const client = buildOpenAIClient({ maxRetries: IMAGE_GENERATION_OPENAI_MAX_RETRIES });
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  const localFallbackEnabled = shouldUseLocalImageFallback({
    localAssetStorageConfigured: localAssetConfig !== null,
    localImageFallbackEnabled: env.LOCAL_IMAGE_FALLBACK_ENABLED,
  });

  if (client === null) {
    return localFallbackEnabled
      ? new LocalPreviewEntityReferenceGenerator()
      : new UnconfiguredEntityReferenceGenerator();
  }

  const primaryGenerator = new OpenAIEntityReferenceGenerator(client, env.OPENAI_IMAGE_MODEL);
  if (localFallbackEnabled) {
    return new LocalResilientEntityReferenceGenerator(
      primaryGenerator,
      new LocalPreviewEntityReferenceGenerator(),
    );
  }

  return primaryGenerator;
}

function resolveEntityReferencePromptCompiler(): EntityReferencePromptCompilerPort {
  if (!env.LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED) {
    return new PassthroughEntityReferencePromptCompiler();
  }

  const openAiClient = buildOpenAIClient();
  if (openAiClient !== null) {
    return new OpenAIEntityReferencePromptCompiler(openAiClient);
  }

  return new PassthroughEntityReferencePromptCompiler();
}

function resolveEntityImageStorage(): EntityImageStoragePort {
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  if (localAssetConfig !== null) {
    return new LocalFileEntityImageStorage(localAssetConfig);
  }

  if (env.S3_BUCKET_IMAGES === undefined) {
    return new UnconfiguredEntityImageStorage();
  }

  return new S3EntityImageStorage(createPageImageStorageClient(env.AWS_REGION), {
    bucketName: env.S3_BUCKET_IMAGES,
    cdnBaseUrl: resolveS3ImageStorageCdnBaseUrl(),
  });
}

function resolveStoredImageLoader(): StoredImageLoaderPort {
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  if (localAssetConfig !== null) {
    return new LocalFileStoredImageLoader(localAssetConfig);
  }

  if (env.S3_BUCKET_IMAGES === undefined) {
    return new UnconfiguredStoredImageLoader();
  }

  return new S3StoredImageLoader(createPageImageStorageClient(env.AWS_REGION), env.S3_BUCKET_IMAGES);
}

function resolveConfiguredLocalAssetConfig() {
  return resolveLocalAssetConfig(env.LOCAL_FILE_STORAGE_DIR, env.LOCAL_ASSET_BASE_URL, env.PORT);
}

function resolveS3ImageStorageCdnBaseUrl(): string | undefined {
  return env.IMAGE_DELIVERY_MODE === 'cloudfront_signed' ? env.IMAGES_CDN_BASE_URL : undefined;
}

class UnconfiguredPageGenerationInputImageBuilder implements PageGenerationInputImageBuilderPort {
  public async buildInputImages(): Promise<[]> {
    return [];
  }
}

class NoopPageGenerationPlanner implements PageGenerationPlannerPort {
  public async buildPlan(_input: PageGenerationPlanInput): Promise<string> {
    return '';
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

class LocalResilientPageImageRenderer implements PageImageRendererPort {
  public constructor(
    private readonly primary: PageImageRendererPort,
    private readonly fallback: PageImageRendererPort,
  ) {}

  public async render(input: RenderPageImageInput): Promise<RenderPageImageResult> {
    try {
      return await this.primary.render(input);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        return this.fallback.render(input);
      }
      throw error;
    }
  }
}

class LocalResilientEntityReferenceGenerator implements EntityReferenceGeneratorPort {
  public constructor(
    private readonly primary: EntityReferenceGeneratorPort,
    private readonly fallback: EntityReferenceGeneratorPort,
  ) {}

  public async generateCandidates(input: GenerateEntityReferenceCandidatesInput): Promise<{
    candidates: GeneratedEntityReferenceCandidate[];
    openaiRequestId: string | null;
    costUsd: number | null;
  }> {
    try {
      return await this.primary.generateCandidates(input);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        return this.fallback.generateCandidates(input);
      }
      throw error;
    }
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

class UnconfiguredStoredImageLoader implements StoredImageLoaderPort {
  public async loadByS3Key(): Promise<never> {
    throw new ConfigurationError('Stored image loader is not configured');
  }
}
