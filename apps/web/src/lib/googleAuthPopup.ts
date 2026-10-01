/// <reference lib="dom" />
import { z } from 'zod';
import { beginCognitoLogin, completeCognitoRedirectIfPresent, COGNITO_SESSION_STORAGE_KEY, type CognitoAuthConfig, type CognitoSession } from './cognitoAuth.js';
import { googleWebReturnPath, parseGoogleWebReturn, validateGoogleAuthorizationUrl } from './googleIdentityLink.js';
const reauthMarker = 'lyra:web:google-reauth-window';
const reauthMessage = 'lyra:web:google-native-proof';
const returnMessage = 'lyra:web:google-link-return';
const markerSchema = z.object({ nonce: z.string().uuid(), createdAt: z.number().finite() }).strict();
const sessionSchema = z.object({ accessToken: z.string().min(1), idToken: z.string().nullable(), refreshToken: z.string().nullable(), expiresAt: z.number().finite() }).strict();
const proofSchema = z.object({ type: z.literal(reauthMessage), nonce: z.string().uuid(), session: sessionSchema.nullable(), error: z.boolean() }).strict();
const returnSchema = z.object({ type: z.literal(returnMessage), challengeId: z.string().uuid() }).strict();

// The opener checks both source and origin. Messages are a wake-up or ephemeral
// native proof, never durable session replacement. Google codes are handled only
// by the backend callback and cannot enter the Cognito token exchange.
export class GoogleAuthPopup {
  private popup: Window | null = null;
  private cancelled = false;
  private cancelWait: (() => void) | null = null;
  private readonly host: Window;
  private readonly config: CognitoAuthConfig;
  public constructor(host: Window, config: CognitoAuthConfig) { this.host = host; this.config = config; }
  public beginAction(): void { this.cancelled = false; }
  public cancel(): void { this.cancelled = true; this.close(); }
  public close(): void { this.cancelWait?.(); this.cancelWait = null; this.popup?.close(); this.popup = null; }
  private reserve(): Window {
    if (this.popup !== null && !this.popup.closed) return this.popup;
    const popup = this.host.open('about:blank', '_blank', 'popup,width=520,height=720');
    if (popup === null) throw new Error('POPUP_BLOCKED');
    this.popup = popup;
    popup.document.title = 'Lyra';
    popup.document.body.textContent = 'Continue in this window. / このウィンドウで続けてください。';
    return popup;
  }
  private wait<T>(popup: Window, parse: (data: unknown) => T | undefined): Promise<T | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: T | null): void => {
        if (settled) return;
        settled = true;
        this.host.removeEventListener('message', onMessage);
        this.host.clearInterval(timer);
        if (this.cancelWait === cancel) this.cancelWait = null;
        resolve(value);
      };
      const onMessage = (event: MessageEvent): void => {
        if (event.origin !== this.host.location.origin || event.source !== popup) return;
        const value = parse(event.data);
        if (value !== undefined) finish(value);
      };
      const cancel = (): void => finish(null);
      const started = Date.now();
      const timer = this.host.setInterval(() => { if (popup.closed || Date.now() - started > 10 * 60_000) finish(null); }, 500);
      this.host.addEventListener('message', onMessage);
      this.cancelWait = cancel;
    });
  }
  public async reauthenticate(): Promise<CognitoSession> {
    if (new URL(this.config.redirectUri).origin !== this.host.location.origin) throw new Error('INVALID_REAUTH_REDIRECT');
    const popup = this.reserve();
    const nonce = this.host.crypto.randomUUID();
    // A popup initially inherits a copy of sessionStorage. Remove only its copy
    // so the isolated return cannot render a studio or persist the new proof.
    popup.sessionStorage.removeItem(COGNITO_SESSION_STORAGE_KEY);
    popup.sessionStorage.setItem(reauthMarker, JSON.stringify({nonce,createdAt:Date.now()}));
    const pending = this.wait(popup, (data) => { const result = proofSchema.safeParse(data); return result.success && result.data.nonce === nonce ? result.data : undefined; });
    const location = { href:popup.location.href, origin:popup.location.origin, pathname:popup.location.pathname, search:popup.location.search, hash:popup.location.hash, assign:(url:string):void=>{if(this.cancelled || popup.closed || this.popup!==popup) throw new Error('POPUP_CLOSED');popup.location.assign(url);} };
    try { await beginCognitoLogin(this.config,popup.sessionStorage,location,this.host.crypto,{identityProvider:'COGNITO',freshLogin:true,mode:'reauthentication'}); }
    catch (error) { this.close(); throw error; }
    const result = await pending;
    if (result === null) throw new Error('POPUP_CLOSED');
    if (result.error || result.session === null) throw new Error('REAUTHENTICATION_FAILED');
    return result.session;
  }
  public async openAuthorization(url: string, challengeId: string): Promise<{type:'returned'|'closed';challengeId?:string}> {
    if (this.cancelled) return {type:'closed'};
    const safeUrl = validateGoogleAuthorizationUrl(url);
    const popup = this.reserve();
    const pending = this.wait(popup, data => { const result = returnSchema.safeParse(data); return result.success && result.data.challengeId === challengeId ? result.data : undefined; });
    popup.location.assign(safeUrl);
    const result = await pending;
    this.close();
    return result === null ? {type:'closed'} : {type:'returned',challengeId:result.challengeId};
  }
}

function showPopupRecovery(host: Window): void {
  try { host.document.body.textContent = 'Return to your original Lyra tab and check the request. If no request was created, verify your existing login again. / 元のLyraタブでリクエストを確認してください。リクエストがない場合は既存ログインを再確認してください。'; }
  catch { /* A torn-down window has no writable UI. Never resume normal auth. */ }
}

export async function processGooglePopupReturn(host: Window, config: CognitoAuthConfig | null): Promise<boolean> {
  if (host.location.pathname === googleWebReturnPath) {
    try {
      const challengeId = parseGoogleWebReturn(host.location.href, host.location.origin);
      host.history.replaceState(null, '', '/?account=google-link');
      if (host.opener !== null) {
        if (challengeId !== null) host.opener.postMessage({ type: returnMessage, challengeId }, host.location.origin);
        showPopupRecovery(host);
        host.close();
        return true;
      }
      // With no opener, Account checks its own saved receipt. No URL status or
      // provider credentials are carried into ordinary Cognito initialization.
      return false;
    } catch {
      showPopupRecovery(host);
      return true;
    }
  }

  let raw: string | null;
  try { raw = host.sessionStorage.getItem(reauthMarker); }
  catch {
    // The ordinary app's existing auth/error boundary handles denied storage.
    // A dedicated Google callback has already been handled above.
    return false;
  }
  if (raw === null) return false;
  try {
    let marker: z.infer<typeof markerSchema> | null = null;
    try {
      const parsed = markerSchema.safeParse(JSON.parse(raw));
      if (parsed.success && Date.now() - parsed.data.createdAt >= 0 && Date.now() - parsed.data.createdAt < 10 * 60_000) marker = parsed.data;
    } catch { /* Invalid isolated state must not become an ordinary login. */ }
    host.sessionStorage.removeItem(reauthMarker);
    if (marker === null || config === null || host.opener === null) {
      showPopupRecovery(host);
      return true;
    }
    host.document.body.textContent = 'Checking sign-in… / ログインを確認中…';
    const result = await completeCognitoRedirectIfPresent(config, host.sessionStorage, host.location, host.history, undefined, Date.now(), { mode: 'reauthentication', persistSession: false });
    host.opener.postMessage({ type: reauthMessage, nonce: marker.nonce, session: result.handled && result.error === null ? result.session : null, error: !result.handled || result.error !== null }, host.location.origin);
    host.document.body.textContent = 'Continue in your original Lyra tab. / 元のLyraタブで続けてください。';
    return true;
  } catch {
    showPopupRecovery(host);
    return true;
  }
}
