import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LyraApiClient } from '../lib/api';
import { beginCognitoLogin, type CognitoAuthConfig } from '../lib/cognitoAuth';
import { GoogleAuthPopup } from '../lib/googleAuthPopup';
import { googleAllowedOnWeb, WebGoogleIdentityLinkFlow } from '../lib/googleIdentityLink';
import { googleAuthErrorMessage, googleAuthMessages } from '../lib/googleAuthMessages';
const publicApi = new LyraApiClient(() => null);
function useGoogleCapability(capability: 'google_sign_in'|'google_linking'): boolean {
  const query=useQuery({queryKey:['google-auth-capabilities'],queryFn:()=>publicApi.getGoogleAuthCapabilities(),staleTime:60_000,retry:false});
  return googleAllowedOnWeb(query.data,capability,navigator.platform,navigator.maxTouchPoints);
}
export function GoogleSignInButton({config,language}:{config:CognitoAuthConfig|null;language:'en'|'ja'}) {
  const allowed=useGoogleCapability('google_sign_in');
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  if (!allowed || config===null) return null;
  return <>
    <button className="secondary-button" disabled={busy} type="button" onClick={()=>{
      setBusy(true);setError(null);
      void beginCognitoLogin(config,window.sessionStorage,window.location,window.crypto,{identityProvider:'Google'}).catch(error=>{setError(googleAuthErrorMessage(error,language));setBusy(false);});
    }}>{googleAuthMessages(language).signIn}</button>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
export function GoogleIdentityLinkPanel(props:{config:CognitoAuthConfig|null;userId:string;api:LyraApiClient;language:'en'|'ja';onLogout:()=>Promise<void>}) {
  const allowed=useGoogleCapability('google_linking');
  if (!allowed || props.config===null) return null;
  return <EnabledLinkPanel key={props.userId} {...props} config={props.config}/>;
}
function EnabledLinkPanel({config,userId,api,language,onLogout}:{config:CognitoAuthConfig;userId:string;api:LyraApiClient;language:'en'|'ja';onLogout:()=>Promise<void>}) {
  const [popup]=useState(()=>new GoogleAuthPopup(window,config));
  const [flow]=useState(()=>new WebGoogleIdentityLinkFlow({ownerId:userId,currentOwnerId:()=>userId,storage:window.sessionStorage,currentClient:api,requestKey:()=>window.crypto.randomUUID(),
    reauthenticate:async()=>{const session=await popup.reauthenticate();const token=session.idToken;if(!token)throw new Error('REAUTHENTICATION_FAILED');return new LyraApiClient(()=>token);},
    openAuthorization:(url,id)=>popup.openAuthorization(url,id),closePopup:()=>popup.close(),
  }));
  const [snapshot,setSnapshot]=useState(()=>flow.snapshot),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const m=googleAuthMessages(language);
  useEffect(()=>{flow.activate();return ()=>flow.invalidate();},[flow]);
  useEffect(()=>flow.updateCurrentClient(api),[flow,api]);
  useEffect(()=>{
    if(new URLSearchParams(window.location.search).get('account')!=='google-link' || !flow.snapshot.challengeId) return;
    let active=true;
    setBusy(true);
    void flow.check().catch(error=>{if(active)setError(googleAuthErrorMessage(error,language));}).finally(()=>{if(active){setSnapshot(flow.snapshot);setBusy(false);}});
    return ()=>{active=false;};
  },[flow,language]);
  const run=(action:()=>Promise<void>):void=>{
    if(busy)return;
    popup.beginAction();setBusy(true);setError(null);
    void action().catch(error=>setError(googleAuthErrorMessage(error,language))).finally(()=>{setSnapshot(flow.snapshot);setBusy(false);});
  };
  return <section className="stack" aria-label={m.title}>
    <strong>{m.title}</strong><p className="muted small">{m.explanation}</p>
    {error ? <p role="alert">{error}</p> : null}
    {snapshot.status ? <p role="status">{m[snapshot.status.status]}</p> : snapshot.hasAttempt ? <p role="status">{m.unknown}</p> : null}
    {snapshot.requiresReauthentication ? <p>{m.reauth}</p> : null}
    {!snapshot.hasAttempt ? <button className="secondary-button" type="button" disabled={busy} onClick={()=>run(()=>flow.start())}>{m.start}</button> : null}
    {snapshot.canRetryStart || snapshot.canContinue ? <button className="secondary-button" type="button" disabled={busy} onClick={()=>run(()=>flow.start())}>{snapshot.canRetryStart?m.retry:m.continue}</button> : null}
    {snapshot.challengeId ? <button className="secondary-button" type="button" disabled={busy} onClick={()=>run(()=>flow.check())}>{m.check}</button> : null}
    {snapshot.hasAttempt && (snapshot.requiresReauthentication || ['expired','cancelled','failed'].includes(snapshot.status?.status ?? '')) ? <button className="secondary-button" type="button" disabled={busy} onClick={()=>{if(window.confirm(m.restartConfirm))run(()=>flow.restart());}}>{m.restart}</button> : null}
    {busy ? <button className="ghost-button" type="button" onClick={()=>popup.cancel()}>{m.cancel}</button> : null}
    {snapshot.status?.status==='linked' ? <button className="secondary-button" type="button" disabled={busy} onClick={()=>{if(window.confirm(m.reloginConfirm))run(onLogout);}}>{m.relogin}</button> : null}
  </section>;
}
