import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Text } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Section } from '@/components/Section';
import { textStyles } from '@/constants/theme';
import type { GoogleLinkStatus } from '@/domain/googleAuth';
import { useGoogleAuthCapabilities } from '@/hooks/useGoogleAuthCapabilities';
import { ApiError, LyraMobileApiClient } from '@/lib/api';
import { reauthenticateWithCognito } from '@/lib/auth';
import { confirmAction } from '@/lib/confirm';
import { config } from '@/lib/config';
import { googleAuthMessages } from '@/lib/googleAuthMessages';
import { GoogleIdentityLinkFlow, googleAllowedOnPlatform, parseGoogleLinkReturn } from '@/lib/googleIdentityLink';
import { useAppState } from '@/state/appState';

interface GoogleIdentityLinkPanelProps { onSignInAgain: () => void; }

// User-triggered linking only. Native credentials are kept in the in-memory flow
// and are never written back through AppState.setTokens or secure storage.
export function GoogleIdentityLinkPanel({ onSignInAgain }: GoogleIdentityLinkPanelProps): React.JSX.Element | null {
  const { api, language, session } = useAppState();
  const capabilities = useGoogleAuthCapabilities();
  const enabled = !capabilities.isError && googleAllowedOnPlatform(capabilities.data, Platform.OS, 'google_linking');
  const copy = googleAuthMessages(language);
  const userId = session?.user.id ?? null;
  const flow = useRef<GoogleIdentityLinkFlow | null>(null);
  const currentUser = useRef(userId);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<GoogleLinkStatus | null>(null);
  const [error, setError] = useState<'mismatch' | 'unknown' | 'reauth' | 'disabled' | 'conflict' | 'recovery' | null>(null);
  const [canContinue, setCanContinue] = useState(false);
  const [retryStart, setRetryStart] = useState(false);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);

  useEffect(() => {
    currentUser.current = userId;
    mounted.current = true;
    return () => { mounted.current = false; flow.current?.invalidate(); flow.current = null; };
  }, [userId]);

  useEffect(() => {
    const receive = (url: string | null): void => {
      const id = url === null ? null : parseGoogleLinkReturn(url, config.cognitoRedirectUri);
      if (id !== null && mounted.current) setRecoveryId(id);
    };
    void Linking.getInitialURL().then(receive).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => subscription.remove();
  }, []);

  const run = async (operation: 'start' | 'check', newFlow = false): Promise<void> => {
    if (busyRef.current || userId === null) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      if (operation === 'start') {
        // Capabilities can be disabled while the account screen is open.
        const freshCapabilities = await api.getGoogleAuthCapabilities();
        if (!mounted.current || currentUser.current !== userId) return;
        if (!googleAllowedOnPlatform(freshCapabilities, Platform.OS, 'google_linking')) throw new Error('GOOGLE_LINK_DISABLED');
        if (newFlow || flow.current === null) {
          flow.current?.invalidate();
          setStatus(null); setRecoveryId(null); setCanContinue(false);
          flow.current = new GoogleIdentityLinkFlow({
            cognitoRedirectUri: config.cognitoRedirectUri,
            expectedUserId: userId,
            currentUserId: () => mounted.current ? currentUser.current : null,
            reauthenticate: reauthenticateWithCognito,
            createClient: (tokens) => new LyraMobileApiClient(() => tokens.idToken),
            createRequestKey: Crypto.randomUUID,
            openBrowser: WebBrowser.openAuthSessionAsync
          });
        }
      }
      const result = operation === 'start'
        ? await flow.current!.start()
        : flow.current?.challengeId !== null && flow.current !== null
          ? await flow.current.check()
          : recoveryId === null ? null : await api.getGoogleIdentityLinkStatus(recoveryId);
      if (mounted.current && currentUser.current === userId && result !== null) {
        if (operation === 'check' && flow.current === null && result.challenge_id !== recoveryId) throw new Error('INVALID_STATUS');
        setStatus(result); setRecoveryId(result.challenge_id); setRetryStart(false);
        setCanContinue(flow.current?.canContinueAuthorization ?? false);
      }
    } catch (cause) {
      if (mounted.current && currentUser.current === userId) {
        const code = cause instanceof ApiError ? cause.code : cause instanceof Error ? cause.message : '';
        const reason = code === 'RECENT_AUTH_REQUIRED' ? 'reauth'
          : code === 'GOOGLE_LINK_DISABLED' ? 'disabled'
          : code === 'IDENTITY_LINK_CONFLICT' ? 'conflict'
          : code === 'IDENTITY_LINK_RECOVERY_REQUIRED' ? 'recovery'
          : code === 'ACCOUNT_MISMATCH' ? 'mismatch'
          : flow.current?.requiresReauthentication ? 'reauth' : 'unknown';
        setError(reason);
        setRetryStart(reason === 'unknown' && (flow.current?.canRetryStart ?? false));
        if (flow.current?.challengeId != null) setRecoveryId(flow.current.challengeId);
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const requestStart = (): void => {
    confirmAction({ language, title: copy.confirmTitle, message: copy.explain, confirmLabel: copy.confirmAction, onConfirm: () => void run('start', true) });
  };
  if ((!enabled && recoveryId === null) || userId === null) return null;
  const blocked = error === 'disabled' || error === 'conflict' || error === 'recovery';
  const terminalRetry = status?.status === 'cancelled' || status?.status === 'expired' || status?.status === 'failed';
  const needsReauthentication = error === 'reauth' || (status?.status === 'pending' && status.requires_reauthentication);
  return (
    <Section title={copy.title}>
      <Text style={textStyles.body}>{copy.explain}</Text>
      {status === null ? null : <Notice message={status.status === 'pending' && status.requires_reauthentication ? copy.reauth : copy.statuses[status.status]} tone={status.status === 'linked' ? 'info' : 'warning'} />}
      {error === null ? null : <Notice message={copy[error]} tone="warning" />}
      {enabled && !blocked && (status === null && recoveryId === null && !retryStart || terminalRetry || needsReauthentication) ? <PrimaryButton label={needsReauthentication ? copy.verifyAgain : copy.link} disabled={busy} loading={busy} onPress={requestStart} testID="google-link-start" variant="secondary" /> : null}
      {enabled && !blocked && retryStart ? <PrimaryButton label={copy.retryStart} disabled={busy} onPress={() => void run('start')} testID="google-link-retry-start" variant="secondary" /> : null}
      {enabled && !blocked && !needsReauthentication && status?.status === 'pending' && canContinue ? <PrimaryButton label={copy.continueLink} disabled={busy} onPress={() => void run('start')} variant="secondary" /> : null}
      {recoveryId === null || status?.status === 'linked' ? null : <PrimaryButton label={copy.check} disabled={busy} loading={busy} onPress={() => void run('check')} testID="google-link-check" variant="secondary" />}
      {status?.status === 'linked' ? <PrimaryButton label={copy.signInAgain} onPress={onSignInAgain} testID="google-link-sign-in-again" variant="secondary" /> : null}
    </Section>
  );
}
