import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { creditBalanceState } from '@/domain/creditBalanceState';
import { config } from '@/lib/config';
import { mangaGuidanceMessages } from '@/lib/mangaGuidanceMessages';
import { balanceQueryKey } from '@/lib/queryKeys';
import { useAppState } from '@/state/appState';
import { useNetworkStatus } from '@/state/networkStatus';

// Read the active scope only. Share the balance query/invalidation contract with
// generation and billing. No stale scope fallback and no client-side cost quote.
export function CreditBalanceBadge(): React.JSX.Element | null {
  const { api, language, selection, session, sessionKey } = useAppState();
  const { online } = useNetworkStatus();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const copy = mangaGuidanceMessages(language);
  const organizationId = config.organizationFeaturesEnabled ? selection.organizationId : null;
  const organization = session?.organizations.find((item) => item.id === organizationId && item.membership_status === 'active');
  const scopeAvailable = session !== null && (organizationId === null || organization !== undefined);
  const query = useQuery({
    enabled: scopeAvailable,
    queryKey: balanceQueryKey(sessionKey, organizationId),
    queryFn: async () => {
      if (organizationId === null) return api.getBalance();
      const workspace = await api.getOrganizationWorkspace(organizationId);
      if (workspace.balance === null) throw new Error('Balance unavailable');
      return workspace.balance;
    },
    refetchInterval: foreground ? 30_000 : false,
    refetchIntervalInBackground: false
  });
  const refetch = query.refetch;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setForeground(next === 'active');
      if (next === 'active' && scopeAvailable) void refetch();
    });
    return () => subscription.remove();
  }, [refetch, scopeAvailable]);
  if (session === null) return null;

  const state = creditBalanceState({
    total: scopeAvailable ? query.data?.total_credits : undefined,
    fetching: scopeAvailable && query.isFetching,
    error: scopeAvailable && query.isError,
    offline: !online
  });
  const value = state.status === 'ready'
    ? state.total.toLocaleString(language)
    : copy.balance[state.status];
  const scope = organizationId === null ? copy.personal : organization?.name ?? copy.organization;
  const retryAvailable = scopeAvailable && online && (state.status === 'error' || state.status === 'unavailable');
  return (
    <View style={styles.root} testID="credit-balance-badge">
      <View accessible accessibilityLabel={`${scope} · ${copy.credits}: ${value}`} accessibilityLiveRegion="polite" style={styles.content}>
        <Text style={styles.scope}>{scope}</Text>
        <Text style={styles.value}>{copy.credits}: {value}</Text>
      </View>
      {retryAvailable ? (
        <Pressable accessibilityLabel={copy.retry} accessibilityRole="button" onPress={() => void refetch()} style={styles.retry} testID="credit-balance-retry">
          <Text style={styles.retryLabel}>{copy.retry}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexShrink: 1, gap: 2 },
  root: { alignSelf: 'flex-end', maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, borderColor: colors.controlBorder, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  scope: { ...textStyles.caption, color: colors.muted },
  value: { ...textStyles.body, color: colors.primary, fontWeight: '700' },
  retry: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  retryLabel: { ...textStyles.caption, color: colors.primary, textDecorationLine: 'underline' }
});
