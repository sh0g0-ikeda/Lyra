import { CognitoIdentityProviderClient, ListUsersCommand, type ListUsersCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { guardGooglePreSignUp, type PreSignUpEvent } from '../../services/auth/GooglePreSignUpGuard.js';
interface CognitoUserLookupClient { send(command: ListUsersCommand, options: { abortSignal: AbortSignal }): Promise<ListUsersCommandOutput>; }
// AWS documents case-insensitive user-attribute searches. Use an exact email
// filter rather than reading the whole pool; still compare normalized values and
// consume all matching pages. One overall deadline stays below the trigger's
// five-second response limit. Any lookup uncertainty fails closed.
export async function hasNativeCognitoEmail(client: CognitoUserLookupClient, userPoolId: string, email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    let token: string | undefined;
    const abortSignal = AbortSignal.timeout(3500);
    const filter = `email = "${normalized.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
    for (let page = 0; page < 10; page++) {
        const result = await client.send(new ListUsersCommand({ UserPoolId: userPoolId, Filter: filter, Limit: 60, ...(token ? { PaginationToken: token } : {}) }), { abortSignal });
        if ((result.Users ?? []).some(user => user.UserStatus !== 'EXTERNAL_PROVIDER' && (user.Attributes ?? []).some(attribute => attribute.Name === 'email' && attribute.Value?.trim().toLowerCase() === normalized))) return true;
        token = result.PaginationToken;
        if (!token) return false;
    }
    throw new Error('Identity lookup is unavailable');
}
// Deploy only after composing existing pool triggers. Importing this module does
// not modify a pool, create IAM permissions, or register a trigger.
const client = new CognitoIdentityProviderClient({ maxAttempts: 1 });
export async function handler<T extends PreSignUpEvent>(event: T): Promise<T> {
    return guardGooglePreSignUp(event, { hasNativeUserWithEmail: (pool, email) => hasNativeCognitoEmail(client, pool, email) });
}
