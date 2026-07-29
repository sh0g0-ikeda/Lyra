import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { colors, spacing, textStyles } from '@/constants/theme';
import type {
  BillingHandoffIntent,
  BillingHandoffPhase
} from '@/domain/billingHandoffPolicy';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface BillingHandoffNoticeProps {
  intent: BillingHandoffIntent;
  language: UiLanguage;
  phase: Exclude<BillingHandoffPhase, 'idle'>;
}

export function BillingHandoffNotice({
  intent,
  language,
  phase
}: BillingHandoffNoticeProps): React.JSX.Element {
  if (phase === 'waiting_for_return') {
    return (
      <Notice
        message={t(language, "generated.components.BillingHandoffNotice.billing.details.will.be.checked.after.yo.3a2f63ac")}
        tone="warning"
      />
    );
  }

  if (phase === 'confirming') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.confirming}>
        <ActivityIndicator color={colors.primary} size="small" />
        <Text style={styles.text}>
          {t(language, "generated.components.BillingHandoffNotice.confirming.billing.information.a2a27774")}
        </Text>
      </View>
    );
  }

  if (phase === 'confirmed') {
    return (
      <Notice
        message={
          intent.kind === 'portal'
            ? t(language, "generated.components.BillingHandoffNotice.billing.information.was.updated.d8e6b7c7")
            : t(language, "generated.components.BillingHandoffNotice.purchase.completion.was.confirmed.by.the.b8d444e2")
        }
        tone="success"
      />
    );
  }

  return (
    <Notice
      message={
        intent.kind === 'portal'
          ? t(language, "generated.components.BillingHandoffNotice.no.billing.change.was.confirmed.this.is.b2074a0b")
          : t(language, "generated.components.BillingHandoffNotice.the.purchase.could.not.be.confirmed.a.ca.017d78b7")
      }
      tone="warning"
    />
  );
}

const styles = StyleSheet.create({
  confirming: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md
  },
  text: {
    ...textStyles.body,
    flex: 1
  }
});
