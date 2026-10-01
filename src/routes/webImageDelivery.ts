import type { Context } from 'hono';
import { requireAuthorizedWebImageClient } from '../domain/generation/ImageAccessPolicy.js';
import { env } from '../lib/env.js';
import type { AppEnv } from '../types/app.js';
export function hasWebImageDeliveryAccess(c: Context<AppEnv>): boolean {
  const client = c.get('authenticatedClientId');
  return client !== undefined && configuredWebImageClients().includes(client);
}
export function requireWebImageDeliveryAccess(c: Context<AppEnv>): void {
  requireAuthorizedWebImageClient(c.get('authenticatedClientId'), configuredWebImageClients());
}
function configuredWebImageClients(): string[] {
  return env.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS.split(',').map((id) => id.trim()).filter(Boolean);
}
