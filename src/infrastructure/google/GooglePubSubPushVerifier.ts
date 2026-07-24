import { OAuth2Client } from 'google-auth-library';
import { ValidationError } from '../../domain/errors/index.js';

export interface GooglePubSubPushVerifierConfig {
  audience: string;
  serviceAccountEmail: string;
}

export interface GoogleOidcTokenVerifierPort {
  verifyIdToken(input: { idToken: string; audience: string }): Promise<{
    getPayload(): GoogleOidcPayload | undefined;
  }>;
}

export interface GoogleOidcPayload {
  email?: string;
  email_verified?: boolean;
  iss?: string;
}

export class GooglePubSubPushVerifier {
  public constructor(
    private readonly config: GooglePubSubPushVerifierConfig,
    private readonly client: GoogleOidcTokenVerifierPort = new OAuth2Client(),
  ) {}

  public async verifyAuthorization(authorization: string | undefined): Promise<void> {
    const token = bearerToken(authorization);
    if (token === null) {
      throw new ValidationError('Store notification could not be verified');
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: token,
        audience: this.config.audience,
      });
      const payload = ticket.getPayload();
      if (
        payload === undefined ||
        payload.email !== this.config.serviceAccountEmail ||
        payload.email_verified !== true ||
        (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com')
      ) {
        throw new ValidationError('Store notification could not be verified');
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError('Store notification could not be verified');
    }
  }
}

function bearerToken(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/iu.exec(value);
  if (match === null || match[1].trim().length === 0) {
    return null;
  }
  return match[1].trim();
}
