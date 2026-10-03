import type { VerifiedCognitoIdentity } from '../domain/types/googleIdentityLink.js';
import type { AuthenticatedUser } from '../domain/types/user.js';

export interface AppEnv {
  Variables: {
    requestId: string;
    authenticatedRateLimitApplied?: boolean;
    authenticatedClientId?: string;
    cognitoIdentity?: VerifiedCognitoIdentity;
    user: AuthenticatedUser;
  };
}
