import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { config } from '@/lib/config';
import { t } from '@/lib/i18n';
import { balanceQueryKey } from '@/lib/queryKeys';
import { useAppState } from '@/state/appState';

export function CreditBalanceBadge(): React.JSX.Element | null {
  const { api, language, session, sessionKey, selection } = useAppState();
  const organizationId = config.organizationFeaturesEnabled ? selection.organizationId : null;
  const balanceQuery = useQuery<{ total_credits: number }>({
    enabled: session !== null,
    queryKey: balanceQueryKey(sessionKey, organizationId),
    queryFn: () => organizationId === null
      ? api.getBalance()
      : api.getOrganizationCreditBalance(organizationId)
  });

  if (session === null) {
    return null;
  }

  const totalCredits = balanceQuery.data?.total_credits;
  const balance = typeof totalCredits === 'number'
    ? String(totalCredits)
    : balanceQuery.isPending ? '…' : '—';

  return (
    <View accessibilityLabel={`${t(language, 'credits')}: ${balance}`} style={styles.badge}>
      <Text style={styles.label}>{t(language, 'credits')}</Text>
      <Text style={styles.value}>{balance}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'flex-end',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  label: {
    ...textStyles.caption,
    color: colors.muted
  },
  value: {
    ...textStyles.body,
    color: colors.primary,
    fontWeight: '700'
  }
});
