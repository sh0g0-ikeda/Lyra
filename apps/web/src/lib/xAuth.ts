import { z } from 'zod';

export const xAuthCapabilitiesSchema = z.object({
  x_sign_in: z.boolean(),
  x_android: z.boolean(),
  x_ios: z.boolean()
}).strict();

export type XAuthCapabilities = z.infer<typeof xAuthCapabilitiesSchema>;
const CAPABILITY_TIMEOUT_MS = 10_000;

export async function fetchXAuthCapabilities(fetcher: typeof fetch = fetch): Promise<XAuthCapabilities> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS);
  try {
    const response = await fetcher('/api/auth/x/capabilities', {
      credentials: 'omit',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('X_CAPABILITY_UNAVAILABLE');
    return xAuthCapabilitiesSchema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export function xAllowedOnWeb(
  capabilities: XAuthCapabilities | undefined,
  platform: string,
  maxTouchPoints: number
): boolean {
  const ios = /iPad|iPhone|iPod/u.test(platform) || (/Mac/u.test(platform) && maxTouchPoints > 1);
  return !ios && capabilities?.x_sign_in === true;
}
