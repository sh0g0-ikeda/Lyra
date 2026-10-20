import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { beginCognitoLogin, type CognitoAuthConfig } from '../lib/cognitoAuth';
import { fetchXAuthCapabilities, xAllowedOnWeb } from '../lib/xAuth';

const copy = {
  en: {
    signIn: 'Continue with X',
    confirmation: 'We will confirm with a code sent to your verified X email address.',
    existing: 'Already use Lyra? Please sign in using your existing method.',
    unavailable: 'X sign-in is currently unavailable. Please use your existing sign-in method.'
  },
  ja: {
    signIn: 'Xで続ける',
    confirmation: 'Xの確認済みメールに届くコードで確認します。',
    existing: '既存アカウントはこれまでの方法でログインしてください。',
    unavailable: '現在Xログインは利用できません。これまでの方法でログインしてください。'
  }
} as const;

export function XSignInButton({ config, language }: { config: CognitoAuthConfig | null; language: 'en' | 'ja' }): React.JSX.Element | null {
  const query = useQuery({
    queryKey: ['x-auth-capabilities'],
    queryFn: () => fetchXAuthCapabilities(),
    enabled: config !== null,
    retry: false,
    staleTime: 60_000
  });
  const [busy, setBusy] = useState(false);
  const launchInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const messages = copy[language];
  const allowed = !query.isError && xAllowedOnWeb(query.data, navigator.platform, navigator.maxTouchPoints);
  if (!allowed || config === null) return null;

  const onClick = (): void => {
    if (launchInFlight.current) return;
    launchInFlight.current = true;
    setBusy(true);
    setError(null);
    void query.refetch().then(async (current) => {
      if (current.isError || !xAllowedOnWeb(current.data, navigator.platform, navigator.maxTouchPoints)) {
        throw new Error('X_CAPABILITY_UNAVAILABLE');
      }
      await beginCognitoLogin(config, window.sessionStorage, window.location, window.crypto, { identityProvider: 'X' });
    }).catch(() => {
      setError(messages.unavailable);
      setBusy(false);
      launchInFlight.current = false;
    });
  };

  return <>
    <button className="secondary-button" data-testid="auth-x-button" disabled={busy} onClick={onClick} type="button">{messages.signIn}</button>
    <p className="muted small">{messages.confirmation}</p>
    <p className="muted small">{messages.existing}</p>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
