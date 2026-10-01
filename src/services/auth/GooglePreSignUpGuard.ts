import { AccountLinkRequiredError, UnauthorizedError } from '../../domain/errors/index.js';
export interface PreSignUpEvent {
    triggerSource: string;
    userPoolId: string;
    userName: string;
    request: {
        userAttributes: Record<string, string | undefined>;
    };
    response: Record<string, unknown>;
}
export interface NativeEmailLookup {
    hasNativeUserWithEmail(userPoolId: string, email: string): Promise<boolean>;
}
/** Compose this guard before an existing trigger. It must never transfer an email
 * alias, auto-confirm a collision, or create a second federated account. */
export async function guardGooglePreSignUp<T extends PreSignUpEvent>(event: T, lookup: NativeEmailLookup): Promise<T> {
    if (event.triggerSource !== 'PreSignUp_ExternalProvider' || !/^Google_/u.test(event.userName))
        return event;
    const email = event.request.userAttributes.email;
    if (typeof email !== 'string' || email.length > 320 || !email.includes('@'))
        throw new UnauthorizedError('Provider identity is unavailable');
    if (await lookup.hasNativeUserWithEmail(event.userPoolId, email))
        throw new AccountLinkRequiredError();
    return event;
}
