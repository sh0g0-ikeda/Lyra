import { describe, expect, it, vi } from 'vitest';
import { WebGoogleIdentityLinkFlow, parseGoogleWebReturn, validateGoogleAuthorizationUrl, googleAllowedOnWeb, type GoogleLinkClient } from '../../../apps/web/src/lib/googleIdentityLink.js';
const owner = '11111111-1111-4111-8111-111111111111';
const requestKey = '22222222-2222-4222-8222-222222222222';
const challenge = '33333333-3333-4333-8333-333333333333';
const receipt = { challenge_id: challenge, status: 'pending' as const, expires_at: '2026-10-01T16:00:00Z', authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque', requires_reauthentication: false };
const statusReceipt = {challenge_id:challenge,status:'pending' as const,expires_at:receipt.expires_at,requires_reauthentication:false};
async function flushUntil(ready: () => boolean): Promise<void> {
 for (let turn = 0; turn < 30; turn += 1) {
  if (ready()) return;
  await Promise.resolve();
 }
 throw new Error('Expected asynchronous fixture step did not settle');
}
function setup() {
 const storage = new Map<string,string>();
 const store = { getItem: (key:string) => storage.get(key) ?? null, setItem: (key:string,value:string) => { storage.set(key,value); } };
 const fresh = { getCurrentSession: vi.fn<GoogleLinkClient['getCurrentSession']>(async () => ({user:{id:owner}})), startGoogleIdentityLink: vi.fn<GoogleLinkClient['startGoogleIdentityLink']>(async () => receipt), getGoogleIdentityLinkStatus: vi.fn<GoogleLinkClient['getGoogleIdentityLinkStatus']>(async () => ({...statusReceipt,status:'linked' as const})) };
 const original = { ...fresh, startGoogleIdentityLink: vi.fn<GoogleLinkClient['startGoogleIdentityLink']>(async () => receipt), getGoogleIdentityLinkStatus: vi.fn<GoogleLinkClient['getGoogleIdentityLinkStatus']>(async () => ({...statusReceipt,status:'pending' as const})) };
 let currentOwner = owner;
 const ports = { ownerId: owner, currentOwnerId: () => currentOwner, storage: store, currentClient: original, reauthenticate: vi.fn(async () => fresh), requestKey: () => requestKey, openAuthorization: vi.fn(async () => ({type:'returned' as const,challengeId:challenge})), closePopup: vi.fn() };
 return {ports,fresh,original,storage,setOwner:(value:string)=>{currentOwner=value;},flow:new WebGoogleIdentityLinkFlow(ports)};
}
describe('Web Google linking',()=>{
 it('uses only fresh matching account for start and preserves current session client',async()=>{
  const s=setup(); await s.flow.start(); expect(s.fresh.startGoogleIdentityLink).toHaveBeenCalledWith({platform:'web',request_key:requestKey}); expect(s.original.startGoogleIdentityLink).not.toHaveBeenCalled(); expect(s.flow.snapshot.status?.status).toBe('linked'); expect([...s.storage.values()].join()).not.toContain('authorization_url');
 });
 it('retains same request key and fresh client after uncertain POST',async()=>{
  const s=setup(); s.fresh.startGoogleIdentityLink.mockRejectedValueOnce(new Error('offline')); await expect(s.flow.start()).rejects.toThrow('offline'); expect(s.flow.snapshot.canRetryStart).toBe(true); await s.flow.start(); expect(s.ports.reauthenticate).toHaveBeenCalledTimes(1); expect(s.fresh.startGoogleIdentityLink.mock.calls).toEqual([[{platform:'web',request_key:requestKey}],[{platform:'web',request_key:requestKey}]]);
 });
 it('reload without the fresh fingerprint never recreates an unknown request',async()=>{
  const s=setup(); s.fresh.startGoogleIdentityLink.mockRejectedValueOnce(new Error('offline')); await expect(s.flow.start()).rejects.toThrow(); const reloaded=new WebGoogleIdentityLinkFlow(s.ports); await expect(reloaded.start()).rejects.toThrow('REAUTHENTICATION_REQUIRED'); expect(s.fresh.startGoogleIdentityLink).toHaveBeenCalledTimes(1); expect(reloaded.snapshot.requiresReauthentication).toBe(true);
 });
 it('reload of known receipt checks authenticated status without opening provider',async()=>{
  const s=setup(); s.fresh.getGoogleIdentityLinkStatus.mockRejectedValueOnce(new Error('offline')); await expect(s.flow.start()).rejects.toThrow(); const reloaded=new WebGoogleIdentityLinkFlow(s.ports); await reloaded.check(); expect(s.original.getGoogleIdentityLinkStatus).toHaveBeenCalledWith(challenge); expect(s.ports.openAuthorization).toHaveBeenCalledTimes(1); expect(reloaded.snapshot.requiresReauthentication).toBe(true);
 });
 it('changed-session receipt requires explicit reauthentication even when GET says false',async()=>{
  const s=setup(); s.fresh.startGoogleIdentityLink.mockResolvedValue({...receipt,authorization_url:null,requires_reauthentication:true}); s.fresh.getGoogleIdentityLinkStatus.mockResolvedValue({...statusReceipt,status:'pending'}); await s.flow.start(); expect(s.ports.openAuthorization).not.toHaveBeenCalled(); expect(s.flow.snapshot.requiresReauthentication).toBe(true);
 });
 it('cancelled popup still checks the receipt; callback is not success evidence',async()=>{
  const s=setup(); s.ports.openAuthorization.mockResolvedValue({type:'closed'} as never); s.fresh.getGoogleIdentityLinkStatus.mockResolvedValue({...statusReceipt,status:'pending'}); await s.flow.start(); expect(s.flow.snapshot.status?.status).toBe('pending');
 });
 it('rejects mismatched owner and receipt before opening Google',async()=>{
  const s=setup(); s.fresh.getCurrentSession.mockResolvedValue({user:{id:'other'}}); await expect(s.flow.start()).rejects.toThrow('ACCOUNT_MISMATCH'); expect(s.fresh.startGoogleIdentityLink).not.toHaveBeenCalled();
 });
 it('suppresses late account changes and single-flights double clicks',async()=>{
  const s=setup(); let resolve!: (value: typeof receipt)=>void; s.fresh.startGoogleIdentityLink.mockImplementation(()=>new Promise(r=>{resolve=r;})); const a=s.flow.start(); expect(s.flow.start()).toBe(a); await flushUntil(()=>resolve !== undefined);expect(resolve).toBeDefined(); s.setOwner('different'); resolve(receipt); await expect(a).rejects.toThrow('SESSION_CHANGED'); expect(s.ports.openAuthorization).not.toHaveBeenCalled();
 });
 it('refuses foreign or token-bearing callback URLs and malformed UUIDs',()=>{
  expect(parseGoogleWebReturn('https://app.test/auth/identity-link?challenge_id='+challenge,'https://app.test')).toBe(challenge);
  for(const url of ['https://evil.test/auth/identity-link?challenge_id='+challenge,'https://app.test/account?challenge_id='+challenge,'https://app.test/auth/identity-link?challenge_id='+challenge+'&token=bad','https://app.test/auth/identity-link?challenge_id=bad']) expect(parseGoogleWebReturn(url,'https://app.test')).toBeNull();
  expect(()=>validateGoogleAuthorizationUrl('https://accounts.google.com.evil.test/o/oauth2/v2/auth')).toThrow();
 });
 it('recent-auth rejection retains the old request until explicit fresh restart',async()=>{
  const s=setup();s.fresh.startGoogleIdentityLink.mockRejectedValueOnce(Object.assign(new Error('recent'),{code:'RECENT_AUTH_REQUIRED'}));await expect(s.flow.start()).rejects.toThrow('recent');expect(s.flow.snapshot.requiresReauthentication).toBe(true);expect(s.flow.snapshot.canRetryStart).toBe(false);await expect(s.flow.start()).rejects.toThrow('REAUTHENTICATION_REQUIRED');expect(s.fresh.startGoogleIdentityLink).toHaveBeenCalledTimes(1);
 });
 it('fails before POST when request-key storage is unavailable',async()=>{
  const s=setup();s.ports.storage.setItem=()=>{throw new Error('storage unavailable');};await expect(s.flow.start()).rejects.toThrow('storage unavailable');expect(s.fresh.startGoogleIdentityLink).not.toHaveBeenCalled();
 });
 it('ignores receipts belonging to another owner and rejects mismatched status',async()=>{
  const s=setup();s.storage.set('lyra:web:google-link:'+owner,JSON.stringify({version:1,ownerId:'other',requestKey,challengeId:challenge,status:null}));const next=new WebGoogleIdentityLinkFlow(s.ports);expect(next.snapshot.hasAttempt).toBe(false);s.fresh.getGoogleIdentityLinkStatus.mockResolvedValue({...statusReceipt,challenge_id:requestKey});await expect(next.start()).rejects.toThrow('INVALID_STATUS');expect(next.snapshot.status?.status).toBe('pending');
 });
 it('single-flights explicit restart and keeps old receipt if fresh verification fails',async()=>{
  const s=setup();await s.flow.start();s.ports.reauthenticate.mockRejectedValueOnce(new Error('cancelled'));const a=s.flow.restart();expect(s.flow.restart()).toBe(a);await expect(a).rejects.toThrow('cancelled');expect(s.flow.snapshot.status?.status).toBe('linked');expect(s.fresh.startGoogleIdentityLink).toHaveBeenCalledTimes(1);
 });
 it('deduplicates receipt reads across repeated return effects',async()=>{
  const s=setup();await s.flow.start();let resolve!: (value:typeof statusReceipt)=>void;s.fresh.getGoogleIdentityLinkStatus.mockImplementation(()=>new Promise(r=>{resolve=r;}));const a=s.flow.check();expect(s.flow.check()).toBe(a);resolve(statusReceipt);await a;expect(s.fresh.getGoogleIdentityLinkStatus).toHaveBeenCalledTimes(2);
 });
 it('retains the previous receipt when explicit restart cannot persist its new key',async()=>{
  const s=setup();await s.flow.start();s.ports.storage.setItem=()=>{throw new Error('storage blocked');};await expect(s.flow.restart()).rejects.toThrow('storage blocked');expect(s.flow.snapshot.status?.status).toBe('linked');expect(s.flow.snapshot.challengeId).toBe(challenge);expect(s.fresh.startGoogleIdentityLink).toHaveBeenCalledTimes(1);
 });
 it('fails closed for unavailable capability and all iOS browsers',()=>{
  const caps={google_sign_in:true,google_linking:true,google_ios:false as const}; expect(googleAllowedOnWeb(caps,'google_sign_in','iPhone',0)).toBe(false); expect(googleAllowedOnWeb(caps,'google_sign_in','MacIntel',5)).toBe(false); expect(googleAllowedOnWeb(undefined,'google_sign_in','Linux',0)).toBe(false); expect(googleAllowedOnWeb(caps,'google_linking','Linux',0)).toBe(true);
 });
});
