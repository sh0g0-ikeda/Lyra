import { Hono } from 'hono';
import { db } from './lib/db.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { PostgresCompositionGalleryRepository } from './repositories/CompositionGalleryRepository.js';
import { PostgresCreditRepository } from './repositories/CreditRepository.js';
import { PostgresEntityRepository } from './repositories/EntityRepository.js';
import { PostgresGenerationJobRepository } from './repositories/GenerationJobRepository.js';
import { PostgresPanelEntityAssignmentRepository } from './repositories/PanelEntityAssignmentRepository.js';
import { PostgresPanelFrameRepository } from './repositories/PanelFrameRepository.js';
import { PostgresPanelRepository } from './repositories/PanelRepository.js';
import { PostgresPageRepository } from './repositories/PageRepository.js';
import { PostgresSceneRepository } from './repositories/SceneRepository.js';
import { PostgresStoryRepository } from './repositories/StoryRepository.js';
import { PostgresUserRepository } from './repositories/UserRepository.js';
import { PostgresWorkRepository } from './repositories/WorkRepository.js';
import { createBillingRoutes } from './routes/billing.js';
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
import { UserProvisioningService, type UserProvisioningPort } from './services/auth/UserProvisioningService.js';
import {
  CompositionGalleryService,
  type CompositionGalleryServicePort,
} from './services/composition/CompositionGalleryService.js';
import { CreditService, type CreditServicePort } from './services/credit/CreditService.js';
import { EntityService, type EntityServicePort } from './services/entity/EntityService.js';
import { JobService, type JobServicePort } from './services/job/JobService.js';
import { NoopPageGenerationQueue, type PageGenerationQueuePort } from './services/page/PageGenerationQueue.js';
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
import { env } from './lib/env.js';
import { createPageImageStorageClient } from './infrastructure/aws/S3PageImageStorage.js';
import { S3FinalPageImageStorage, type FinalPageImageStoragePort } from './infrastructure/aws/S3FinalPageImageStorage.js';
import { ConfigurationError } from './domain/errors/index.js';

export interface AppDependencies {
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
  storyService?: StoryServicePort;
  userProvisioningService?: UserProvisioningPort;
  jwtSecret?: string;
}

export function createApp(dependencies: AppDependencies = {}): Hono<AppEnv> {
  const resolvedDependencies = resolveDependencies(dependencies);
  const app = new Hono<AppEnv>();
  const authMiddleware = createAuthMiddleware(resolvedDependencies.userProvisioningService, {
    jwtSecret: dependencies.jwtSecret,
  });

  app.onError(errorHandler);
  app.route('/', createHealthRoutes());
  app.route(
    '/api/billing',
    createBillingRoutes({
      authMiddleware,
      creditService: resolvedDependencies.creditService,
    }),
  );
  app.route(
    '/api',
    createCompositionRoutes({
      authMiddleware,
      compositionGalleryService: resolvedDependencies.compositionGalleryService,
    }),
  );
  app.route(
    '/api',
    createEntityRoutes({
      authMiddleware,
      entityService: resolvedDependencies.entityService,
    }),
  );
  app.route(
    '/api',
    createJobRoutes({
      authMiddleware,
      jobService: resolvedDependencies.jobService,
    }),
  );
  app.route(
    '/api',
    createPageRoutes({
      authMiddleware,
      pageFinalizeService: resolvedDependencies.pageFinalizeService,
      pageGenerationService: resolvedDependencies.pageGenerationService,
    }),
  );
  app.route(
    '/api',
    createStoryRoutes({
      authMiddleware,
      storyService: resolvedDependencies.storyService,
    }),
  );
  app.route(
    '/api',
    createPanelRoutes({
      authMiddleware,
      panelService: resolvedDependencies.panelService,
    }),
  );
  app.route(
    '/api',
    createPanelEntityAssignmentRoutes({
      authMiddleware,
      panelEntityAssignmentService: resolvedDependencies.panelEntityAssignmentService,
    }),
  );
  app.route(
    '/api',
    createPanelFrameRoutes({
      authMiddleware,
      panelFrameService: resolvedDependencies.panelFrameService,
    }),
  );
  app.route(
    '/api',
    createSceneRoutes({
      authMiddleware,
      sceneService: resolvedDependencies.sceneService,
    }),
  );

  return app;
}

function resolveDependencies(dependencies: AppDependencies): Required<Omit<AppDependencies, 'jwtSecret'>> {
  const creditService =
    dependencies.creditService ?? new CreditService(new PostgresCreditRepository(db, db));
  const compositionGalleryService =
    dependencies.compositionGalleryService ??
    new CompositionGalleryService(new PostgresCompositionGalleryRepository(db));
  const entityRepository = new PostgresEntityRepository(db);
  const pageRepository = new PostgresPageRepository(db);
  const generationJobRepository = new PostgresGenerationJobRepository(db);
  const pageGenerationQueue = dependencies.pageGenerationQueue ?? new NoopPageGenerationQueue();
  const entityService =
    dependencies.entityService ??
    new EntityService(entityRepository, new PostgresWorkRepository(db));
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
    dependencies.panelService ?? new PanelService(new PostgresPanelRepository(db), entityRepository);
  const panelEntityAssignmentService =
    dependencies.panelEntityAssignmentService ??
    new PanelEntityAssignmentService(new PostgresPanelEntityAssignmentRepository(db));
  const panelFrameService =
    dependencies.panelFrameService ?? new PanelFrameService(new PostgresPanelFrameRepository(db));
  const sceneService =
    dependencies.sceneService ?? new SceneService(new PostgresSceneRepository(db), entityRepository);
  const userProvisioningService =
    dependencies.userProvisioningService ??
    new UserProvisioningService(new PostgresUserRepository(db), creditService);

  return {
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
    storyService,
    userProvisioningService,
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
