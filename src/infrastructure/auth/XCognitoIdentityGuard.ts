import { ListUsersCommand, type ListUsersCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import type { XProfile } from '../../domain/auth/XOidcProtocol.js';
import { AccountLinkRequiredError, UnauthorizedError } from '../../domain/errors/index.js';
import type { PreSignUpEvent } from '../../services/auth/GooglePreSignUpGuard.js';

interface CognitoLookup { send(command: ListUsersCommand, options: { abortSignal: AbortSignal }): Promise<ListUsersCommandOutput> }
export async function assertXCognitoProfileAllowed(client: CognitoLookup, pool: string, profile: XProfile): Promise<void> {
  if (await hasOtherCognitoEmail(client, pool, profile.email, profile.subject)) throw new AccountLinkRequiredError();
}
export async function hasOtherCognitoEmail(client: CognitoLookup, pool: string, email: string, allowedSubject?: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const filter = `email = "${normalized.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
  let token: string | undefined;
  const abortSignal = AbortSignal.timeout(3500);
  try {
    for (let page = 0; page < 10; page++) {
      const result = await client.send(new ListUsersCommand({ UserPoolId: pool, Filter: filter, Limit: 60, ...(token ? { PaginationToken: token } : {}) }), { abortSignal });
      for (const user of result.Users ?? []) {
        if (!user.Attributes?.some(a => a.Name === 'email' && a.Value?.trim().toLowerCase() === normalized)) continue;
        if (!allowedSubject || user.Username?.toLowerCase() !== `x_${allowedSubject}` || !matchesXIdentity(user.Attributes.find(a => a.Name === 'identities')?.Value, allowedSubject)) return true;
      }
      token = result.PaginationToken;
      if (!token) return false;
    }
  } catch { throw new UnauthorizedError('Provider identity is unavailable'); }
  throw new UnauthorizedError('Provider identity is unavailable');
}
export async function guardXPreSignUp<T extends PreSignUpEvent>(event: T, hasCollision: (pool: string, email: string) => Promise<boolean>): Promise<T> {
  if (event.triggerSource !== 'PreSignUp_ExternalProvider' || !/^X_/iu.test(event.userName)) return event;
  const { email, email_verified: verified } = event.request.userAttributes;
  if (!email || email.length > 320 || !email.includes('@') || verified !== 'true') throw new UnauthorizedError('Provider identity is unavailable');
  let collision: boolean;
  try { collision = await hasCollision(event.userPoolId, email); } catch { throw new UnauthorizedError('Provider identity is unavailable'); }
  if (collision) throw new AccountLinkRequiredError();
  return event;
}
function matchesXIdentity(value: string | undefined, subject: string): boolean {
  try {
    const identities: unknown = JSON.parse(value ?? 'null');
    return Array.isArray(identities) && identities.length === 1 && identities.some((identity: unknown) => identity !== null && typeof identity === 'object' && 'providerName' in identity && identity.providerName === 'X' && 'userId' in identity && identity.userId === subject);
  } catch { return false; }
}
