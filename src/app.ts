import { Hono } from 'hono';
import { db } from './lib/db.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { PostgresCreditRepository } from './repositories/CreditRepository.js';
import { PostgresEntityRepository } from './repositories/EntityRepository.js';
import { PostgresStoryRepository } from './repositories/StoryRepository.js';
import { PostgresUserRepository } from './repositories/UserRepository.js';
import { PostgresWorkRepository } from './repositories/WorkRepository.js';
import { createBillingRoutes } from './routes/billing.js';
import { createEntityRoutes } from './routes/entities.js';
import { createHealthRoutes } from './routes/health.js';
import { createStoryRoutes } from './routes/story.js';
import { UserProvisioningService, type UserProvisioningPort } from './services/auth/UserProvisioningService.js';
import { CreditService, type CreditServicePort } from './services/credit/CreditService.js';
import { EntityService, type EntityServicePort } from './services/entity/EntityService.js';
import { StoryService, type StoryServicePort } from './services/story/StoryService.js';
import type { AppEnv } from './types/app.js';

export interface AppDependencies {
  creditService?: CreditServicePort;
  entityService?: EntityServicePort;
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
    createEntityRoutes({
      authMiddleware,
      entityService: resolvedDependencies.entityService,
    }),
  );
  app.route(
    '/api',
    createStoryRoutes({
      authMiddleware,
      storyService: resolvedDependencies.storyService,
    }),
  );

  return app;
}

function resolveDependencies(dependencies: AppDependencies): Required<Omit<AppDependencies, 'jwtSecret'>> {
  const creditService =
    dependencies.creditService ?? new CreditService(new PostgresCreditRepository(db, db));
  const entityService =
    dependencies.entityService ??
    new EntityService(new PostgresEntityRepository(db), new PostgresWorkRepository(db));
  const storyService =
    dependencies.storyService ?? new StoryService(new PostgresStoryRepository(db));
  const userProvisioningService =
    dependencies.userProvisioningService ??
    new UserProvisioningService(new PostgresUserRepository(db), creditService);

  return {
    creditService,
    entityService,
    storyService,
    userProvisioningService,
  };
}
