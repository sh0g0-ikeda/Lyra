import { describe, expect, it } from 'vitest';
import { createOrganizationRoutes } from '../../../src/routes/organizations.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import type { OrganizationRouteDependencies } from '../../../src/routes/organizations.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const endpoints = ['members', 'invitations', 'usage', 'audit-logs'];
function routes(): ReturnType<typeof createOrganizationRoutes> {
  const app = createOrganizationRoutes({
    authMiddleware: async (c, next) => {
      c.set('user', { id: organizationId, supabaseId: organizationId, email: 'test@example.invalid', displayName: null, planCode: 'free' });
      await next();
    },
    rateLimitMiddleware: async (_c, next) => next(),
    organizationService: {
      listMembers: async () => [], listInvitations: async () => [], listUsageEvents: async () => [], listAuditLogs: async () => [],
    } as unknown as OrganizationRouteDependencies['organizationService'],
    organizationBillingService: {} as OrganizationRouteDependencies['organizationBillingService'],
  });
  app.onError(errorHandler);
  return app;
}
describe('deployed organization collection query validation', () => {
  it.each(endpoints)('%s rejects invalid cursors before invoking services', async (endpoint) => {
    const app = routes();
    for (const query of ['limit=1&cursor=INVALID', 'cursor=INVALID', 'limit=0', 'limit=101', 'limit=1.0', 'limit=01', 'limit=', 'limit=1&cursor=', 'limit=1&limit=2', 'limit=1&cursor=a&cursor=b']) {
      const response = await app.request(`/organizations/${organizationId}/${endpoint}?${query}`);
      expect(response.status, `${endpoint}?${query}`).toBe(422);
    }
  });
});
