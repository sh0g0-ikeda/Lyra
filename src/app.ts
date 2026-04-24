import { Hono } from 'hono';
import { ConfigurationError } from './domain/errors/index.js';
import { createPageImageStorageClient } from './infrastructure/aws/S3PageImageStorage.js';
import { S3FinalPageImageStorage, type FinalPageImageStoragePort } from './infrastructure/aws/S3FinalPageImageStorage.js';
import { S3EntityImageStorage, type EntityImageStoragePort } from './infrastructure/aws/S3EntityImageStorage.js';
import { createGenerationQueueClient, SqsGenerationQueue } from './infrastructure/aws/SqsGenerationQueue.js';
import { S3StoredImageLoader, type StoredImageLoaderPort } from './infrastructure/aws/S3StoredImageLoader.js';
import { AnthropicClient } from './infrastructure/anthropic/AnthropicClient.js';
import {
  AnthropicStoryAiClient,
  type StoryAiClientPort,
} from './infrastructure/anthropic/AnthropicStoryAiClient.js';
import {
  OpenAIEntityImportAnalyzer,
  type EntityImportAnalyzerPort,
} from './infrastructure/openai/OpenAIEntityImportAnalyzer.js';
import { OpenAIClient } from './infrastructure/openai/OpenAIClient.js';
import {
  StripeBillingClient,
  type StripeBillingClientPort,
} from './infrastructure/stripe/StripeBillingClient.js';
import { db } from './lib/db.js';
import { env } from './lib/env.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimitMiddleware, InMemoryRateLimitStore, type RateLimitStore } from './middleware/rateLimit.js';
import { createRequestContextMiddleware } from './middleware/requestContext.js';
import { PostgresBillingRepository } from './repositories/BillingRepository.js';
import { PostgresCompositionGalleryRepository } from './repositories/CompositionGalleryRepository.js';
import { PostgresCreditRepository } from './repositories/CreditRepository.js';
import { PostgresEntityRepository } from './repositories/EntityRepository.js';
import { PostgresGenerationJobRepository } from './repositories/GenerationJobRepository.js';
import { PostgresBalloonRepository } from './repositories/BalloonRepository.js';
import { PostgresPanelEntityAssignmentRepository } from './repositories/PanelEntityAssignmentRepository.js';
import { PostgresPanelFrameRepository } from './repositories/PanelFrameRepository.js';
import { PostgresPanelRepository } from './repositories/PanelRepository.js';
import { PostgresPageRepository } from './repositories/PageRepository.js';
import { PostgresSceneRepository } from './repositories/SceneRepository.js';
import { PostgresStoryRepository } from './repositories/StoryRepository.js';
import { PostgresUserRepository } from './repositories/UserRepository.js';
import { PostgresWorkRepository } from './repositories/WorkRepository.js';
import { createBillingRoutes } from './routes/billing.js';
import { createBalloonRoutes } from './routes/balloons.js';
import { createCompositionRoutes } from './routes/compositions.js';
import { createEntityRoutes } from './routes/entities.js';
import { createHealthRoutes } from './routes/health.js';
import { createJobRoutes } from './routes/jobs.js';
import { createPanelRoutes } from './routes/panels.js';
import { createPanelEntityAssignmentRoutes } from './routes/panelEntityAssignments.js';
import { createPanelFrameRoutes } from './routes/panelFrames.js';
import { createPageRoutes } from './routes/pages.js';
import { createSceneRoutes } from './routes/scenes.js';
import { createStoryRoutes } from './routes/story.js';
import { createWebhookRoutes } from './routes/webhooks.js';
import { UserProvisioningService, type UserProvisioningPort } from './services/auth/UserProvisioningService.js';
import {
  BillingService,
  assertBillingConfig,
  type BillingServicePort,
} from './services/billing/BillingService.js';
import {
  StripeWebhookService,
  type StripeWebhookServicePort,
} from './services/billing/StripeWebhookService.js';
import {
  CompositionGalleryService,
  type CompositionGalleryServicePort,
} from './services/composition/CompositionGalleryService.js';
import {
  BillingCreditGrantService,
  type BillingCreditGrantServicePort,
} from './services/credit/BillingCreditGrantService.js';
import { CreditService, type CreditServicePort } from './services/credit/CreditService.js';
import { EntityService, type EntityServicePort } from './services/entity/EntityService.js';
import {
  EntityReferenceService,
  type EntityReferenceServicePort,
} from './services/entity/EntityReferenceService.js';
import {
  NoopEntityGenerationQueue,
  SqsEntityGenerationQueueAdapter,
  type EntityGenerationQueuePort,
} from './services/entity/EntityGenerationQueue.js';
import { JobService, type JobServicePort } from './services/job/JobService.js';
import {
  NoopPageGenerationQueue,
  SqsPageGenerationQueueAdapter,
  type PageGenerationQueuePort,
} from './services/page/PageGenerationQueue.js';
import { BalloonService, type BalloonServicePort } from './services/page/BalloonService.js';
import {
  PageGenerationService,
  type PageGenerationServicePort,
} from './services/page/PageGenerationService.js';
import {
  PageFinalizeService,
  type PageFinalizeServicePort,
} from './services/page/PageFinalizeService.js';
import {
  SharpPageBalloonComposer,
  type PageBalloonComposerPort,
} from './services/page/PageBalloonComposer.js';
import { ModeSelector } from './services/page/ModeSelector.js';
import {
  PanelService,
  type PanelServicePort,
} from './services/page/PanelService.js';
import {
  PanelEntityAssignmentService,
  type PanelEntityAssignmentServicePort,
} from './services/page/PanelEntityAssignmentService.js';
import { PanelFrameService, type PanelFrameServicePort } from './services/page/PanelFrameService.js';
import { SceneService, type SceneServicePort } from './services/scene/SceneService.js';
import {
  PageSkeletonService,
  type PageSkeletonServicePort,
} from './services/story/PageSkeletonService.js';
import {
  StoryCollaborationService,
  type StoryCollaborationServicePort,
} from './services/story/StoryCollaborationService.js';
import { StoryService, type StoryServicePort } from './services/story/StoryService.js';
import type { AppEnv } from './types/app.js';

export interface AppDependencies {
  balloonService?: BalloonServicePort;
  billingCreditGrantService?: BillingCreditGrantServicePort;
  billingService?: BillingServicePort;
  compositionGalleryService?: CompositionGalleryServicePort;
  creditService?: CreditServicePort;
  entityService?: EntityServicePort;
  entityReferenceService?: EntityReferenceServicePort;
  entityGenerationQueue?: EntityGenerationQueuePort;
  jobService?: JobServicePort;
  pageFinalizeService?: PageFinalizeServicePort;
  pageSkeletonService?: PageSkeletonServicePort;
  pageGenerationQueue?: PageGenerationQueuePort;
  pageGenerationService?: PageGenerationServicePort;
  panelService?: PanelServicePort;
  panelEntityAssignmentService?: PanelEntityAssignmentServicePort;
  panelFrameService?: PanelFrameServicePort;
  sceneService?: SceneServicePort;
  storyAiClient?: StoryAiClientPort;
  storyCollaborationService?: StoryCollaborationServicePort;
  stripeWebhookService?: StripeWebhookServicePort;
  storyService?: StoryServicePort;
  userProvisioningService?: UserProvisioningPort;
  rateLimitStore?: RateLimitStore;
  jwtSecret?: string;
}

export function createApp(dependencies: AppDependencies = {}): Hono<AppEnv> {
  const resolvedDependencies = resolveDependencies(dependencies);
  const app = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(resolvedDependencies.userProvisioningService, {
    jwtSecret: dependencies.jwtSecret,
  });
  const rateLimitMiddleware = createRateLimitMiddleware(resolvedDependencies.rateLimitStore);

  app.onError(errorHandler);
  app.use('*', createRequestContextMiddleware());
  app.route('/', createHealthRoutes());
  app.route(
    '/api/billing',
    createBillingRoutes({
      authMiddleware,
      rateLimitMiddleware,
      billingService: resolvedDependencies.billingService,
      creditService: resolvedDependencies.creditService,
    }),
  );
  app.route(
    '/api/webhooks',
    createWebhookRoutes({
      stripeWebhookService: resolvedDependencies.stripeWebhookService,
    }),
  );
  app.route(
    '/api',
    createBalloonRoutes({
      authMiddleware,
      rateLimitMiddleware,
      balloonService: resolvedDependencies.balloonService,
    }),
  );
  app.route(
    '/api',
    createCompositionRoutes({
      authMiddleware,
      rateLimitMiddleware,
      compositionGalleryService: resolvedDependencies.compositionGalleryService,
    }),
  );
  app.route(
    '/api',
    createEntityRoutes({
      authMiddleware,
      rateLimitMiddleware,
      entityService: resolvedDependencies.entityService,
      entityReferenceService: resolvedDependencies.entityReferenceService,
    }),
  );
  app.route(
    '/api',
    createJobRoutes({
      authMiddleware,
      rateLimitMiddleware,
      jobService: resolvedDependencies.jobService,
    }),
  );
  app.route(
    '/api',
    createPageRoutes({
      authMiddleware,
      rateLimitMiddleware,
      pageFinalizeService: resolvedDependencies.pageFinalizeService,
      pageGenerationService: resolvedDependencies.pageGenerationService,
    }),
  );
  app.route(
    '/api',
    createStoryRoutes({
      authMiddleware,
      rateLimitMiddleware,
      pageSkeletonService: resolvedDependencies.pageSkeletonService,
      storyCollaborationService: resolvedDependencies.storyCollaborationService,
      storyService: resolvedDependencies.storyService,
    }),
  );
  app.route(
    '/api',
    createPanelRoutes({
      authMiddleware,
      rateLimitMiddleware,
      panelService: resolvedDependencies.panelService,
    }),
  );
  app.route(
    '/api',
    createPanelEntityAssignmentRoutes({
      authMiddleware,
      rateLimitMiddleware,
      panelEntityAssignmentService: resolvedDependencies.panelEntityAssignmentService,
    }),
  );
  app.route(
    '/api',
    createPanelFrameRoutes({
      authMiddleware,
      rateLimitMiddleware,
      panelFrameService: resolvedDependencies.panelFrameService,
    }),
  );
  app.route(
    '/api',
    createSceneRoutes({
      authMiddleware,
      rateLimitMiddleware,
      sceneService: resolvedDependencies.sceneService,
    }),
  );

  return app;
}

function resolveDependencies(dependencies: AppDependencies): Required<Omit<AppDependencies, 'jwtSecret'>> {
  const creditRepository = new PostgresCreditRepository(db, db);
  const creditService = dependencies.creditService ?? new CreditService(creditRepository);
  const generationQueue = resolveGenerationQueue();
  const billingCreditGrantService =
    dependencies.billingCreditGrantService ?? new BillingCreditGrantService(creditRepository);
  const compositionGalleryService =
    dependencies.compositionGalleryService ??
    new CompositionGalleryService(new PostgresCompositionGalleryRepository(db));
  const entityRepository = new PostgresEntityRepository(db);
  const entityGenerationQueue =
    dependencies.entityGenerationQueue ??
    (generationQueue === null
      ? new NoopEntityGenerationQueue()
      : new SqsEntityGenerationQueueAdapter(generationQueue));
  const billingRepository = new PostgresBillingRepository(db, db);
  const pageRepository = new PostgresPageRepository(db);
  const generationJobRepository = new PostgresGenerationJobRepository(db);
  const pageGenerationQueue =
    dependencies.pageGenerationQueue ??
    (generationQueue === null
      ? new NoopPageGenerationQueue()
      : new SqsPageGenerationQueueAdapter(generationQueue));
  const stripeBillingClient = resolveStripeBillingClient();
  const billingService =
    dependencies.billingService ??
    resolveBillingService(billingRepository, stripeBillingClient);
  const stripeWebhookService =
    dependencies.stripeWebhookService ??
    resolveStripeWebhookService(billingRepository, billingCreditGrantService, stripeBillingClient);
  const storyAiClient = dependencies.storyAiClient ?? resolveStoryAiClient();
  const entityService =
    dependencies.entityService ??
    new EntityService(entityRepository, new PostgresWorkRepository(db));
  const entityReferenceService =
    dependencies.entityReferenceService ??
    new EntityReferenceService(
      entityRepository,
      generationJobRepository,
      creditService,
      resolveEntityImportAnalyzer(),
      resolveEntityImageStorage(),
      entityGenerationQueue,
    );
  const panelRepository = new PostgresPanelRepository(db);
  const panelFrameRepository = new PostgresPanelFrameRepository(db);
  const balloonRepository = new PostgresBalloonRepository(db);
  const balloonService =
    dependencies.balloonService ??
    new BalloonService(balloonRepository, entityRepository, panelRepository, panelFrameRepository);
  const pageGenerationService =
    dependencies.pageGenerationService ??
    new PageGenerationService(
      pageRepository,
      generationJobRepository,
      creditService,
      pageGenerationQueue,
      new ModeSelector(),
    );
  const pageFinalizeService =
    dependencies.pageFinalizeService ??
    new PageFinalizeService(
      pageRepository,
      balloonRepository,
      resolveStoredPageImageLoader(),
      resolvePageBalloonComposer(),
      resolveFinalPageImageStorage(),
    );
  const jobService = dependencies.jobService ?? new JobService(generationJobRepository);
  const storyCollaborationService =
    dependencies.storyCollaborationService ??
    new StoryCollaborationService(new PostgresStoryRepository(db), storyAiClient);
  const pageSkeletonService =
    dependencies.pageSkeletonService ??
    new PageSkeletonService(new PostgresStoryRepository(db, db), storyAiClient);
  const storyService =
    dependencies.storyService ?? new StoryService(new PostgresStoryRepository(db), entityRepository);
  const panelService =
    dependencies.panelService ?? new PanelService(panelRepository, entityRepository);
  const panelEntityAssignmentService =
    dependencies.panelEntityAssignmentService ??
    new PanelEntityAssignmentService(new PostgresPanelEntityAssignmentRepository(db));
  const panelFrameService =
    dependencies.panelFrameService ?? new PanelFrameService(panelFrameRepository);
  const sceneService =
    dependencies.sceneService ?? new SceneService(new PostgresSceneRepository(db), entityRepository);
  const userProvisioningService =
    dependencies.userProvisioningService ??
    new UserProvisioningService(new PostgresUserRepository(db), creditService);
  const rateLimitStore = dependencies.rateLimitStore ?? new InMemoryRateLimitStore();

  return {
    balloonService,
    billingCreditGrantService,
    billingService,
    compositionGalleryService,
    creditService,
    entityService,
    entityReferenceService,
    entityGenerationQueue,
    jobService,
    pageFinalizeService,
    pageSkeletonService,
    pageGenerationQueue,
    pageGenerationService,
    panelService,
    panelEntityAssignmentService,
    panelFrameService,
    sceneService,
    storyAiClient,
    storyCollaborationService,
    stripeWebhookService,
    storyService,
    userProvisioningService,
    rateLimitStore,
  };
}

function resolveFinalPageImageStorage(): FinalPageImageStoragePort {
  if (env.S3_BUCKET_IMAGES === undefined || env.IMAGES_CDN_BASE_URL === undefined) {
    return {
      async finalizePageImage(): Promise<never> {
        throw new ConfigurationError('Final page image storage is not configured');
      },
      async storeFinalPageImage(): Promise<never> {
        throw new ConfigurationError('Final page image storage is not configured');
      },
    };
  }

  return new S3FinalPageImageStorage(createPageImageStorageClient(env.AWS_REGION), {
    bucketName: env.S3_BUCKET_IMAGES,
    cdnBaseUrl: env.IMAGES_CDN_BASE_URL,
  });
}

function resolveStripeBillingClient(): StripeBillingClientPort {
  if (env.STRIPE_SECRET_KEY === undefined || env.STRIPE_WEBHOOK_SECRET === undefined) {
    return new StripeBillingClientStub();
  }

  return new StripeBillingClient(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
}

function resolveStoredPageImageLoader(): StoredImageLoaderPort {
  if (env.S3_BUCKET_IMAGES === undefined) {
    return new StoredPageImageLoaderStub();
  }

  return new S3StoredImageLoader(createPageImageStorageClient(env.AWS_REGION), env.S3_BUCKET_IMAGES);
}

function resolvePageBalloonComposer(): PageBalloonComposerPort {
  return new SharpPageBalloonComposer();
}

function resolveGenerationQueue(): SqsGenerationQueue | null {
  if (env.SQS_QUEUE_URL_GENERATION === undefined) {
    return null;
  }

  return new SqsGenerationQueue(
    createGenerationQueueClient(env.AWS_REGION),
    env.SQS_QUEUE_URL_GENERATION,
  );
}

function resolveEntityImageStorage(): EntityImageStoragePort {
  if (env.S3_BUCKET_IMAGES === undefined || env.IMAGES_CDN_BASE_URL === undefined) {
    return new EntityImageStorageStub();
  }

  return new S3EntityImageStorage(createPageImageStorageClient(env.AWS_REGION), {
    bucketName: env.S3_BUCKET_IMAGES,
    cdnBaseUrl: env.IMAGES_CDN_BASE_URL,
  });
}

function resolveEntityImportAnalyzer(): EntityImportAnalyzerPort {
  const client = buildOpenAIClient();
  if (client === null) {
    return new EntityImportAnalyzerStub();
  }

  return new OpenAIEntityImportAnalyzer(client);
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

function resolveStoryAiClient(): StoryAiClientPort {
  if (env.ANTHROPIC_API_KEY === undefined) {
    return new StoryAiClientStub();
  }

  return new AnthropicStoryAiClient(
    new AnthropicClient({
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.ANTHROPIC_BASE_URL,
      apiVersion: env.ANTHROPIC_API_VERSION,
      timeoutMs: env.ANTHROPIC_TIMEOUT_MS,
    }),
  );
}

class StripeBillingClientStub {
  public async createCustomer(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }

  public async createCheckoutSession(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }

  public async createCustomerPortalSession(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }

  public constructWebhookEvent(): never {
    throw new ConfigurationError('Stripe billing is not configured');
  }

  public async retrieveSubscription(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }
}

function resolveBillingService(
  billingRepository: PostgresBillingRepository,
  stripeBillingClient: StripeBillingClientPort,
): BillingServicePort {
  if (!hasStripeBillingConfig()) {
    return new BillingServiceStub();
  }

  return new BillingService(
    billingRepository,
    stripeBillingClient,
    assertBillingConfig({
      successUrl: env.STRIPE_CHECKOUT_SUCCESS_URL ?? '',
      cancelUrl: env.STRIPE_CHECKOUT_CANCEL_URL ?? '',
      portalReturnUrl: env.STRIPE_PORTAL_RETURN_URL ?? '',
      subscriptionPriceIds: {
        standard: env.STRIPE_PRICE_STANDARD_MONTHLY ?? '',
        premium: env.STRIPE_PRICE_PREMIUM_MONTHLY ?? '',
      },
      creditPackagePriceIds: {
        credits_200: env.STRIPE_PRICE_CREDITS_200 ?? '',
        credits_1000: env.STRIPE_PRICE_CREDITS_1000 ?? '',
        credits_3000: env.STRIPE_PRICE_CREDITS_3000 ?? '',
      },
    }),
  );
}

function resolveStripeWebhookService(
  billingRepository: PostgresBillingRepository,
  billingCreditGrantService: BillingCreditGrantServicePort,
  stripeBillingClient: StripeBillingClientPort,
): StripeWebhookServicePort {
  if (!hasStripeBillingConfig()) {
    return new StripeWebhookServiceStub();
  }

  return new StripeWebhookService(billingRepository, billingCreditGrantService, stripeBillingClient, {
    subscriptionPlanByPriceId: {
      [env.STRIPE_PRICE_STANDARD_MONTHLY as string]: 'standard',
      [env.STRIPE_PRICE_PREMIUM_MONTHLY as string]: 'premium',
    },
  });
}

function hasStripeBillingConfig(): boolean {
  return (
    env.STRIPE_SECRET_KEY !== undefined &&
    env.STRIPE_WEBHOOK_SECRET !== undefined &&
    env.STRIPE_PRICE_STANDARD_MONTHLY !== undefined &&
    env.STRIPE_PRICE_PREMIUM_MONTHLY !== undefined &&
    env.STRIPE_PRICE_CREDITS_200 !== undefined &&
    env.STRIPE_PRICE_CREDITS_1000 !== undefined &&
    env.STRIPE_PRICE_CREDITS_3000 !== undefined &&
    env.STRIPE_CHECKOUT_SUCCESS_URL !== undefined &&
    env.STRIPE_CHECKOUT_CANCEL_URL !== undefined &&
    env.STRIPE_PORTAL_RETURN_URL !== undefined
  );
}

class BillingServiceStub {
  public async createSubscriptionCheckoutSession(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }

  public async createCreditCheckoutSession(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }

  public async createCustomerPortalSession(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }
}

class StripeWebhookServiceStub {
  public async handleWebhook(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }
}

class StoryAiClientStub {
  public async *streamCollaboration(): AsyncGenerator<string, void, void> {
    throw new ConfigurationError('Anthropic story AI is not configured');
  }

  public async generatePageSkeleton(): Promise<never> {
    throw new ConfigurationError('Anthropic story AI is not configured');
  }
}

class EntityImageStorageStub {
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

class EntityImportAnalyzerStub {
  public async analyze(): Promise<never> {
    throw new ConfigurationError('Entity import analyzer is not configured');
  }
}

class StoredPageImageLoaderStub {
  public async loadByS3Key(): Promise<never> {
    throw new ConfigurationError('Stored page image loader is not configured');
  }
}
