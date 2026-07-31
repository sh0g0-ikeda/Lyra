import { describe, expect, it } from 'vitest';
import {
  GooglePubSubPushVerifier,
  type GoogleOidcPayload,
  type GoogleOidcTokenVerifierPort,
} from '../../../../src/infrastructure/google/GooglePubSubPushVerifier.js';

describe('GooglePubSubPushVerifier', () => {
  it('設定audienceとservice accountの署名済みOIDC tokenだけを受理する', async () => {
    const client = new FakeOidcClient({
      email: 'pubsub-push@example.iam.gserviceaccount.com',
      email_verified: true,
      iss: 'https://accounts.google.com',
    });
    const verifier = new GooglePubSubPushVerifier(
      {
        audience: 'https://api.lyra.example/api/webhooks/mobile-purchases/google',
        serviceAccountEmail: 'pubsub-push@example.iam.gserviceaccount.com',
      },
      client,
    );

    await expect(
      verifier.verifyAuthorization('Bearer signed.oidc.token'),
    ).resolves.toBeUndefined();
    expect(client.audiences).toEqual([
      'https://api.lyra.example/api/webhooks/mobile-purchases/google',
    ]);
  });

  it('token欠落とservice account不一致を安全なerrorで拒否する', async () => {
    const verifier = new GooglePubSubPushVerifier(
      {
        audience: 'https://api.lyra.example/webhook',
        serviceAccountEmail: 'pubsub-push@example.iam.gserviceaccount.com',
      },
      new FakeOidcClient({
        email: 'attacker@example.com',
        email_verified: true,
        iss: 'accounts.google.com',
      }),
    );

    await expect(verifier.verifyAuthorization(undefined)).rejects.toThrow(
      'Store notification could not be verified',
    );
    await expect(verifier.verifyAuthorization('Bearer raw-secret-token')).rejects.toThrow(
      'Store notification could not be verified',
    );
  });
});

class FakeOidcClient implements GoogleOidcTokenVerifierPort {
  public readonly audiences: string[] = [];

  public constructor(private readonly payload: GoogleOidcPayload) {}

  public async verifyIdToken(input: {
    idToken: string;
    audience: string;
  }): Promise<{ getPayload(): GoogleOidcPayload | undefined }> {
    this.audiences.push(input.audience);
    return { getPayload: () => this.payload };
  }
}
