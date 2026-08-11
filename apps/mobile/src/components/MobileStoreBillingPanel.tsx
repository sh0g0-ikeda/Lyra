import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type {
  NativeStoreBillingAdapter,
  NativeStoreBillingErrorCode,
  NativeStoreBillingState,
  NativeStoreServerEntitlement,
  NativeStoreServerState
} from '@/lib/nativeStoreBilling';
import type { ComponentTranslationKey } from '@/lib/i18nComponentMessages';
import { t } from '@/lib/i18n';
import { useNetworkStatus } from '@/state/networkStatus';

interface MobileStoreBillingPanelProps {
  adapter: NativeStoreBillingAdapter;
  currentPlan: NativeStoreServerEntitlement['plan'];
  language: 'ja' | 'en';
  onVerified?: (state: NativeStoreServerState) => void | Promise<void>;
  scheduledPlan?: 'standard' | 'premium' | null;
  scheduledPlanEffectiveAt?: string | null;
}

export function MobileStoreBillingPanel({
  adapter,
  currentPlan,
  language,
  onVerified,
  scheduledPlan = null,
  scheduledPlanEffectiveAt = null
}: MobileStoreBillingPanelProps): React.JSX.Element {
  const { online } = useNetworkStatus();
  const [state, setState] = useState<NativeStoreBillingState>(() => adapter.getState());
  const [acknowledgedVerified, setAcknowledgedVerified] = useState<NativeStoreServerState | null>(null);

  useEffect(() => {
    const unsubscribe = adapter.subscribe(setState);
    void adapter.connect().catch(() => undefined);
    return () => {
      unsubscribe();
      void adapter.disconnect();
    };
  }, [adapter]);

  useEffect(() => {
    if (state.lastVerified !== null && onVerified !== undefined) {
      let active = true;
      void Promise.resolve(onVerified(state.lastVerified)).finally(() => {
        if (active) {
          setAcknowledgedVerified(state.lastVerified);
        }
      });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [onVerified, state.lastVerified]);

  const isBusy = state.loading || state.restoring || state.submittingProductId !== null;
  const restore = async (): Promise<void> => {
    try {
      await adapter.restore();
    } catch {
      // The adapter provides a safe, localizable error state.
    }
  };
  const awaitingAuthoritativeRefresh = state.lastVerified !== null && state.lastVerified !== acknowledgedVerified;
  const effectivePlan = awaitingAuthoritativeRefresh ? state.lastVerified?.entitlement.plan ?? currentPlan : currentPlan;
  const nativeScheduledProduct = state.subscriptionStatus?.scheduledProductId === null
    ? null
    : state.products.find((product) => product.id === state.subscriptionStatus?.scheduledProductId);
  const nativeScheduledPlan = nativeScheduledProduct?.kind === 'subscription' ? nativeScheduledProduct.planCode : null;
  const serverScheduledPlan = awaitingAuthoritativeRefresh
    ? state.lastVerified?.entitlement.scheduledPlan ?? scheduledPlan
    : scheduledPlan;
  const serverScheduledAt = awaitingAuthoritativeRefresh
    ? state.lastVerified?.entitlement.scheduledPlanEffectiveAt ?? scheduledPlanEffectiveAt
    : scheduledPlanEffectiveAt;
  const effectiveScheduledPlan = effectivePlan === 'free'
    ? null
    : state.subscriptionStatus?.scheduledStateKnown === true
      ? nativeScheduledPlan
      : serverScheduledPlan;
  const effectiveScheduledAt = effectivePlan === 'free'
    ? null
    : state.subscriptionStatus?.scheduledStateKnown === true
      ? state.subscriptionStatus.scheduledEffectiveAt
      : serverScheduledAt;

  return (
    <View accessibilityLabel={t(language, "generated.components.MobileStoreBillingPanel.mobile.purchases.73712c97")} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t(language, "generated.components.MobileStoreBillingPanel.in.app.purchases.da6e1910")}</Text>
        {state.loading ? <ActivityIndicator color={colors.primary} size="small" /> : null}
      </View>
      <Text style={styles.caption}>
        {t(language, "generated.components.MobileStoreBillingPanel.your.account.changes.only.after.the.serv.3d1d385e")}
      </Text>
      {online ? null : (
        <Notice
          message={t(language, "generated.components.MobileStoreBillingPanel.purchases.and.restores.are.available.aft.a694c001")}
          tone="warning"
        />
      )}
      {state.error !== null ? <Notice message={errorMessage(state.error.code, language)} tone={errorTone(state.error.code)} /> : null}
      {effectiveScheduledPlan === null ? null : (
        <Notice
          message={t(language, 'component.mobileStoreBilling.scheduledPlanNotice', {
            plan: planLabel(effectiveScheduledPlan, language)
          })}
          tone="info"
        />
      )}
      {state.products.map((product) => {
        const isCurrentSubscription =
          product.kind === 'subscription' && product.planCode === effectivePlan;
        const isScheduledSubscription =
          product.kind === 'subscription' && product.planCode === effectiveScheduledPlan;
        const disabledReason = isScheduledSubscription
          ? t(language, 'component.mobileStoreBilling.scheduledPlanReason')
          : isCurrentSubscription
          ? t(language, 'component.mobileStoreBilling.currentPlanReason')
          : product.available
            ? undefined
            : t(language, "generated.components.MobileStoreBillingPanel.this.product.is.unavailable.right.now.bd7334b4");
        const productBusy = state.submittingProductId === product.id;
        const label = product.kind === 'credit_pack'
          ? t(language, "generated.components.MobileStoreBillingPanel.purchase.8ff82e16")
          : isScheduledSubscription
            ? scheduledPlanLabel(effectiveScheduledAt, language)
          : isCurrentSubscription
            ? t(language, 'component.mobileStoreBilling.currentPlan')
            : effectivePlan === 'free'
              ? t(language, 'component.mobileStoreBilling.subscribe')
              : t(language, 'component.mobileStoreBilling.changePlan');
        return (
          <View key={product.id} style={styles.product}>
            <View style={styles.productText}>
              <Text style={styles.productTitle}>{product.title}</Text>
              {product.description === undefined ? null : <Text style={styles.caption}>{product.description}</Text>}
              {product.displayPrice === null ? null : <Text style={styles.price}>{product.displayPrice}</Text>}
            </View>
            <PrimaryButton
              disabled={!online || !state.connected || !product.available || isBusy || isCurrentSubscription || isScheduledSubscription}
              disabledReason={!online ? offlineMessage(language) : disabledReason ?? (isBusy ? busyMessage(language) : undefined)}
              label={label}
              loading={productBusy}
              onPress={() => {
                void adapter.purchase(product.id).catch(() => undefined);
              }}
              variant="primary"
            />
          </View>
        );
      })}
      <PrimaryButton
        disabled={!online || !state.connected || isBusy}
        disabledReason={!online ? offlineMessage(language) : isBusy ? busyMessage(language) : undefined}
        label={t(language, "generated.components.MobileStoreBillingPanel.restore.purchases.17980d3f")}
        loading={state.restoring}
        onPress={() => void restore()}
        variant="secondary"
      />
    </View>
  );
}

function planLabel(plan: 'standard' | 'premium', language: 'ja' | 'en'): string {
  return t(language, plan === 'standard'
    ? 'component.mobileStoreBilling.standardPlan'
    : 'component.mobileStoreBilling.premiumPlan');
}

function scheduledPlanLabel(value: string | null, language: 'ja' | 'en'): string {
  if (value === null) {
    return t(language, 'component.mobileStoreBilling.scheduledPlan');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t(language, 'component.mobileStoreBilling.scheduledPlan');
  }
  const formatted = new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(date);
  return t(language, 'component.mobileStoreBilling.scheduledPlanAt', { date: formatted });
}

function busyMessage(language: 'ja' | 'en'): string {
  return t(language, "generated.components.MobileStoreBillingPanel.wait.for.the.current.purchase.to.finish.1fd8e89d");
}

function offlineMessage(language: 'ja' | 'en'): string {
  return t(language, "generated.components.MobileStoreBillingPanel.reconnect.before.continuing.e8fc7657");
}

function errorMessage(code: NativeStoreBillingErrorCode, language: 'ja' | 'en'): string {
  const messages: Record<NativeStoreBillingErrorCode, ComponentTranslationKey> = {
    ALREADY_OWNED: 'component.mobileStoreBilling.alreadyOwned',
    CONNECTION_FAILED: 'component.mobileStoreBilling.connectionFailed',
    DUPLICATE_SUBMIT: 'component.mobileStoreBilling.duplicateSubmit',
    FINISH_FAILED: 'component.mobileStoreBilling.finishFailed',
    NETWORK: 'component.mobileStoreBilling.network',
    NOT_CONNECTED: 'component.mobileStoreBilling.notConnected',
    PRODUCT_NOT_FOUND: 'component.mobileStoreBilling.productNotFound',
    PRODUCT_UNAVAILABLE: 'component.mobileStoreBilling.productUnavailable',
    PURCHASE_CANCELLED: 'component.mobileStoreBilling.purchaseCancelled',
    PURCHASE_FAILED: 'component.mobileStoreBilling.purchaseFailed',
    PURCHASE_PENDING: 'component.mobileStoreBilling.purchasePending',
    RESTORE_FAILED: 'component.mobileStoreBilling.restoreFailed',
    STORE_UNAVAILABLE: 'component.mobileStoreBilling.storeUnavailable',
    VERIFICATION_FAILED: 'component.mobileStoreBilling.verificationFailed'
  };
  const message = messages[code];
  return t(language, message);
}

function errorTone(code: NativeStoreBillingErrorCode): 'danger' | 'warning' | 'info' {
  if (code === 'PURCHASE_CANCELLED' || code === 'PURCHASE_PENDING' || code === 'DUPLICATE_SUBMIT') return 'info';
  if (code === 'ALREADY_OWNED' || code === 'FINISH_FAILED') return 'warning';
  return 'danger';
}

const styles = StyleSheet.create({
  caption: { ...textStyles.caption },
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  price: { ...textStyles.body, color: colors.primary, fontWeight: '700' },
  product: {
    alignItems: 'stretch',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'column',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.sm
  },
  productText: { alignSelf: 'stretch', flex: 1, gap: spacing.xs, minWidth: 0 },
  productTitle: { ...textStyles.body, color: colors.inkStrong, fontWeight: '700' },
  title: { ...textStyles.sectionTitle }
});
