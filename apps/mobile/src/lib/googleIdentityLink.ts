import { z } from 'zod';
import type { AuthTokens } from '@/domain/types';
import type { GoogleAuthCapabilities, GoogleLinkStart, GoogleLinkStartBody, GoogleLinkStatus } from '@/domain/googleAuth';

export const googleIdentityLinkReturnUri = 'lyra-mobile://auth/identity-link';

export function googleAllowedOnPlatform(capabilities: GoogleAuthCapabilities | undefined, platform: string, capability: 'google_sign_in' | 'google_linking'): boolean {
  return platform !== 'ios' && capabilities?.[capability] === true;
}

export function validateGoogleAuthorizationUrl(raw: string): string {
  const url = new URL(raw);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash) {
    throw new Error('INVALID_AUTHORIZATION_URL');
  }
  return raw;
}

export function parseGoogleLinkReturn(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (`${url.protocol}//${url.host}${url.pathname}` !== googleIdentityLinkReturnUri || url.hash || url.username || url.password) return null;
    const values = [...url.searchParams.entries()];
    if (values.length !== 1 || values[0]?.[0] !== 'challenge_id') return null;
    const id = z.uuid().safeParse(values[0][1]);
    return id.success ? id.data : null;
  } catch { return null; }
}

export interface GoogleIdentityLinkClient {
  getCurrentSession(): Promise<{ user: { id: string } }>;
  startGoogleIdentityLink(body: GoogleLinkStartBody): Promise<GoogleLinkStart>;
  getGoogleIdentityLinkStatus(id: string): Promise<GoogleLinkStatus>;
}
interface LinkFlowPorts {
  expectedUserId: string;
  currentUserId: () => string | null;
  reauthenticate: () => Promise<AuthTokens>;
  createClient: (tokens: AuthTokens) => GoogleIdentityLinkClient;
  createRequestKey: () => string;
  openBrowser: (url: string, returnUri: string) => Promise<{ type: string; url?: string }>;
}

// The flow owns only short-lived native reauthentication in memory. It has no
// token persistence or AppState mutation port. Only authenticated server status
// establishes success; a browser return is not evidence of identity ownership.
export class GoogleIdentityLinkFlow {
  private prepared: { client: GoogleIdentityLinkClient; requestKey: string } | null = null;
  private receipt: GoogleLinkStart | null = null;
  private valid = true;
  private inFlight: Promise<GoogleLinkStatus> | null = null;
  public constructor(private readonly ports: LinkFlowPorts) {}
  public get canRetryStart(): boolean { return this.prepared !== null && this.receipt === null; }
  public get challengeId(): string | null { return this.receipt?.challenge_id ?? null; }
  public get requiresReauthentication(): boolean { return this.receipt?.status === 'pending' && this.receipt.requires_reauthentication; }
  public get canContinueAuthorization(): boolean { return this.receipt?.status === 'pending' && this.receipt.authorization_url !== null && !this.receipt.requires_reauthentication; }
  public invalidate(): void { this.valid = false; this.prepared = null; }
  private assertCurrent(): void {
    if (!this.valid || this.ports.currentUserId() !== this.ports.expectedUserId) throw new Error('SESSION_CHANGED');
  }
  public start(): Promise<GoogleLinkStatus> {
    if (this.inFlight !== null) return this.inFlight;
    const pending = this.startOnce();
    this.inFlight = pending;
    void pending.then(() => { this.inFlight = null; }, () => { this.inFlight = null; });
    return pending;
  }
  private async startOnce(): Promise<GoogleLinkStatus> {
    this.assertCurrent();
    if (this.prepared === null) {
      const tokens = await this.ports.reauthenticate();
      this.assertCurrent();
      const client = this.ports.createClient(tokens);
      const session = await client.getCurrentSession();
      this.assertCurrent();
      if (session.user.id !== this.ports.expectedUserId) throw new Error('ACCOUNT_MISMATCH');
      this.prepared = { client, requestKey: this.ports.createRequestKey() };
    }
    if (this.receipt === null) {
      this.receipt = await this.prepared.client.startGoogleIdentityLink({ platform: 'mobile', request_key: this.prepared.requestKey });
    }
    this.assertCurrent();
    if (this.receipt.status === 'pending' && this.receipt.authorization_url !== null && !this.receipt.requires_reauthentication) {
      const url = validateGoogleAuthorizationUrl(this.receipt.authorization_url);
      const result = await this.ports.openBrowser(url, googleIdentityLinkReturnUri);
      this.assertCurrent();
      if (result.type === 'success' && parseGoogleLinkReturn(result.url ?? '') !== this.receipt.challenge_id) throw new Error('INVALID_RETURN');
    }
    return this.check();
  }
  public async check(): Promise<GoogleLinkStatus> {
    this.assertCurrent();
    if (this.prepared === null || this.receipt === null) throw new Error('NO_CHALLENGE');
    const status = await this.prepared.client.getGoogleIdentityLinkStatus(this.receipt.challenge_id);
    this.assertCurrent();
    if (status.challenge_id !== this.receipt.challenge_id) throw new Error('INVALID_STATUS');
    // A status read proves the outcome but cannot reissue authorization for a
    // changed native session. Keep that pending restriction until the user
    // explicitly verifies again and creates a separate flow with a new key.
    const result = { ...status, requires_reauthentication: status.requires_reauthentication || (status.status === 'pending' && this.receipt.requires_reauthentication) };
    this.receipt = { ...result, authorization_url: result.status === 'pending' && !result.requires_reauthentication ? this.receipt.authorization_url : null };
    return result;
  }
}
