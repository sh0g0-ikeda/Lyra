import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';
import { ConfigurationError, ValidationError } from './domain/errors/index.js';
import type { EnterprisePlanCode, PaidPlanCode } from './domain/constants/billing.js';
import type { SubscriptionPlanCatalogEntry } from './domain/types/billing.js';
import { EPISODE_LONG_JOB_ACTIVE_JOB_TYPES } from './domain/constants/generation.js';
import { createPageImageStorageClient } from './infrastructure/aws/S3PageImageStorage.js';
import { S3FinalPageImageStorage, type FinalPageImageStoragePort } from './infrastructure/aws/S3FinalPageImageStorage.js';
import { S3EntityImageStorage, type EntityImageStoragePort } from './infrastructure/aws/S3EntityImageStorage.js';
import { createGenerationQueueClient, SqsGenerationQueue } from './infrastructure/aws/SqsGenerationQueue.js';
import { S3StoredImageLoader, type StoredImageLoaderPort } from './infrastructure/aws/S3StoredImageLoader.js';
import { LocalFileFinalPageImageStorage } from './infrastructure/local/LocalFileFinalPageImageStorage.js';
import { LocalFileEntityImageStorage } from './infrastructure/local/LocalFileEntityImageStorage.js';
import { LocalFileStoredImageLoader } from './infrastructure/local/LocalFileStoredImageLoader.js';
import { DetachedWorkerProcessLauncher } from './infrastructure/local/DetachedWorkerProcessLauncher.js';
import { resolveLocalAssetConfig, type LocalAssetConfig } from './infrastructure/local/LocalAssetFiles.js';
import {
  OpenAIEntityImportAnalyzer,
  type EntityImportAnalyzerPort,
} from './infrastructure/openai/OpenAIEntityImportAnalyzer.js';
import { OpenAIPageAutofillCompiler } from './infrastructure/openai/OpenAIPageAutofillCompiler.js';
import { OpenAIPageEpisodePlanCompiler } from './infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';
import { OpenAIClient } from './infrastructure/openai/OpenAIClient.js';
import { OpenAIStoryAiClient } from './infrastructure/openai/OpenAIStoryAiClient.js';
import { OpenAIStyleReferenceCompiler } from './infrastructure/openai/OpenAIStyleReferenceCompiler.js';
import { OpenAIStoryEpisodeImprovementPlanner } from './infrastructure/openai/OpenAIStoryEpisodeImprovementPlanner.js';
import {
  StripeBillingClient,
  type StripeBillingClientPort,
} from './infrastructure/stripe/StripeBillingClient.js';
import { db } from './lib/db.js';
import { env } from './lib/env.js';
import { assertProductionRuntimeConfig, isDevAuthBypassRuntimeAllowed } from './lib/runtimeGuards.js';
import { createAuthMiddleware } from './middleware/auth.js';
import type { AuthProvider, CognitoVerifierConfig } from './middleware/auth.js';
import { createCorsMiddleware, parseCorsAllowedOrigins } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createOriginGuardMiddleware } from './middleware/originGuard.js';
import {
  createPublicIpRateLimitMiddleware,
  createRateLimitMiddleware,
  InMemoryRateLimitStore,
  type RateLimitStore,
} from './middleware/rateLimit.js';
import { createRequestContextMiddleware } from './middleware/requestContext.js';
import { createSecurityHeadersMiddleware } from './middleware/securityHeaders.js';
import { PostgresBillingRepository } from './repositories/BillingRepository.js';
import { PostgresCompositionGalleryRepository } from './repositories/CompositionGalleryRepository.js';
import { PostgresCreditRepository } from './repositories/CreditRepository.js';
import { PostgresEntityRepository } from './repositories/EntityRepository.js';
import { PostgresEntityGenerationExecutionRepository } from './repositories/EntityGenerationExecutionRepository.js';
import { PostgresEntityGenerationRecoveryRepository } from './repositories/EntityGenerationRecoveryRepository.js';
import { PostgresGenerationJobRepository } from './repositories/GenerationJobRepository.js';
import { PostgresOrganizationRepository } from './repositories/OrganizationRepository.js';
import { PostgresBalloonRepository } from './repositories/BalloonRepository.js';
import { PostgresPanelEntityAssignmentRepository } from './repositories/PanelEntityAssignmentRepository.js';
import { PostgresPanelFrameRepository } from './repositories/PanelFrameRepository.js';
import { PostgresPanelRepository } from './repositories/PanelRepository.js';
import { PostgresPageLayoutRepository } from './repositories/PageLayoutRepository.js';
import { PostgresPageGenerationExecutionRepository } from './repositories/PageGenerationExecutionRepository.js';
import { PostgresPageGenerationRecoveryRepository } from './repositories/PageGenerationRecoveryRepository.js';
import { PostgresPageRepository } from './repositories/PageRepository.js';
import { PostgresRateLimitStore } from './repositories/RateLimitStore.js';
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
import { createLocalAssetRoutes } from './routes/localAssets.js';
import { createMeRoutes } from './routes/me.js';
import { createPanelRoutes } from './routes/panels.js';
import { createPanelEntityAssignmentRoutes } from './routes/panelEntityAssignments.js';
import { createPanelFrameRoutes } from './routes/panelFrames.js';
import { createPageRoutes } from './routes/pages.js';
import { createAdminOrganizationRoutes } from './routes/adminOrganizations.js';
import { createOrganizationRoutes } from './routes/organizations.js';
import { createSceneRoutes } from './routes/scenes.js';
import { createStoryRoutes } from './routes/story.js';
import { createRootWebhookCompatibilityRoutes, createWebhookRoutes } from './routes/webhooks.js';
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
  EntityReferenceImageExportService,
  type EntityReferenceImageExportServicePort,
} from './services/entity/EntityReferenceImageExportService.js';
import {
  InlineEntityGenerationQueueAdapter,
  SqsEntityGenerationQueueAdapter,
  UnconfiguredEntityGenerationQueue,
  type EntityGenerationQueuePort,
} from './services/entity/EntityGenerationQueue.js';
import {
  EpisodeStoryAutofillService,
  type EpisodeStoryAutofillServicePort,
} from './services/story/EpisodeStoryAutofillService.js';
import { acceptInvitationBodySchema } from './lib/validators/organization.schema.js';
import { formatZodValidationError } from './lib/validationErrorFormatter.js';
import {
  InlineEpisodeStoryAutofillQueueAdapter,
  SqsEpisodeStoryAutofillQueueAdapter,
  UnconfiguredEpisodeStoryAutofillQueue,
  type EpisodeStoryAutofillQueuePort,
} from './services/story/EpisodeStoryAutofillQueue.js';
import {
  EpisodePageSkeletonService,
  type EpisodePageSkeletonServicePort,
} from './services/story/EpisodePageSkeletonService.js';
import {
  InlineEpisodePageSkeletonQueueAdapter,
  SqsEpisodePageSkeletonQueueAdapter,
  type EpisodePageSkeletonQueuePort,
} from './services/story/EpisodePageSkeletonQueue.js';
import {
  EntityGenerationRecoveryService,
  type EntityGenerationRecoveryServicePort,
} from './services/entity/EntityGenerationRecoveryService.js';
import { JobService, type JobServicePort } from './services/job/JobService.js';
import {
  DetachedProcessPageGenerationQueueAdapter,
  SqsPageGenerationQueueAdapter,
  UnconfiguredPageGenerationQueue,
  type PageGenerationQueuePort,
} from './services/page/PageGenerationQueue.js';
import { BalloonService, type BalloonServicePort } from './services/page/BalloonService.js';
import {
  PageGenerationService,
  type PageGenerationServicePort,
} from './services/page/PageGenerationService.js';
import {
  PageGenerationRecoveryService,
  type PageGenerationRecoveryServicePort,
} from './services/page/PageGenerationRecoveryService.js';
import {
  PageFinalizeService,
  type PageFinalizeServicePort,
} from './services/page/PageFinalizeService.js';
import {
  PageExportService,
  type PageExportServicePort,
} from './services/page/PageExportService.js';
import { PageService, type PageServicePort } from './services/page/PageService.js';
import type { PageAutofillCompilerPort } from './services/page/PageAutofillCompiler.js';
import type { EpisodePagePlanCompilerPort } from './services/page/EpisodePagePlanCompiler.js';
import type { StyleReferenceCompilerPort } from './services/style/StyleReferenceCompiler.js';
import {
  SharpPageBalloonComposer,
  type PageBalloonComposerPort,
} from './services/page/PageBalloonComposer.js';
import { PageQueryService, type PageQueryServicePort } from './services/page/PageQueryService.js';
import { ModeSelector } from './services/page/ModeSelector.js';
import {
  PanelService,
  type PanelServicePort,
} from './services/page/PanelService.js';
import {
  PageLayoutService,
  type PageLayoutServicePort,
} from './services/page/PageLayoutService.js';
import {
  PanelEntityAssignmentService,
  type PanelEntityAssignmentServicePort,
} from './services/page/PanelEntityAssignmentService.js';
import { PanelFrameService, type PanelFrameServicePort } from './services/page/PanelFrameService.js';
import { SceneService, type SceneServicePort } from './services/scene/SceneService.js';
import {
  OrganizationService,
  type OrganizationServicePort,
} from './services/organization/OrganizationService.js';
import {
  OrganizationBillingService,
  assertOrganizationBillingConfig,
  type OrganizationBillingServicePort,
} from './services/organization/OrganizationBillingService.js';
import { DisabledEmailDeliveryService } from './services/email/DisabledEmailDeliveryService.js';
import type { EmailDeliveryPort } from './services/email/EmailDeliveryPort.js';
import { SesEmailDeliveryService } from './services/email/SesEmailDeliveryService.js';
import { InvitationUrlBuilder } from './services/organization/InvitationUrlBuilder.js';
import {
  OrganizationInvitationEmailService,
  type OrganizationInvitationEmailServicePort,
} from './services/organization/OrganizationInvitationEmailService.js';
import {
  PageSkeletonService,
  type PageSkeletonServicePort,
} from './services/story/PageSkeletonService.js';
import {
  StoryCollaborationService,
  type StoryCollaborationServicePort,
} from './services/story/StoryCollaborationService.js';
import type { StoryAiClientPort } from './services/story/StoryAiClientPort.js';
import type { StoryEpisodeImprovementPlannerPort } from './services/story/StoryEpisodeImprovementPlanner.js';
import { StoryService, type StoryServicePort } from './services/story/StoryService.js';
import type { AppEnv } from './types/app.js';
import type { SupabaseJwtClaims } from './domain/types/user.js';
import type { JWTVerifyGetKey } from 'jose';
import { resolveWorkerDependencies } from '../worker/dependencies.js';

export interface AppDependencies {
  balloonService?: BalloonServicePort;
  billingCreditGrantService?: BillingCreditGrantServicePort;
  billingService?: BillingServicePort;
  compositionGalleryService?: CompositionGalleryServicePort;
  creditService?: CreditServicePort;
  entityService?: EntityServicePort;
  entityReferenceService?: EntityReferenceServicePort;
  entityReferenceImageExportService?: EntityReferenceImageExportServicePort;
  entityGenerationQueue?: EntityGenerationQueuePort;
  episodePageSkeletonQueue?: EpisodePageSkeletonQueuePort | null;
  episodePageSkeletonService?: EpisodePageSkeletonServicePort | null;
  episodeStoryAutofillQueue?: EpisodeStoryAutofillQueuePort;
  episodeStoryAutofillService?: EpisodeStoryAutofillServicePort;
  entityGenerationRecoveryService?: EntityGenerationRecoveryServicePort;
  jobService?: JobServicePort;
  organizationService?: OrganizationServicePort;
  organizationBillingService?: OrganizationBillingServicePort;
  pageExportService?: PageExportServicePort;
  pageFinalizeService?: PageFinalizeServicePort;
  pageService?: PageServicePort;
  pageQueryService?: PageQueryServicePort;
  pageSkeletonService?: PageSkeletonServicePort;
  pageGenerationQueue?: PageGenerationQueuePort;
  pageGenerationService?: PageGenerationServicePort;
  pageGenerationRecoveryService?: PageGenerationRecoveryServicePort;
  pageLayoutService?: PageLayoutServicePort;
  panelService?: PanelServicePort;
  panelEntityAssignmentService?: PanelEntityAssignmentServicePort;
  panelFrameService?: PanelFrameServicePort;
  sceneService?: SceneServicePort;
  storyAiClient?: StoryAiClientPort;
  storyEpisodeImprovementPlanner?: StoryEpisodeImprovementPlannerPort;
  storyCollaborationService?: StoryCollaborationServicePort;
  stripeWebhookService?: StripeWebhookServicePort;
  storyService?: StoryServicePort;
  userProvisioningService?: UserProvisioningPort;
  rateLimitStore?: RateLimitStore;
  authProvider?: AuthProvider;
  jwtSecret?: string;
  cognito?: CognitoVerifierConfig;
  cognitoJwks?: JWTVerifyGetKey;
  enableDevAuthBypass?: boolean;
  devAuthBypassClaims?: SupabaseJwtClaims;
  webStaticDir?: string | null;
}

export function createApp(dependencies: AppDependencies = {}): Hono<AppEnv> {
  assertProductionRuntimeConfig(env);

  const resolvedDependencies = resolveDependencies(dependencies);
  const app = new Hono<AppEnv>();
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  const requestedDevAuthBypass =
    dependencies.enableDevAuthBypass ?? (process.env.NODE_ENV === 'test' ? false : env.DEV_AUTH_BYPASS);
  if (requestedDevAuthBypass && !isDevAuthBypassRuntimeAllowed(env.APP_ENV, process.env.NODE_ENV)) {
    throw new ConfigurationError('DEV_AUTH_BYPASS is only allowed in explicit development or test runtimes');
  }
  const enableDevAuthBypass = requestedDevAuthBypass;
  const authMiddleware = createAuthMiddleware(resolvedDependencies.userProvisioningService, {
    authProvider: dependencies.authProvider,
    jwtSecret: dependencies.jwtSecret,
    cognito: dependencies.cognito,
    cognitoJwks: dependencies.cognitoJwks,
    enableDevBypass: enableDevAuthBypass,
    devBypassClaims: dependencies.devAuthBypassClaims,
  });
  const rateLimitMiddleware: MiddlewareHandler<AppEnv> = enableDevAuthBypass
    ? (async (_c, next) => {
        await next();
      })
    : createRateLimitMiddleware(resolvedDependencies.rateLimitStore);
  const webhookRateLimitMiddleware: MiddlewareHandler<AppEnv> = enableDevAuthBypass
    ? (async (_c, next) => {
        await next();
      })
    : createPublicIpRateLimitMiddleware(resolvedDependencies.rateLimitStore, 'webhook');
  const publicReadRateLimitMiddleware: MiddlewareHandler<AppEnv> = enableDevAuthBypass
    ? (async (_c, next) => {
        await next();
      })
    : createPublicIpRateLimitMiddleware(resolvedDependencies.rateLimitStore, 'read');

  app.onError(errorHandler);
  app.use('*', createSecurityHeadersMiddleware());
  app.use('*', createCorsMiddleware(parseCorsAllowedOrigins(env.CORS_ALLOWED_ORIGINS)));
  app.use('*', createRequestContextMiddleware());
  app.use(
    '*',
    createOriginGuardMiddleware({
      headerName: env.ORIGIN_GUARD_HEADER_NAME,
      headerValue: env.ORIGIN_GUARD_HEADER_VALUE,
    }),
  );
  app.route(
    '/',
    createRootWebhookCompatibilityRoutes({
      rateLimitMiddleware: webhookRateLimitMiddleware,
      stripeWebhookService: resolvedDependencies.stripeWebhookService,
    }),
  );
  app.route('/', createHealthRoutes());
  if (localAssetConfig !== null) {
    app.route('/', createLocalAssetRoutes(localAssetConfig.rootDir));
  }
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
      rateLimitMiddleware: webhookRateLimitMiddleware,
      stripeWebhookService: resolvedDependencies.stripeWebhookService,
    }),
  );
  if (env.ENTERPRISE_FEATURES_ENABLED) {
    // Keep invitation preview public. It must be registered before authenticated
    // /api sub-apps, whose middleware would otherwise turn the preview into 401.
    app.get('/api/organization-invitations/:token', publicReadRateLimitMiddleware, async (c) => {
      const token = c.req.param('token').trim();
      const body = acceptInvitationBodySchema.safeParse({ token });
      if (!body.success) {
        throw new ValidationError(formatZodValidationError(body.error));
      }

      const preview = await resolvedDependencies.organizationService.previewInvitation(body.data.token);
      return c.json({
        organization: preview.organization,
        invitation: {
          email: preview.invitation.email,
          role: preview.invitation.role,
          status: preview.invitation.status,
          expires_at: preview.invitation.expiresAt.toISOString(),
        },
      });
    });
  }
  app.route(
    '/api',
    createBalloonRoutes({
      authMiddleware,
      rateLimitMiddleware,
      balloonService: resolvedDependencies.balloonService,
      organizationService: resolvedDependencies.organizationService,
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
      entityReferenceImageExportService: resolvedDependencies.entityReferenceImageExportService,
      organizationService: resolvedDependencies.organizationService,
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
    createMeRoutes({
      authMiddleware,
      rateLimitMiddleware,
      creditService: resolvedDependencies.creditService,
      organizationService: env.ENTERPRISE_FEATURES_ENABLED ? resolvedDependencies.organizationService : undefined,
    }),
  );
  if (env.ENTERPRISE_FEATURES_ENABLED) {
    app.route(
      '/api',
      createOrganizationRoutes({
        authMiddleware,
        rateLimitMiddleware,
        publicRateLimitMiddleware: publicReadRateLimitMiddleware,
        organizationService: resolvedDependencies.organizationService,
        organizationBillingService: resolvedDependencies.organizationBillingService,
      }),
    );
    app.route(
      '/api',
      createAdminOrganizationRoutes({
        authMiddleware,
        rateLimitMiddleware,
        organizationService: resolvedDependencies.organizationService,
        adminEmails: parseAdminEmails(env.ADMIN_USER_EMAILS),
      }),
    );
  }
  app.route(
    '/api',
    createPageRoutes({
      authMiddleware,
      rateLimitMiddleware,
      pageExportService: resolvedDependencies.pageExportService,
      pageFinalizeService: resolvedDependencies.pageFinalizeService,
      pageService: resolvedDependencies.pageService,
      episodeStoryAutofillService: resolvedDependencies.episodeStoryAutofillService,
      pageQueryService: resolvedDependencies.pageQueryService,
      pageGenerationService: resolvedDependencies.pageGenerationService,
      pageLayoutService: resolvedDependencies.pageLayoutService,
      organizationService: resolvedDependencies.organizationService,
    }),
  );
  app.route(
    '/api',
    createStoryRoutes({
      authMiddleware,
      rateLimitMiddleware,
      pageSkeletonService: resolvedDependencies.pageSkeletonService,
      episodePageSkeletonService: resolvedDependencies.episodePageSkeletonService,
      pageService: resolvedDependencies.pageService,
      episodeStoryAutofillService: resolvedDependencies.episodeStoryAutofillService,
      organizationService: resolvedDependencies.organizationService,
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
      organizationService: resolvedDependencies.organizationService,
    }),
  );
  app.route(
    '/api',
    createPanelEntityAssignmentRoutes({
      authMiddleware,
      rateLimitMiddleware,
      panelEntityAssignmentService: resolvedDependencies.panelEntityAssignmentService,
      organizationService: resolvedDependencies.organizationService,
    }),
  );
  app.route(
    '/api',
    createPanelFrameRoutes({
      authMiddleware,
      rateLimitMiddleware,
      panelFrameService: resolvedDependencies.panelFrameService,
      organizationService: resolvedDependencies.organizationService,
    }),
  );
  app.route(
    '/api',
    createSceneRoutes({
      authMiddleware,
      rateLimitMiddleware,
      sceneService: resolvedDependencies.sceneService,
      organizationService: resolvedDependencies.organizationService,
    }),
  );
  const webStaticDir = dependencies.webStaticDir !== undefined ? dependencies.webStaticDir : env.WEB_STATIC_DIR ?? null;
  if (webStaticDir !== null) {
    mountWebStaticRoutes(app, webStaticDir);
  }

  return app;
}

export function isWebStaticFallbackPath(path: string): boolean {
  return !(
    path === '/healthz' ||
    path.startsWith('/api/') ||
    path === '/api' ||
    path.startsWith('/local-assets/')
  );
}

const WEB_STATIC_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'sha256-m7ViBh063Idnmu3GIO3JLKhQAvcEYJ2KFhL39okn8ss='",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.amazoncognito.com https://cognito-idp.ap-northeast-1.amazonaws.com",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function mountWebStaticRoutes(app: Hono<AppEnv>, root: string): void {
  const staticFileMiddleware = serveStatic<AppEnv>({
    root,
    index: '__lyra_disabled_directory_index__',
  });
  const indexFallbackMiddleware = serveStatic<AppEnv>({
    root,
    path: '/index.html',
  });

  app.use('*', async (c, next) => {
    if (!isWebStaticFallbackPath(c.req.path)) {
      await next();
      return;
    }

    c.header(
      'Cache-Control',
      c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    );
    c.header('Content-Security-Policy', WEB_STATIC_CONTENT_SECURITY_POLICY);
    return staticFileMiddleware(c, next);
  });

  app.get('*', async (c, next) => {
    if (!isWebStaticFallbackPath(c.req.path)) {
      await next();
      return;
    }

    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', WEB_STATIC_CONTENT_SECURITY_POLICY);
    return indexFallbackMiddleware(c, next);
  });
}

function resolveDependencies(
  dependencies: AppDependencies,
): Omit<
  Required<
    Omit<
      AppDependencies,
      | 'authProvider'
      | 'jwtSecret'
      | 'cognito'
      | 'cognitoJwks'
      | 'enableDevAuthBypass'
      | 'devAuthBypassClaims'
      | 'episodePageSkeletonQueue'
      | 'episodePageSkeletonService'
      | 'webStaticDir'
    >
  >,
  'storyEpisodeImprovementPlanner'
> & {
  episodePageSkeletonQueue?: EpisodePageSkeletonQueuePort;
  episodePageSkeletonService?: EpisodePageSkeletonServicePort;
  storyEpisodeImprovementPlanner?: StoryEpisodeImprovementPlannerPort;
} {
  const creditRepository = new PostgresCreditRepository(db, db);
  const creditService = dependencies.creditService ?? new CreditService(creditRepository);
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  const generationQueue = resolveGenerationQueue();
  const inlineWorkerDependencies =
    localAssetConfig !== null ? resolveWorkerDependencies() : null;
  const billingCreditGrantService =
    dependencies.billingCreditGrantService ?? new BillingCreditGrantService(creditRepository);
  const compositionGalleryService =
    dependencies.compositionGalleryService ??
    new CompositionGalleryService(new PostgresCompositionGalleryRepository(db));
  const entityRepository = new PostgresEntityRepository(db);
  const entityGenerationQueue =
    dependencies.entityGenerationQueue ??
    (inlineWorkerDependencies !== null
      ? new InlineEntityGenerationQueueAdapter(inlineWorkerDependencies.entityGenerationWorkerService)
      : generationQueue !== null
        ? new SqsEntityGenerationQueueAdapter(generationQueue)
        : new UnconfiguredEntityGenerationQueue());
  const billingRepository = new PostgresBillingRepository(db, db);
  const organizationRepository = new PostgresOrganizationRepository(db, db);
  const organizationInvitationEmailService = resolveOrganizationInvitationEmailService(organizationRepository);
  const organizationService =
    dependencies.organizationService ??
    new OrganizationService(
      organizationRepository,
      organizationInvitationEmailService,
      new InvitationUrlBuilder(env.APP_PUBLIC_URL),
    );
  const pageRepository = new PostgresPageRepository(db);
  const generationJobRepository = new PostgresGenerationJobRepository(db);
  const episodeStoryAutofillQueue =
    dependencies.episodeStoryAutofillQueue ??
    (inlineWorkerDependencies !== null
      ? new InlineEpisodeStoryAutofillQueueAdapter(
          inlineWorkerDependencies.episodeStoryAutofillWorkerService,
        )
      : generationQueue !== null
        ? new SqsEpisodeStoryAutofillQueueAdapter(generationQueue)
        : new UnconfiguredEpisodeStoryAutofillQueue());
  const episodeStoryAutofillService =
    dependencies.episodeStoryAutofillService ??
    new EpisodeStoryAutofillService(
      generationJobRepository,
      episodeStoryAutofillQueue,
      undefined,
      undefined,
      {
        perUser: env.EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT,
        global: env.EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT,
        jobTypes: EPISODE_LONG_JOB_ACTIVE_JOB_TYPES,
      },
    );
  const episodePageSkeletonQueue =
    dependencies.episodePageSkeletonQueue === null
      ? undefined
      : dependencies.episodePageSkeletonQueue ??
        (inlineWorkerDependencies !== null
          ? new InlineEpisodePageSkeletonQueueAdapter(
              inlineWorkerDependencies.episodePageSkeletonWorkerService,
            )
          : generationQueue !== null
            ? new SqsEpisodePageSkeletonQueueAdapter(generationQueue)
            : undefined);
  const episodePageSkeletonService =
    dependencies.episodePageSkeletonService === null
      ? undefined
      : dependencies.episodePageSkeletonService ??
        (episodePageSkeletonQueue === undefined
          ? undefined
          : new EpisodePageSkeletonService(
              generationJobRepository,
              episodePageSkeletonQueue,
              undefined,
              undefined,
              {
                perUser: env.EPISODE_LONG_JOB_USER_ACTIVE_JOB_LIMIT,
                global: env.EPISODE_LONG_JOB_GLOBAL_ACTIVE_JOB_LIMIT,
                jobTypes: EPISODE_LONG_JOB_ACTIVE_JOB_TYPES,
              },
            ));
  const entityGenerationExecutionRepository = new PostgresEntityGenerationExecutionRepository(db);
  const entityGenerationRecoveryService =
    dependencies.entityGenerationRecoveryService ??
    new EntityGenerationRecoveryService(
      new PostgresEntityGenerationRecoveryRepository(db),
      entityGenerationExecutionRepository,
      creditService,
      undefined,
      undefined,
      organizationService,
    );
  const pageGenerationExecutionRepository = new PostgresPageGenerationExecutionRepository(db);
  const pageGenerationRecoveryService =
    dependencies.pageGenerationRecoveryService ??
    new PageGenerationRecoveryService(
      new PostgresPageGenerationRecoveryRepository(db),
      pageGenerationExecutionRepository,
      creditService,
      undefined,
      undefined,
      organizationService,
    );
  const pageGenerationQueue =
    dependencies.pageGenerationQueue ??
    (inlineWorkerDependencies !== null
      ? new DetachedProcessPageGenerationQueueAdapter(
          new DetachedWorkerProcessLauncher('scripts/runPageWorker.ts'),
        )
      : generationQueue !== null
        ? new SqsPageGenerationQueueAdapter(generationQueue)
        : new UnconfiguredPageGenerationQueue());
  const stripeBillingClient = resolveStripeBillingClient();
  const billingService =
    dependencies.billingService ??
    resolveBillingService(billingRepository, stripeBillingClient);
  const organizationBillingService =
    dependencies.organizationBillingService ??
    resolveOrganizationBillingService(
      organizationService,
      organizationRepository,
      billingRepository,
      stripeBillingClient,
    );
  const stripeWebhookService =
    dependencies.stripeWebhookService ??
    resolveStripeWebhookService(
      billingRepository,
      billingCreditGrantService,
      organizationService,
      organizationRepository,
      stripeBillingClient,
    );
  const storyAiClient = dependencies.storyAiClient ?? resolveStoryAiClient();
  const entityService =
    dependencies.entityService ??
    new EntityService(entityRepository, new PostgresWorkRepository(db), resolveStyleReferenceCompiler());
  const entityReferenceService =
    dependencies.entityReferenceService ??
    new EntityReferenceService(
      entityRepository,
      generationJobRepository,
      creditService,
      resolveEntityImportAnalyzer(),
      resolveEntityImageStorage(),
      entityGenerationQueue,
      {
        perUser: env.GENERATION_USER_ACTIVE_JOB_LIMIT,
        global: env.GENERATION_GLOBAL_ACTIVE_JOB_LIMIT,
      },
      env.GENERATION_ENABLED && env.ENTITY_GENERATION_ENABLED,
      entityGenerationRecoveryService,
      env.GENERATION_ENABLED && env.ENTITY_IMPORT_ANALYSIS_ENABLED,
      organizationService,
    );
  const entityReferenceImageExportService =
    dependencies.entityReferenceImageExportService ??
    new EntityReferenceImageExportService(entityRepository, resolveStoredPageImageLoader());
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
      entityRepository,
      generationJobRepository,
      creditService,
      pageGenerationQueue,
      new ModeSelector(),
      pageGenerationRecoveryService,
      {
        perUser: env.GENERATION_USER_ACTIVE_JOB_LIMIT,
        global: env.GENERATION_GLOBAL_ACTIVE_JOB_LIMIT,
      },
      env.GENERATION_ENABLED && env.PAGE_GENERATION_ENABLED,
      organizationService,
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
  const pageExportService =
    dependencies.pageExportService ??
    new PageExportService(pageRepository, resolveStoredPageImageLoader(), organizationService);
  const pageQueryService =
    dependencies.pageQueryService ?? new PageQueryService(pageRepository, new PostgresStoryRepository(db));
  const panelEntityAssignmentService =
    dependencies.panelEntityAssignmentService ??
    new PanelEntityAssignmentService(new PostgresPanelEntityAssignmentRepository(db));
  const storyEpisodeImprovementPlanner =
    dependencies.storyEpisodeImprovementPlanner ?? resolveStoryEpisodeImprovementPlanner();
  const pageService =
    dependencies.pageService ??
    new PageService(
      pageRepository,
      panelRepository,
      panelEntityAssignmentService,
      resolvePageAutofillCompiler(),
      resolveEpisodePagePlanCompiler(),
      resolveStyleReferenceCompiler(),
    );
  const jobService =
    dependencies.jobService ??
    new JobService(
      generationJobRepository,
      pageGenerationRecoveryService,
      entityGenerationRecoveryService,
    );
  const storyCollaborationService =
    dependencies.storyCollaborationService ??
    new StoryCollaborationService(
      new PostgresStoryRepository(db),
      storyAiClient,
      storyEpisodeImprovementPlanner,
    );
  const pageSkeletonService =
    dependencies.pageSkeletonService ??
    new PageSkeletonService(new PostgresStoryRepository(db, db), storyAiClient);
  const storyService =
    dependencies.storyService ?? new StoryService(new PostgresStoryRepository(db), entityRepository);
  const panelService =
    dependencies.panelService ??
    new PanelService(
      panelRepository,
      entityRepository,
      panelFrameRepository,
      new PostgresCompositionGalleryRepository(db),
    );
  const panelFrameService =
    dependencies.panelFrameService ?? new PanelFrameService(panelFrameRepository);
  const pageLayoutService =
    dependencies.pageLayoutService ??
    new PageLayoutService(new PostgresPageLayoutRepository(db));
  const sceneService =
    dependencies.sceneService ?? new SceneService(new PostgresSceneRepository(db), entityRepository);
  const userProvisioningService =
    dependencies.userProvisioningService ??
    new UserProvisioningService(new PostgresUserRepository(db), creditService);
  const rateLimitStore = dependencies.rateLimitStore ?? resolveRateLimitStore();

  return {
    balloonService,
    billingCreditGrantService,
    billingService,
    compositionGalleryService,
    creditService,
    entityService,
    entityReferenceService,
    entityReferenceImageExportService,
    entityGenerationQueue,
    episodePageSkeletonQueue,
    episodePageSkeletonService,
    episodeStoryAutofillQueue,
    episodeStoryAutofillService,
    entityGenerationRecoveryService,
    jobService,
    organizationService,
    organizationBillingService,
    pageExportService,
    pageFinalizeService,
    pageService,
    pageQueryService,
    pageSkeletonService,
    pageGenerationQueue,
    pageGenerationRecoveryService,
    pageGenerationService,
    pageLayoutService,
    panelService,
    panelEntityAssignmentService,
    panelFrameService,
    sceneService,
    storyAiClient,
    storyEpisodeImprovementPlanner,
    storyCollaborationService,
    stripeWebhookService,
    storyService,
    userProvisioningService,
    rateLimitStore,
  };
}

function resolveRateLimitStore(): RateLimitStore {
  if (process.env.NODE_ENV === 'test') {
    return new InMemoryRateLimitStore();
  }

  return new PostgresRateLimitStore(db);
}

function resolveOrganizationInvitationEmailService(
  organizationRepository: PostgresOrganizationRepository,
): OrganizationInvitationEmailServicePort {
  return new OrganizationInvitationEmailService(
    organizationRepository,
    resolveEmailDeliveryService(),
    env.INVITATION_EMAIL_ENABLED,
  );
}

function resolveEmailDeliveryService(): EmailDeliveryPort {
  if (env.EMAIL_PROVIDER === 'ses') {
    if (env.SES_FROM_EMAIL === undefined || env.AWS_REGION === undefined) {
      console.warn(
        '[email] EMAIL_PROVIDER=ses but SES_FROM_EMAIL or AWS_REGION is not configured; invitation email delivery is disabled',
      );
      return new DisabledEmailDeliveryService();
    }
    return new SesEmailDeliveryService({
      region: env.AWS_REGION,
      fromEmail: env.SES_FROM_EMAIL,
      configurationSet: env.SES_CONFIGURATION_SET,
    });
  }

  return new DisabledEmailDeliveryService();
}

function resolveFinalPageImageStorage(): FinalPageImageStoragePort {
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  if (localAssetConfig !== null) {
    return new LocalFileFinalPageImageStorage(localAssetConfig);
  }

  if (env.S3_BUCKET_IMAGES === undefined) {
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
    cdnBaseUrl: resolveS3ImageStorageCdnBaseUrl(),
  });
}

function resolveStripeBillingClient(): StripeBillingClientPort {
  if (env.STRIPE_SECRET_KEY === undefined || env.STRIPE_WEBHOOK_SECRET === undefined) {
    return new StripeBillingClientStub();
  }

  return new StripeBillingClient(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
}

function resolveStoredPageImageLoader(): StoredImageLoaderPort {
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  if (localAssetConfig !== null) {
    return new LocalFileStoredImageLoader(localAssetConfig);
  }

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
  const localAssetConfig = resolveConfiguredLocalAssetConfig();
  if (localAssetConfig !== null) {
    return new LocalFileEntityImageStorage(localAssetConfig);
  }

  if (env.S3_BUCKET_IMAGES === undefined) {
    return new EntityImageStorageStub();
  }

  return new S3EntityImageStorage(createPageImageStorageClient(env.AWS_REGION), {
    bucketName: env.S3_BUCKET_IMAGES,
    cdnBaseUrl: resolveS3ImageStorageCdnBaseUrl(),
  });
}

function resolveS3ImageStorageCdnBaseUrl(): string | undefined {
  return env.IMAGE_DELIVERY_MODE === 'cloudfront_signed' ? env.IMAGES_CDN_BASE_URL : undefined;
}

function resolveEntityImportAnalyzer(): EntityImportAnalyzerPort {
  const client = buildOpenAIClient();
  if (client === null) {
    return new EntityImportAnalyzerStub();
  }

  return new OpenAIEntityImportAnalyzer(client);
}

function resolvePageAutofillCompiler(): PageAutofillCompilerPort {
  const client = buildOpenAIClient();
  if (client === null) {
    return {
      async compileSuggestions(): Promise<never> {
        throw new ConfigurationError('OpenAI page autofill compiler is not configured');
      },
    };
  }

  return new OpenAIPageAutofillCompiler(client);
}

function resolveEpisodePagePlanCompiler(): EpisodePagePlanCompilerPort {
  const client = buildOpenAIClient();
  if (client === null) {
    return {
      async compilePlan(): Promise<never> {
        throw new ConfigurationError('OpenAI episode page plan compiler is not configured');
      },
    };
  }

  return new OpenAIPageEpisodePlanCompiler(client);
}

function resolveStyleReferenceCompiler(): StyleReferenceCompilerPort | undefined {
  if (!env.ENTERPRISE_STYLE_REFERENCES_ENABLED) {
    return undefined;
  }

  const client = buildOpenAIClient();
  if (client === null) {
    return undefined;
  }

  return new OpenAIStyleReferenceCompiler(client);
}

function resolveConfiguredLocalAssetConfig(): LocalAssetConfig | null {
  return resolveLocalAssetConfig(env.LOCAL_FILE_STORAGE_DIR, env.LOCAL_ASSET_BASE_URL, env.PORT);
}

function parseAdminEmails(value: string): string[] {
  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
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
  const client = buildOpenAIClient();
  if (client === null) {
    return new StoryAiClientStub();
  }

  return new OpenAIStoryAiClient(client);
}

function resolveStoryEpisodeImprovementPlanner(): StoryEpisodeImprovementPlannerPort | undefined {
  const client = buildOpenAIClient();
  if (client === null) {
    return undefined;
  }

  return new OpenAIStoryEpisodeImprovementPlanner(client);
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

  public async createSubscriptionUpdatePortalSession(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }

  public async constructWebhookEvent(): Promise<never> {
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
        enterprise_a: resolveEnterpriseStripePriceId('enterprise_a'),
        enterprise_b: resolveEnterpriseStripePriceId('enterprise_b'),
        enterprise_c: resolveEnterpriseStripePriceId('enterprise_c'),
      },
      creditPackagePriceIds: {
        credits_200: env.STRIPE_PRICE_CREDITS_200 ?? '',
        credits_1000: env.STRIPE_PRICE_CREDITS_1000 ?? '',
        credits_3000: env.STRIPE_PRICE_CREDITS_3000 ?? '',
      },
    }),
  );
}

function resolveOrganizationBillingService(
  organizationService: OrganizationServicePort,
  organizationRepository: PostgresOrganizationRepository,
  billingRepository: PostgresBillingRepository,
  stripeBillingClient: StripeBillingClientPort,
): OrganizationBillingServicePort {
  if (!hasStripeBillingConfig()) {
    return new OrganizationBillingServiceStub();
  }

  return new OrganizationBillingService(
    organizationService,
    organizationRepository,
    billingRepository,
    stripeBillingClient,
    assertOrganizationBillingConfig({
      successUrl: env.STRIPE_CHECKOUT_SUCCESS_URL ?? '',
      cancelUrl: env.STRIPE_CHECKOUT_CANCEL_URL ?? '',
      portalReturnUrl: env.STRIPE_PORTAL_RETURN_URL ?? '',
      subscriptionPriceIds: {
        enterprise_a: resolveEnterpriseStripePriceId('enterprise_a'),
        enterprise_b: resolveEnterpriseStripePriceId('enterprise_b'),
        enterprise_c: resolveEnterpriseStripePriceId('enterprise_c'),
      },
      creditPackagePriceIds: {
        credits_200: env.STRIPE_PRICE_CREDITS_200 ?? '',
        credits_1000: env.STRIPE_PRICE_CREDITS_1000 ?? '',
        credits_3000: env.STRIPE_PRICE_CREDITS_3000 ?? '',
      },
    }),
  );
}

function resolveEnterpriseStripePriceId(planCode: EnterprisePlanCode): string | undefined {
  if (planCode === 'enterprise_a') {
    return env.STRIPE_PRICE_ENTERPRISE_A_MONTHLY ?? env.STRIPE_ENTERPRISE_A_PRICE_ID;
  }
  if (planCode === 'enterprise_b') {
    return env.STRIPE_PRICE_ENTERPRISE_B_MONTHLY ?? env.STRIPE_ENTERPRISE_B_PRICE_ID;
  }
  return env.STRIPE_PRICE_ENTERPRISE_C_MONTHLY ?? env.STRIPE_ENTERPRISE_C_PRICE_ID;
}

function resolveStripeWebhookService(
  billingRepository: PostgresBillingRepository,
  billingCreditGrantService: BillingCreditGrantServicePort,
  organizationService: OrganizationServicePort,
  organizationRepository: PostgresOrganizationRepository,
  stripeBillingClient: StripeBillingClientPort,
): StripeWebhookServicePort {
  if (!hasStripeBillingConfig()) {
    return new StripeWebhookServiceStub();
  }

  return new StripeWebhookService(
    billingRepository,
    billingCreditGrantService,
    organizationService,
    organizationRepository,
    stripeBillingClient,
    {
      subscriptionPlanByPriceId: buildSubscriptionPlanByPriceId(),
    },
  );
}

function buildSubscriptionPlanByPriceId(): Record<string, PaidPlanCode> {
  return Object.fromEntries(
    [
      [env.STRIPE_PRICE_STANDARD_MONTHLY, 'standard'],
      [env.STRIPE_PRICE_PREMIUM_MONTHLY, 'premium'],
      [env.STRIPE_PRICE_ENTERPRISE_A_MONTHLY, 'enterprise_a'],
      [env.STRIPE_PRICE_ENTERPRISE_B_MONTHLY, 'enterprise_b'],
      [env.STRIPE_PRICE_ENTERPRISE_C_MONTHLY, 'enterprise_c'],
    ].filter((entry): entry is [string, PaidPlanCode] => typeof entry[0] === 'string' && entry[0].trim().length > 0),
  );
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

  public getSubscriptionPlanCatalog(): SubscriptionPlanCatalogEntry[] {
    return [];
  }
}

class OrganizationBillingServiceStub {
  public async createSubscriptionCheckoutSession(): Promise<never> {
    throw new ConfigurationError('Stripe organization billing is not configured');
  }

  public async createCreditCheckoutSession(): Promise<never> {
    throw new ConfigurationError('Stripe organization billing is not configured');
  }

  public async createCustomerPortalSession(): Promise<never> {
    throw new ConfigurationError('Stripe organization billing is not configured');
  }

  public async getOrganizationSubscriptionSummary(): Promise<never> {
    throw new ConfigurationError('Stripe organization billing is not configured');
  }

  public async listOrganizationInvoices(): Promise<never> {
    throw new ConfigurationError('Stripe organization billing is not configured');
  }

  public getEnterprisePlanCatalog(): SubscriptionPlanCatalogEntry[] {
    return [];
  }
}

class StripeWebhookServiceStub {
  public async handleWebhook(): Promise<never> {
    throw new ConfigurationError('Stripe billing is not configured');
  }
}

class StoryAiClientStub {
  public async *streamCollaboration(): AsyncGenerator<string, void, void> {
    throw new ConfigurationError('OpenAI story AI is not configured');
  }

  public async generatePageSkeleton(): Promise<never> {
    throw new ConfigurationError('OpenAI story AI is not configured');
  }

  public async improveEpisodeDraft(): Promise<never> {
    throw new ConfigurationError('OpenAI story AI is not configured');
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
