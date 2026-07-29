import { Hono, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import {
  pushTokenInstallationIdSchema,
  pushTokenRegistrationBodySchema,
} from '../lib/validators/pushToken.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type {
  PushTokenRegistryServicePort,
} from '../services/notification/PushTokenRegistryService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';
import { pushTokenRegistrationSchema } from '../../packages/api-contract/src/mobileApiSchemas.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';

export interface PushTokenRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  pushTokenRegistryService: PushTokenRegistryServicePort;
}

export function createPushTokenRoutes(
  dependencies: PushTokenRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/push-tokens', async (c) => {
    const body = pushTokenRegistrationBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Push token registration',
      }),
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const user = c.get('user');
    const registration = await dependencies.pushTokenRegistryService.register(user.id, {
      installationId: body.data.installation_id,
      platform: body.data.platform,
      deviceToken: body.data.device_token,
      locale: body.data.locale,
    });

    c.header('Cache-Control', 'no-store');
    const payload = {
      status: 'registered',
      installation_id: registration.installationId,
      platform: registration.platform,
    };
    return c.json(assertMobileResponseContract(pushTokenRegistrationSchema, payload));
  });

  app.delete('/push-tokens/:installationId', async (c) => {
    const installationId = pushTokenInstallationIdSchema.safeParse(
      c.req.param('installationId'),
    );
    if (!installationId.success) {
      throw new ValidationError(formatZodValidationError(installationId.error));
    }

    const user = c.get('user');
    await dependencies.pushTokenRegistryService.remove(user.id, installationId.data);
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  });

  return app;
}
