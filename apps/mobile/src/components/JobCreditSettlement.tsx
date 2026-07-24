import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, textStyles } from '@/constants/theme';
import type {
  GenerationJobCreditSettlementRecord,
  UiLanguage,
} from '@/domain/types';
import { t } from '@/lib/i18n';

interface JobCreditSettlementProps {
  language: UiLanguage;
  settlement: GenerationJobCreditSettlementRecord;
}

export function JobCreditSettlement({
  language,
  settlement,
}: JobCreditSettlementProps): React.JSX.Element {
  const message = settlementMessage(settlement, language);
  const pending = settlement.status === 'refund_pending';

  return (
    <View style={styles.root}>
      <Text style={styles.label}>
        {t(language, "generated.components.JobCreditSettlement.credit.settlement.9fb4bb39")}
      </Text>
      <Text
        accessibilityLiveRegion={pending ? 'polite' : 'none'}
        style={[styles.value, pending ? styles.pending : null]}
      >
        {message}
      </Text>
    </View>
  );
}

function settlementMessage(
  settlement: GenerationJobCreditSettlementRecord,
  language: UiLanguage,
): string {
  switch (settlement.status) {
    case 'not_charged':
      return t(language, "generated.components.JobCreditSettlement.not.charged.0fef6622");
    case 'charged':
      return t(language, 'component.jobCreditSettlement.charged', { credits: settlement.net_credits });
    case 'refunded':
      return t(language, 'component.jobCreditSettlement.refunded', { credits: settlement.refunded_credits });
    case 'partially_refunded':
      return t(language, 'component.jobCreditSettlement.partiallyRefunded', {
        refundedCredits: settlement.refunded_credits,
        netCredits: settlement.net_credits
      });
    case 'refund_pending':
      return t(language, 'component.jobCreditSettlement.refundPending', { chargedCredits: settlement.charged_credits });
  }
}

const styles = StyleSheet.create({
  label: {
    ...textStyles.caption,
    color: colors.muted,
  },
  pending: {
    color: colors.warning,
  },
  root: {
    gap: spacing.xs,
  },
  value: {
    ...textStyles.body,
    fontWeight: '700',
  },
});
