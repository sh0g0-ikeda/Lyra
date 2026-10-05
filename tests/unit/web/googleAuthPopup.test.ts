import { createGlobalStubScope } from './googleTestGlobals.js';
import {afterEach, describe, expect, it, vi} from 'vitest';
const globals = createGlobalStubScope();
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
 } finally { vi.useRealTimers(); globals.restore(); }
});
describe('Google popup boundaries',()=>{
 it('requires source, origin, nonce and valid proof and handles duplicate messages once',async()=>{
  const s=setup();const session={accessToken:'fresh',idToken:'native-id',refreshToken:null,expiresAt:Date.now()+60000}; const proof={type:'lyra:web:google-native-proof',nonce,session,error:false};
  const promise=track(s.flow.reauthenticate());await flushUntil(()=>s.popup.location.assign.mock.calls.length > 0);
  const bootstrap=new URL(s.popup.location.assign.mock.calls[0][0]);expect(bootstrap.origin+bootstrap.pathname).toBe('https://app.test/auth/identity-link/reauth');expect(s.values.size).toBe(0);
  s.send({type:'lyra:web:google-reauth-ready',nonce});await flushUntil(()=>s.popup.location.assign.mock.calls.length > 1);
  const url=new URL(s.popup.location.assign.mock.calls[1][0]);expect(url.searchParams.get('identity_provider')).toBe('COGNITO');expect(url.searchParams.get('prompt')).toBe('login');
  s.send(proof,'https://evil.test');s.send(proof,'https://app.test',{});s.send({...proof,nonce:challenge});expect(s.listeners.size).toBe(1);
  s.send(proof);s.send(proof);expect(await promise).toEqual(session);expect(s.listeners.size).toBe(0);expect(s.values.get('lyra:web:cognito-session')).toBeUndefined(); s.flow.close();
 });
 it('fresh proof後は信頼できないWindowProxyのclosed値に依存せずnonce relayで同じpopupをGoogleへ進める',async()=>{
  const s=setup();const channels=new Map<string,Set<Channel>>();
  class Channel {
   private readonly listeners=new Set<(event:MessageEvent)=>void>();
   public constructor(private readonly name:string){const peers=channels.get(name)??new Set<Channel>();peers.add(this);channels.set(name,peers);}
   public postMessage(value:unknown){for(const peer of channels.get(this.name)??[])if(peer!==this)for(const listener of peer.listeners)listener({data:value} as MessageEvent);}
   public addEventListener(_name:string,listener:(event:MessageEvent)=>void){this.listeners.add(listener);}
   public removeEventListener(_name:string,listener:(event:MessageEvent)=>void){this.listeners.delete(listener);}
   public close(){channels.get(this.name)?.delete(this);}
  }
  (s.host as typeof s.host & {BroadcastChannel:typeof BroadcastChannel}).BroadcastChannel=Channel as unknown as typeof BroadcastChannel;
  const session={accessToken:'fresh',idToken:'native-id',refreshToken:null,expiresAt:Date.now()+60000};const reauth=track(s.flow.reauthenticate());await flushUntil(()=>s.popup.location.assign.mock.calls.length===1);s.send({type:'lyra:web:google-reauth-ready',nonce});await flushUntil(()=>s.popup.location.assign.mock.calls.length===2);
  const proofSender=new Channel(`lyra:web:google-reauth:${nonce}`);proofSender.postMessage({type:'lyra:web:google-native-proof',nonce,session,error:false});expect(await reauth).toEqual(session);proofSender.close();
  const relay=new Channel(`lyra:web:google-reauth-relay:${nonce}`);relay.addEventListener('message',(event:MessageEvent)=>{const value=event.data as {type?:string;challengeId?:string};if(value.type==='authorize'&&value.challengeId===challenge){const returned=new Channel(`lyra:web:google-link:${challenge}`);returned.postMessage({type:'lyra:web:google-link-return',challengeId:challenge});returned.close();}});
  expect(await s.flow.openAuthorization('https://accounts.google.com/o/oauth2/v2/auth?state=opaque',challenge)).toEqual({type:'returned',challengeId:challenge});expect(s.popup.location.assign).toHaveBeenCalledTimes(2);relay.close();
 });
 it('checks exact challenge source and resolves user closure without claiming success',async()=>{
  vi.useFakeTimers();const s=setup();const pending=track(s.flow.openAuthorization('https://accounts.google.com/o/oauth2/v2/auth?state=opaque',challenge));
  s.send({type:'lyra:web:google-link-return',challengeId:nonce});expect(s.listeners.size).toBe(1);s.popup.closed=true;vi.advanceTimersByTime(500);await Promise.resolve();expect(await pending).toEqual({type:'closed'});expect(s.listeners.size).toBe(0);
 });
 it('explicit cancel resolves an authorization wait immediately and closes the reserved popup',async()=>{
  const s=setup();const pending=track(s.flow.openAuthorization('https://accounts.google.com/o/oauth2/v2/auth?state=opaque',challenge));await flushUntil(()=>s.listeners.size===1);s.flow.cancel();expect(await pending).toEqual({type:'closed'});expect(s.popup.close).toHaveBeenCalledTimes(1);expect(s.listeners.size).toBe(0);
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
 it('COOPでopenerが失われてもnonce限定channelでfresh proofとGoogle遷移を一度だけ中継しmain sessionを保存しない',async()=>{
  const messages:unknown[]=[];let closeCount=0;
  const channels=new Map<string,Set<Channel>>();
  class Channel {
   private readonly listeners=new Set<(event:MessageEvent)=>void>();
   public constructor(private readonly name:string){const peers=channels.get(name)??new Set<Channel>();peers.add(this);channels.set(name,peers);}
   public postMessage(value:unknown){messages.push(value);for(const peer of channels.get(this.name)??[])if(peer!==this)for(const listener of peer.listeners)listener({data:value} as MessageEvent);}
   public addEventListener(_name:string,listener:(event:MessageEvent)=>void){this.listeners.add(listener);}
   public removeEventListener(_name:string,listener:(event:MessageEvent)=>void){this.listeners.delete(listener);}
   public close(){channels.get(this.name)?.delete(this);closeCount+=1;}
  }
  const values=new Map<string,string>([
   ['lyra:web:google-reauth-window',JSON.stringify({nonce,createdAt:Date.now()})],
   ['lyra:web:cognito-reauth-pkce',JSON.stringify({state:'state-one',verifier:'verifier-one',createdAt:Date.now()})],
  ]);
  const idToken=`e30.${Buffer.from(JSON.stringify({aud:'client',token_use:'id',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.fixture`;
  globals.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:'fresh-access',id_token:idToken,expires_in:3600}),{status:200})));
  const assign=vi.fn(),clearTimeout=vi.fn();const host={location:{pathname:'/',origin:'https://app.test',href:'https://app.test/?code=code-one&state=state-one',search:'?code=code-one&state=state-one',hash:'',assign},history:{replaceState:vi.fn()},sessionStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)},opener:null,document:{body:{textContent:''}},BroadcastChannel:Channel,setTimeout:vi.fn(()=>1),clearTimeout,close:vi.fn()};
  expect(await processGooglePopupReturn(host as unknown as Window,config)).toBe(true);expect(messages).toContainEqual({type:'lyra:web:google-native-proof',nonce,session:expect.objectContaining({accessToken:'fresh-access'}),error:false});expect(values.has('lyra:web:cognito-session')).toBe(false);expect(values.has('lyra:web:google-reauth-window')).toBe(false);
  const sender=new Channel(`lyra:web:google-reauth-relay:${nonce}`);sender.postMessage({type:'authorize',nonce:challenge,challengeId:challenge,url:'https://accounts.google.com/o/oauth2/v2/auth?state=ignored'});expect(assign).not.toHaveBeenCalled();
  const googleUrl='https://accounts.google.com/o/oauth2/v2/auth?state=opaque';sender.postMessage({type:'authorize',nonce,challengeId:challenge,url:googleUrl});sender.postMessage({type:'authorize',nonce,challengeId:challenge,url:googleUrl});expect(assign).toHaveBeenCalledTimes(1);expect(assign).toHaveBeenCalledWith(googleUrl);expect(clearTimeout).toHaveBeenCalledTimes(1);sender.close();expect(closeCount).toBeGreaterThanOrEqual(3);
 });
 it('ordinary storage restrictions return to the existing app error boundary',async()=>{
  const host={location:{pathname:'/'},sessionStorage:{getItem:()=>{throw new Error('blocked');}}};
  expect(await processGooglePopupReturn(host as unknown as Window,config)).toBe(false);
 });
 it('expired bootstrap marker is removed and cannot start token exchange or a relay',async()=>{
  const removeItem=vi.fn(),fetchMock=vi.fn();globals.stubGlobal('fetch',fetchMock);
  const host={location:{pathname:'/',origin:'https://app.test'},sessionStorage:{getItem:()=>JSON.stringify({nonce,createdAt:Date.now()-10*60_000}),removeItem},opener:null,document:{body:{textContent:''}}};
  expect(await processGooglePopupReturn(host as unknown as Window,config)).toBe(true);expect(removeItem).toHaveBeenCalledWith('lyra:web:google-reauth-window');expect(fetchMock).not.toHaveBeenCalled();expect(host.document.body.textContent).toContain('original Lyra tab');
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
