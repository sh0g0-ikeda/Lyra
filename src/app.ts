import { Hono } from 'hono';
import { db } from './lib/db.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { PostgresCreditRepository } from './repositories/CreditRepository.js';
import { PostgresUserRepository } from './repositories/UserRepository.js';
import { createBillingRoutes } from './routes/billing.js';
import { createHealthRoutes } from './routes/health.js';
import { UserProvisioningService, type UserProvisioningPort } from './services/auth/UserProvisioningService.js';
import { CreditService, type CreditServicePort } from './services/credit/CreditService.js';
import type { AppEnv } from './types/app.js';

export interface AppDependencies {
  creditService?: CreditServicePort;
  userProvisioningService?: UserProvisioningPort;
  jwtSecret?: string;
}

export function createApp(dependencies: AppDependencies = {}): Hono<AppEnv> {
  const resolvedDependencies = resolveDependencies(dependencies);
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);
  app.route('/', createHealthRoutes());
  app.route(
    '/api/billing',
    createBillingRoutes({
      authMiddleware: createAuthMiddleware(resolvedDependencies.userProvisioningService, {
        jwtSecret: dependencies.jwtSecret,
      }),
      creditService: resolvedDependencies.creditService,
    }),
  );

  return app;
}

function resolveDependencies(dependencies: AppDependencies): Required<Omit<AppDependencies, 'jwtSecret'>> {
  const creditService =
    dependencies.creditService ?? new CreditService(new PostgresCreditRepository(db, db));
  const userProvisioningService =
    dependencies.userProvisioningService ??
    new UserProvisioningService(new PostgresUserRepository(db), creditService);

  return {
    creditService,
    userProvisioningService,
  };
}
