export interface XProfile { subject: string; email: string; name: string }
export type XArtifactKind = 'state' | 'email' | 'code' | 'access' | 'delivery';
export interface XArtifact {
  kind: XArtifactKind;
  hash: string;
  bindingHash: string;
  ciphertext: string;
  expiresAt: Date;
  proofHash?: string;
}
export interface XArtifactRepository {
  save(artifact: XArtifact): Promise<void>;
  find(kind: XArtifactKind, hash: string, bindingHash: string): Promise<XArtifact | null>;
  consume(kind: XArtifactKind, hash: string, bindingHash: string, proofHash?: string): Promise<XArtifact | null>;
  prune(): Promise<void>;
  reserveEmailDelivery(emailHash: string): Promise<boolean>;
}
export interface XOidcCryptoPort {
  seal(value: unknown): string;
  open(ciphertext: string): unknown;
  signIdentity(profile: XProfile, nonce: string | undefined, nowSeconds: number): Promise<string>;
  jwks(): Promise<{ keys: import('jose').JWK[] }>;
}
export interface XOAuthPort {
  buildAuthorizationUrl(state: string, verifier: string): string;
  exchange(code: string, verifier: string): Promise<XProfile>;
}
export interface XOidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  cognitoRedirectUri: string;
  proofSecret: string;
  androidEnabled: boolean;
}
export class XOidcError extends Error {
  public constructor(public readonly code: string, public readonly status: 400 | 401 | 503 = 400) {
    super('X sign-in is unavailable. Return to Lyra and try again.');
    this.name = 'XOidcError';
  }
}
