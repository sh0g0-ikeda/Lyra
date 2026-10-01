import {afterEach, describe, expect, it, vi} from 'vitest';
import {GoogleAuthPopup, processGooglePopupReturn} from '../../../apps/web/src/lib/googleAuthPopup.js';
const nonce='11111111-1111-4111-8111-111111111111', challenge='33333333-3333-4333-8333-333333333333';
const config={domain:'https://pool.auth.amazoncognito.com',clientId:'client',redirectUri:'https://app.test/',logoutUri:'https://app.test/',scopes:['openid'],apiTokenUse:'id' as const};
const activeFlows: GoogleAuthPopup[] = [];
const pendingActions: Promise<unknown>[] = [];
function track<T>(promise: Promise<T>): Promise<T> {
 pendingActions.push(promise.catch(() => undefined));
 return promise;
}
async function flushUntil(ready: () => boolean): Promise<void> {
 for (let turn = 0; turn < 30; turn += 1) {
  if (ready()) return;
  await Promise.resolve();
 }
 throw new Error('Expected asynchronous fixture step did not settle');
}
function setup(){
 const values=new Map<string,string>(); const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 const listeners=new Set<(event:MessageEvent)=>void>();
 const popup={closed:false,close:vi.fn(()=>{popup.closed=true;}),location:{assign:vi.fn()},sessionStorage:storage,document:{title:'',body:{textContent:''}}};
 const host={open:vi.fn(()=>popup),location:{origin:'https://app.test'},crypto:{randomUUID:()=>nonce,getRandomValues:(bytes:Uint8Array)=>{bytes.fill(1);return bytes;},subtle:{digest:async()=>new Uint8Array(32).buffer}},addEventListener:(_name:string,fn:(event:MessageEvent)=>void)=>listeners.add(fn),removeEventListener:(_name:string,fn:(event:MessageEvent)=>void)=>listeners.delete(fn),setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 const send=(data:unknown,origin='https://app.test',source:unknown=popup)=>listeners.forEach(fn=>fn({data,origin,source} as MessageEvent));
 const flow=new GoogleAuthPopup(host as unknown as Window,config);
 activeFlows.push(flow);
 return {popup,host,send,values,listeners,flow};
}
afterEach(async()=>{
 try {
  for (const flow of activeFlows.splice(0)) flow.close();
  await Promise.all(pendingActions.splice(0));
 } finally { vi.useRealTimers(); }
});
describe('Google popup boundaries',()=>{
 it('requires source, origin, nonce and valid proof and handles duplicate messages once',async()=>{
  const s=setup();const session={accessToken:'fresh',idToken:'native-id',refreshToken:null,expiresAt:Date.now()+60000}; const proof={type:'lyra:web:google-native-proof',nonce,session,error:false};
  const promise=track(s.flow.reauthenticate());await flushUntil(()=>s.popup.location.assign.mock.calls.length > 0);expect(s.popup.location.assign).toHaveBeenCalled();
  const url=new URL(s.popup.location.assign.mock.calls[0][0]);expect(url.searchParams.get('identity_provider')).toBe('COGNITO');expect(url.searchParams.get('prompt')).toBe('login');
  s.send(proof,'https://evil.test');s.send(proof,'https://app.test',{});s.send({...proof,nonce:challenge});expect(s.listeners.size).toBe(1);
  s.send(proof);s.send(proof);expect(await promise).toEqual(session);expect(s.listeners.size).toBe(0);expect(s.values.get('lyra:web:cognito-session')).toBeUndefined(); s.flow.close();
 });
 it('checks exact challenge source and resolves user closure without claiming success',async()=>{
  vi.useFakeTimers();const s=setup();const pending=track(s.flow.openAuthorization('https://accounts.google.com/o/oauth2/v2/auth?state=opaque',challenge));
  s.send({type:'lyra:web:google-link-return',challengeId:nonce});expect(s.listeners.size).toBe(1);s.popup.closed=true;vi.advanceTimersByTime(500);await Promise.resolve();expect(await pending).toEqual({type:'closed'});expect(s.listeners.size).toBe(0);
 });
 it('explicit cancel resolves pending reauthentication and removes listeners',async()=>{
  const s=setup();const pending=track(s.flow.reauthenticate());const outcome=pending.then(()=>null,error=>error as Error);s.flow.close();expect((await outcome)?.message).toBe('POPUP_CLOSED');expect(s.listeners.size).toBe(0);
 });
 it('cancelled preparation does not reopen Google when a late receipt arrives',async()=>{
  const s=setup();s.flow.cancel();expect(await s.flow.openAuthorization('https://accounts.google.com/o/oauth2/v2/auth',challenge)).toEqual({type:'closed'});expect(s.host.open).not.toHaveBeenCalled();
 });
 it('fails before popup creation if Cognito redirect has another origin',async()=>{
  const s=setup();const flow=new GoogleAuthPopup(s.host as unknown as Window,{...config,redirectUri:'https://other.test/'});await expect(flow.reauthenticate()).rejects.toThrow('INVALID_REAUTH_REDIRECT');expect(s.host.open).not.toHaveBeenCalled();
 });
 it('Google callback sends only challenge id and never reaches Cognito exchange',async()=>{
  const postMessage=vi.fn(), replaceState=vi.fn();const host={location:{pathname:'/auth/identity-link',origin:'https://app.test',href:'https://app.test/auth/identity-link?challenge_id='+challenge},history:{replaceState},opener:{postMessage},close:vi.fn(),document:{body:{textContent:''}}};
  expect(await processGooglePopupReturn(host as unknown as Window,config)).toBe(true);expect(postMessage).toHaveBeenCalledWith({type:'lyra:web:google-link-return',challengeId:challenge},'https://app.test');expect(replaceState).toHaveBeenCalledWith(null,'','/?account=google-link');
 });
 it('ordinary storage restrictions return to the existing app error boundary',async()=>{
  const host={location:{pathname:'/'},sessionStorage:{getItem:()=>{throw new Error('blocked');}}};
  expect(await processGooglePopupReturn(host as unknown as Window,config)).toBe(false);
 });
 it.each(['history','opener'])('dedicated return failure in %s never falls into normal auth',async failure=>{
  const host={location:{pathname:'/auth/identity-link',origin:'https://app.test',href:'https://app.test/auth/identity-link?challenge_id='+challenge},history:{replaceState:()=>{if(failure==='history')throw new Error('blocked');}},opener:{postMessage:()=>{throw new Error('opener lost');}},document:{body:{textContent:''}}};
  expect(await processGooglePopupReturn(host as unknown as Window,config)).toBe(true);expect(host.document.body.textContent).toContain('original Lyra tab');
 });
 it.each(['corrupt','storage','opener'])('isolated reauth %s failure stays isolated with safe recovery copy',async failure=>{
  const host={location:{pathname:'/',origin:'https://app.test'},sessionStorage:{getItem:()=>failure==='corrupt'?'invalid':JSON.stringify({nonce,createdAt:Date.now()}),removeItem:()=>{if(failure==='storage')throw new Error('blocked');}},opener:failure==='opener'?null:{},document:{body:{textContent:''}}};
  expect(await processGooglePopupReturn(host as unknown as Window,config)).toBe(true);expect(host.document.body.textContent).toContain('original Lyra tab');
 });
 it('malformed callback and opener loss cannot assert linked status',async()=>{
  const postMessage=vi.fn();const host={location:{pathname:'/auth/identity-link',origin:'https://app.test',href:'https://app.test/auth/identity-link?challenge_id='+challenge+'&code=google-code'},history:{replaceState:vi.fn()},opener:{postMessage},close:vi.fn(),document:{body:{textContent:''}}};
  await processGooglePopupReturn(host as unknown as Window,config);expect(postMessage).not.toHaveBeenCalled();host.opener=null as never;expect(await processGooglePopupReturn(host as unknown as Window,config)).toBe(false);
 });
});
