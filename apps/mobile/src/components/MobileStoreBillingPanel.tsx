import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';

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
import { billingPlanMessage } from '@/lib/billingPlanMessages';
import { t } from '@/lib/i18n';
import { useNetworkStatus } from '@/state/networkStatus';

const legalUrls = {
  ja: {
    privacy: 'https://app.lyra-editor.com/privacy.html',
    terms: 'https://app.lyra-editor.com/terms.html'
  },
  en: {
    privacy: 'https://app.lyra-editor.com/privacy-en.html',
    terms: 'https://app.lyra-editor.com/terms-en.html'
  }
} as const;

interface MobileStoreBillingPanelProps {
  adapter: NativeStoreBillingAdapter;
  currentPlan?: NativeStoreServerEntitlement['plan'];
  scheduledPlan?: 'standard' | 'premium' | null;
  scheduledPlanEffectiveAt?: string | null;
  language: 'ja' | 'en';
  onVerified?: (state: NativeStoreServerState) => void | Promise<void>;
}

export function MobileStoreBillingPanel({ adapter, language, onVerified, currentPlan, scheduledPlan, scheduledPlanEffectiveAt }: MobileStoreBillingPanelProps): React.JSX.Element {
  const { online } = useNetworkStatus();
  const [acknowledgedVerified, setAcknowledgedVerified] = useState<NativeStoreServerState | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [legalFailed, setLegalFailed] = useState(false);
  const [state, setState] = useState<NativeStoreBillingState>(() => adapter.getState());

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
      const verified = state.lastVerified;
      void Promise.resolve().then(() => onVerified(verified)).then(() => {
        if (active) { setAcknowledgedVerified(state.lastVerified); setRefreshFailed(false); }
      }).catch(() => { if (active) setRefreshFailed(true); });
      return () => { active = false; };
    }
    return undefined;
  }, [onVerified, state.lastVerified]);

  const verifiedPending = state.lastVerified !== null && state.lastVerified !== acknowledgedVerified;
  const effectivePlan = verifiedPending ? state.lastVerified?.entitlement.plan ?? currentPlan : currentPlan;
  const effectiveScheduledPlan = verifiedPending && state.lastVerified?.entitlement.scheduledPlan !== undefined ? state.lastVerified.entitlement.scheduledPlan : scheduledPlan ?? null;
  const effectiveScheduledAt = verifiedPending && state.lastVerified?.entitlement.scheduledPlanEffectiveAt !== undefined ? state.lastVerified.entitlement.scheduledPlanEffectiveAt : scheduledPlanEffectiveAt ?? null;
  const openLegalLink = async (url: string): Promise<void> => { setLegalFailed(false); try { await Linking.openURL(url); } catch { setLegalFailed(true); } };
  const isBusy = state.loading || state.restoring || state.submittingProductId !== null;
  const restore = async (): Promise<void> => {
    try {
      await adapter.restore();
    } catch {
      // The adapter provides a safe, localizable error state.
    }
  };

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
      {refreshFailed ? <Notice message={billingPlanMessage(language, 'refreshFailed')} tone="warning" /> : null}
      {effectiveScheduledPlan === null ? null : <Notice message={billingPlanMessage(language, 'scheduledNotice', { plan: billingPlanMessage(language, effectiveScheduledPlan) })} tone="info" />}
      {state.products.map((product) => {
        const isCurrent = product.kind === 'subscription' && product.planCode !== undefined && product.planCode === effectivePlan;
        const isScheduled = product.kind === 'subscription' && product.planCode !== undefined && product.planCode === effectiveScheduledPlan;
        const planUnknown = product.kind === 'subscription' && (effectivePlan === undefined || product.planCode === undefined);
        const disabledReason = isCurrent ? billingPlanMessage(language, 'currentReason') : isScheduled ? billingPlanMessage(language, 'scheduledReason') : planUnknown ? billingPlanMessage(language, 'loadingPlan') : product.available
          ? undefined
          : t(language, "generated.components.MobileStoreBillingPanel.this.product.is.unavailable.right.now.bd7334b4");
        const productBusy = state.submittingProductId === product.id;
        return (
          <View key={product.id} style={styles.product}>
            <View style={styles.productText}>
              <Text style={styles.productTitle}>{product.title}</Text>
              {product.description === undefined ? null : <Text style={styles.caption}>{product.description}</Text>}
              {product.displayPrice === null ? null : <Text style={styles.price}>{product.displayPrice}</Text>}
            </View>
            <PrimaryButton
              disabled={!online || !state.connected || !product.available || isBusy || isCurrent || isScheduled || planUnknown}
              disabledReason={!online ? offlineMessage(language) : disabledReason ?? (isBusy ? busyMessage(language) : undefined)}
              label={product.kind === 'credit_pack' ? t(language, "generated.components.MobileStoreBillingPanel.purchase.8ff82e16") : isCurrent ? billingPlanMessage(language, 'current') : isScheduled ? scheduledLabel(effectiveScheduledAt, language) : billingPlanMessage(language, effectivePlan === 'free' ? 'subscribe' : 'change')}
              loading={productBusy}
              onPress={() => {
                if (isCurrent || isScheduled || planUnknown || isBusy || !online) return;
                void adapter.purchase(product.id).catch(() => undefined);
              }}
              variant="primary"
            />
          </View>
        );
      })}
      {(state.error !== null || state.products.length === 0 || state.products.some((product) => !product.available)) ? <PrimaryButton label={billingPlanMessage(language, 'retryCatalog')} disabled={!online || isBusy} onPress={() => { void (adapter.refreshProducts?.() ?? adapter.connect()).catch(() => undefined); }} variant="secondary" /> : null}
      <PrimaryButton
        disabled={!online || !state.connected || isBusy}
        disabledReason={!online ? offlineMessage(language) : isBusy ? busyMessage(language) : undefined}
        label={t(language, "generated.components.MobileStoreBillingPanel.restore.purchases.17980d3f")}
        loading={state.restoring}
        onPress={() => void restore()}
        variant="secondary"
      />
      <Text style={styles.caption}>
        {t(language, 'component.mobileStoreBilling.renewalDisclosure')}
      </Text>
      {legalFailed ? <Notice message={billingPlanMessage(language, 'legalFailed')} tone="warning" /> : null}
      <View style={styles.legalLinks}>
        {Platform.OS === 'ios' ? <Text accessibilityRole="link" onPress={() => { void openLegalLink('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'); }} style={styles.legalLink}>{billingPlanMessage(language, 'appleEula')}</Text> : null}
        <Text
          accessibilityRole="link"
          onPress={() => void openLegalLink(legalUrls[language].terms)}
          style={styles.legalLink}
        >
          {t(language, 'component.mobileStoreBilling.terms')}
        </Text>
        <Text
          accessibilityRole="link"
          onPress={() => void openLegalLink(legalUrls[language].privacy)}
          style={styles.legalLink}
        >
          {t(language, 'component.mobileStoreBilling.privacy')}
        </Text>
      </View>
    </View>
  );
}

function scheduledLabel(value: string | null, language: 'ja' | 'en'): string {
  if (value === null || Number.isNaN(Date.parse(value))) return billingPlanMessage(language, 'scheduled');
  return billingPlanMessage(language, 'scheduledAt', { date: new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value)) });
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
  legalLink: { ...textStyles.caption, color: colors.accent, textDecorationLine: 'underline' },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  price: { ...textStyles.body, color: colors.primary, fontWeight: '700' },
  product: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.sm
  },
  productText: { flex: 1, gap: spacing.xs, minWidth: 0 },
  productTitle: { ...textStyles.body, color: colors.inkStrong, fontWeight: '700' },
  title: { ...textStyles.sectionTitle }
});
