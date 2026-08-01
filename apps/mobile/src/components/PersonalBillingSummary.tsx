import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface PersonalBillingSummaryProps {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  language: UiLanguage;
  onManage: () => void;
}

export function PersonalBillingSummary({
  cancelAtPeriodEnd,
  currentPeriodEnd,
  language,
  onManage
}: PersonalBillingSummaryProps): React.JSX.Element {
  return (
    <View style={styles.root}>
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
