import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { billingPlanMessage } from '@/lib/billingPlanMessages';
import { t } from '@/lib/i18n';

interface PersonalBillingSummaryProps {
  cancelAtPeriodEnd: boolean;
  currentPlan?: 'free' | 'standard' | 'premium';
  scheduledPlan?: 'standard' | 'premium' | null;
  scheduledPlanEffectiveAt?: string | null;
  currentPeriodEnd: string | null;
  language: UiLanguage;
  onManage: () => void;
}

export function PersonalBillingSummary({
  cancelAtPeriodEnd,
  currentPlan, scheduledPlan, scheduledPlanEffectiveAt,
  currentPeriodEnd,
  language,
  onManage
}: PersonalBillingSummaryProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      {currentPlan === undefined ? null : <View style={styles.row}><Text style={styles.label}>{billingPlanMessage(language, 'current')}</Text><Text style={styles.value}>{billingPlanMessage(language, currentPlan)}</Text></View>}
      {scheduledPlan == null ? null : <>
        <View style={styles.row}><Text style={styles.label}>{billingPlanMessage(language, 'scheduled')}</Text><Text style={styles.value}>{billingPlanMessage(language, scheduledPlan)}</Text></View>
        <View style={styles.row}><Text style={styles.label}>{billingPlanMessage(language, 'effective')}</Text><Text style={styles.value}>{scheduledPlanEffectiveAt == null ? billingPlanMessage(language, 'unknownDate') : formatBillingDate(scheduledPlanEffectiveAt, language)}</Text></View>
        <Text style={styles.caption}>{billingPlanMessage(language, 'scheduledNotice', { plan: billingPlanMessage(language, scheduledPlan) })}</Text>
      </>}
      <View style={styles.row}>
        <Text style={styles.label}>{t(language, "generated.components.PersonalBillingSummary.next.renewal.388f0683")}</Text>
        <Text style={styles.value}>{formatBillingDate(currentPeriodEnd, language)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t(language, "generated.components.PersonalBillingSummary.cancellation.fd5f9641")}</Text>
        <Text style={styles.value}>
          {cancelAtPeriodEnd
            ? t(language, "generated.components.PersonalBillingSummary.scheduled.at.period.end.7b13fbde")
            : t(language, "generated.components.PersonalBillingSummary.not.scheduled.03f68e9e")}
        </Text>
      </View>
      <Text style={styles.caption}>
        {t(language, "generated.components.PersonalBillingSummary.use.manage.subscription.and.billing.to.c.2c7e573e")}
      </Text>
      <PrimaryButton
        label={t(language, "generated.components.PersonalBillingSummary.manage.subscription.and.billing.41add0d8")}
        onPress={onManage}
        variant="secondary"
      />
    </View>
  );
}

function formatBillingDate(value: string | null, language: UiLanguage): string {
  if (value === null) {
    return t(language, "generated.components.PersonalBillingSummary.not.set.3ecccf12");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t(language, "generated.components.PersonalBillingSummary.unavailable.46f6d918");
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return t(language, 'shared.personalBilling.date', {
    year,
    month: language === 'ja' ? month : String(month).padStart(2, '0'),
    day: language === 'ja' ? day : String(day).padStart(2, '0')
  });
}

const styles = StyleSheet.create({
  caption: {
    ...textStyles.caption
  },
  label: {
    ...textStyles.caption,
    color: colors.muted
  },
  root: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.md
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  value: {
    ...textStyles.body,
    flexShrink: 1,
    fontWeight: '700',
    textAlign: 'right'
  }
});
