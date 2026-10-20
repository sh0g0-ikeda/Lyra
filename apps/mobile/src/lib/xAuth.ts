import { z } from 'zod';

import { config } from '@/lib/config';

export const xAuthCapabilitiesSchema = z.object({
  x_sign_in: z.boolean(),
  x_android: z.boolean(),
  x_ios: z.boolean()
}).strict();

export type XAuthCapabilities = z.infer<typeof xAuthCapabilitiesSchema>;

type CapabilityFetcher = typeof fetch;
const CAPABILITY_TIMEOUT_MS = 10_000;

export async function fetchXAuthCapabilities(
  baseUrl = config.apiBaseUrl,
  fetcher: CapabilityFetcher = fetch
): Promise<XAuthCapabilities> {
  const url = new URL('/api/auth/x/capabilities', baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('X_CAPABILITY_UNAVAILABLE');
    return xAuthCapabilitiesSchema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export function xAllowedOnMobile(
  capabilities: XAuthCapabilities | undefined,
  platform: string
): boolean {
  return platform === 'android' && capabilities?.x_sign_in === true && capabilities.x_android === true;
}
