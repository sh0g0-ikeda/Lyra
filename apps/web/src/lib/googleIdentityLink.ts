import { z } from 'zod';
import { googleAuthCapabilitiesV2Schema, googleLinkStartBodySchema, googleLinkStartSchema, googleLinkStatusSchema } from '../../../../packages/api-contract/src/mobileApiSchemas.js';
export { googleAuthCapabilitiesV2Schema, googleLinkStartBodySchema, googleLinkStartSchema, googleLinkStatusSchema };
export type GoogleAuthCapabilities = z.infer<typeof googleAuthCapabilitiesV2Schema>;
export type GoogleLinkStart = z.infer<typeof googleLinkStartSchema>;
export type GoogleLinkStatus = z.infer<typeof googleLinkStatusSchema>;
export const googleWebReturnPath = '/auth/identity-link';
export function googleAllowedOnWeb(capabilities: GoogleAuthCapabilities | undefined, capability: 'google_sign_in' | 'google_linking', platform: string, maxTouchPoints: number): boolean {
  const ios = /iPad|iPhone|iPod/u.test(platform) || (/Mac/u.test(platform) && maxTouchPoints > 1);
  return capabilities?.[capability] === true && (!ios || capabilities.google_ios);
}
export function validateGoogleAuthorizationUrl(raw: string): string {
  const url = new URL(raw);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash) throw new Error('INVALID_AUTHORIZATION_URL');
  return raw;
}
export function parseGoogleWebReturn(raw: string, origin: string): string | null {
  try {
    const url = new URL(raw);
    const values = [...url.searchParams.entries()];
    if (url.origin !== origin || url.pathname !== googleWebReturnPath || url.hash || url.username || url.password || values.length !== 1 || values[0]?.[0] !== 'challenge_id') return null;
    const id = z.string().uuid().safeParse(values[0][1]);
    return id.success ? id.data : null;
  } catch { return null; }
}
export interface GoogleLinkClient {
  getCurrentSession(): Promise<{ user: { id: string } }>;
  startGoogleIdentityLink(body: z.infer<typeof googleLinkStartBodySchema>): Promise<GoogleLinkStart>;
  getGoogleIdentityLinkStatus(id: string): Promise<GoogleLinkStatus>;
}
interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface FlowPorts {
  ownerId: string;
  currentOwnerId(): string | null;
  storage: StoragePort;
  currentClient: GoogleLinkClient;
  reauthenticate(): Promise<GoogleLinkClient>;
  requestKey(): string;
  openAuthorization(url: string, challengeId: string): Promise<{ type: 'returned' | 'closed'; challengeId?: string }>;
  closePopup(): void;
}
const savedSchema = z.object({ version: z.literal(1), ownerId: z.string(), requestKey: z.string().uuid(), challengeId: z.string().uuid().nullable(), status: googleLinkStatusSchema.nullable() }).strict();
type Saved = z.infer<typeof savedSchema>;
// Only non-secret receipt metadata survives reload. A fresh proof is kept in memory
// for retries of the exact request; a callback can only trigger authenticated GET.
export class WebGoogleIdentityLinkFlow {
  private readonly ports: FlowPorts;
  private saved: Saved | null;
  private freshClient: GoogleLinkClient | null = null;
  private receipt: GoogleLinkStart | null = null;
  private pending: Promise<void> | null = null;
  private checking: Promise<void> | null = null;
  private valid = true;
  private needsFreshProof = false;
  private currentClient: GoogleLinkClient;
  public constructor(ports: FlowPorts) {
    this.ports = ports;
    this.currentClient = ports.currentClient;
    this.saved = this.read();
  }
  private get storageKey(): string { return `lyra:web:google-link:${this.ports.ownerId}`; }
  public get snapshot() {
    const status = this.saved?.status ?? null;
    const pending = status === null || status.status === 'pending';
    const requiresReauthentication = pending && this.saved !== null && (this.freshClient === null || this.receipt?.requires_reauthentication === true || this.needsFreshProof);
    return { status, challengeId: this.saved?.challengeId ?? null, hasAttempt: this.saved !== null, requiresReauthentication,
      canRetryStart: this.saved !== null && this.freshClient !== null && this.receipt === null && !this.needsFreshProof,
      canContinue: this.receipt?.status === 'pending' && this.receipt.authorization_url !== null && !requiresReauthentication };
  }
  public updateCurrentClient(client: GoogleLinkClient): void { this.currentClient = client; }
  public activate(): void { this.valid = true; }
  public invalidate(): void { this.valid = false; this.freshClient = null; this.ports.closePopup(); }
  private assertCurrent(): void {
    if (!this.valid || this.ports.currentOwnerId() !== this.ports.ownerId) throw new Error('SESSION_CHANGED');
  }
  private read(): Saved | null {
    try { const parsed = savedSchema.safeParse(JSON.parse(this.ports.storage.getItem(this.storageKey) ?? 'null')); return parsed.success && parsed.data.ownerId === this.ports.ownerId ? parsed.data : null; } catch { return null; }
  }
  private save(saved: Saved, requireDurable = false): void {
    // New requests must be durable before POST. A received server receipt stays
    // available in memory even if later persistence fails.
    if (!requireDurable) this.saved = saved;
    this.ports.storage.setItem(this.storageKey, JSON.stringify(saved));
    this.saved = saved;
  }
  public start(): Promise<void> { return this.run(() => this.startOnce()); }
  private run(action: () => Promise<void>): Promise<void> {
    if (this.pending !== null) return this.pending;
    const promise = action();
    this.pending = promise;
    void promise.then(() => { this.pending = null; }, (error: unknown) => { this.pending = null; if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'RECENT_AUTH_REQUIRED') this.needsFreshProof = true; this.ports.closePopup(); });
    return promise;
  }
  // Called only after an explicit confirmation. Existing receipt remains until
  // fresh native proof and same-owner /me succeed; no automatic request reset.
  public restart(): Promise<void> { return this.run(() => this.restartOnce()); }
  private async restartOnce(): Promise<void> {
    this.assertCurrent();
    const fresh = await this.ports.reauthenticate();
    this.assertCurrent();
    if ((await fresh.getCurrentSession()).user.id !== this.ports.ownerId) throw new Error('ACCOUNT_MISMATCH');
    this.assertCurrent();
    this.save({version:1,ownerId:this.ports.ownerId,requestKey:this.ports.requestKey(),challengeId:null,status:null}, true);
    this.freshClient = fresh;
    this.receipt = null;
    this.needsFreshProof = false;
    return this.startOnce();
  }
  private async startOnce(): Promise<void> {
    this.assertCurrent();
    if (this.needsFreshProof || (this.saved !== null && this.freshClient === null)) throw new Error('REAUTHENTICATION_REQUIRED');
    if (this.freshClient === null) {
      const fresh = await this.ports.reauthenticate();
      this.assertCurrent();
      if ((await fresh.getCurrentSession()).user.id !== this.ports.ownerId) throw new Error('ACCOUNT_MISMATCH');
      this.assertCurrent();
      this.save({version:1,ownerId:this.ports.ownerId,requestKey:this.ports.requestKey(),challengeId:null,status:null}, true);
      this.freshClient = fresh;
    }
    if (this.receipt === null) {
      const receipt = googleLinkStartSchema.parse(await this.freshClient.startGoogleIdentityLink({platform:'web',request_key:this.saved!.requestKey}));
      this.assertCurrent();
      this.receipt = receipt;
      this.save({...this.saved!,challengeId:receipt.challenge_id,status:this.statusOnly(receipt)});
    }
    if (this.snapshot.canContinue) {
      const result = await this.ports.openAuthorization(validateGoogleAuthorizationUrl(this.receipt.authorization_url!), this.receipt.challenge_id);
      this.assertCurrent();
      if (result.type === 'returned' && result.challengeId !== this.receipt.challenge_id) throw new Error('INVALID_RETURN');
    } else { this.ports.closePopup(); }
    await this.check();
  }
  private statusOnly(value: GoogleLinkStatus): GoogleLinkStatus {
    return {challenge_id:value.challenge_id,status:value.status,expires_at:value.expires_at,requires_reauthentication:value.requires_reauthentication,...(value.message_code === undefined ? {} : {message_code:value.message_code})};
  }
  public check(): Promise<void> {
    if (this.checking !== null) return this.checking;
    const promise = this.checkOnce();
    this.checking = promise;
    void promise.then(() => { this.checking = null; }, () => { this.checking = null; });
    return promise;
  }
  private async checkOnce(): Promise<void> {
    this.assertCurrent();
    if (!this.saved?.challengeId) throw new Error('NO_CHALLENGE');
    const value = googleLinkStatusSchema.parse(await (this.freshClient ?? this.currentClient).getGoogleIdentityLinkStatus(this.saved.challengeId));
    this.assertCurrent();
    if (value.challenge_id !== this.saved.challengeId) throw new Error('INVALID_STATUS');
    const status = {...value,requires_reauthentication:value.requires_reauthentication || (value.status === 'pending' && this.snapshot.requiresReauthentication)};
    this.save({...this.saved,status});
    if (this.receipt !== null) this.receipt = {...status,authorization_url:status.status === 'pending' && !status.requires_reauthentication ? this.receipt.authorization_url : null};
  }
}
