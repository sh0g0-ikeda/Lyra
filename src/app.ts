import { Hono } from 'hono';
import { ConfigurationError } from './domain/errors/index.js';
import { createPageImageStorageClient } from './infrastructure/aws/S3PageImageStorage.js';
import { S3FinalPageImageStorage, type FinalPageImageStoragePort } from './infrastructure/aws/S3FinalPageImageStorage.js';
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
import { JobService, type JobServicePort } from './services/job/JobService.js';
import { NoopPageGenerationQueue, type PageGenerationQueuePort } from './services/page/PageGenerationQueue.js';
import { BalloonService, type BalloonServicePort } from './services/page/BalloonService.js';
import {
  PageGenerationService,
  type PageGenerationServicePort,
} from './services/page/PageGenerationService.js';
import {
  PageFinalizeService,
  type PageFinalizeServicePort,
} from './services/page/PageFinalizeService.js';
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
import { StoryService, type StoryServicePort } from './services/story/StoryService.js';
import type { AppEnv } from './types/app.js';

export interface AppDependencies {
  balloonService?: BalloonServicePort;
  billingCreditGrantService?: BillingCreditGrantServicePort;
  billingService?: BillingServicePort;
  compositionGalleryService?: CompositionGalleryServicePort;
  creditService?: CreditServicePort;
  entityService?: EntityServicePort;
  jobService?: JobServicePort;
  pageFinalizeService?: PageFinalizeServicePort;
  pageGenerationQueue?: PageGenerationQueuePort;
  pageGenerationService?: PageGenerationServicePort;
  panelService?: PanelServicePort;
  panelEntityAssignmentService?: PanelEntityAssignmentServicePort;
  panelFrameService?: PanelFrameServicePort;
  sceneService?: SceneServicePort;
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
  const billingCreditGrantService =
    dependencies.billingCreditGrantService ?? new BillingCreditGrantService(creditRepository);
  const compositionGalleryService =
    dependencies.compositionGalleryService ??
    new CompositionGalleryService(new PostgresCompositionGalleryRepository(db));
  const entityRepository = new PostgresEntityRepository(db);
  const billingRepository = new PostgresBillingRepository(db, db);
  const pageRepository = new PostgresPageRepository(db);
  const generationJobRepository = new PostgresGenerationJobRepository(db);
  const pageGenerationQueue = dependencies.pageGenerationQueue ?? new NoopPageGenerationQueue();
  const stripeBillingClient = resolveStripeBillingClient();
  const billingService =
    dependencies.billingService ??
    resolveBillingService(billingRepository, stripeBillingClient);
  const stripeWebhookService =
    dependencies.stripeWebhookService ??
    resolveStripeWebhookService(billingRepository, billingCreditGrantService, stripeBillingClient);
  const entityService =
    dependencies.entityService ??
    new EntityService(entityRepository, new PostgresWorkRepository(db));
  const panelRepository = new PostgresPanelRepository(db);
  const panelFrameRepository = new PostgresPanelFrameRepository(db);
  const balloonService =
    dependencies.balloonService ??
    new BalloonService(new PostgresBalloonRepository(db), entityRepository, panelRepository, panelFrameRepository);
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
    new PageFinalizeService(pageRepository, resolveFinalPageImageStorage());
  const jobService = dependencies.jobService ?? new JobService(generationJobRepository);
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
    jobService,
    pageFinalizeService,
    pageGenerationQueue,
    pageGenerationService,
    panelService,
    panelEntityAssignmentService,
    panelFrameService,
    sceneService,
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
