import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import { t, type UiLanguage } from '../lib/i18n';
import type {
  NativeStoreBillingAdapter,
  NativeStoreBillingErrorCode,
  NativeStoreBillingState,
  NativeStoreServerState,
} from '../lib/nativeStoreBilling';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

interface MobileStoreBillingPanelProps {
  adapter: NativeStoreBillingAdapter;
  language: UiLanguage;
  onVerified?(state: NativeStoreServerState): void | Promise<void>;
}

export function MobileStoreBillingPanel({
  adapter,
  language,
  onVerified,
}: MobileStoreBillingPanelProps): React.JSX.Element {
  const [state, setState] = useState<NativeStoreBillingState>(() => adapter.getState());
  const notifiedVerifiedState = useRef<NativeStoreServerState | null>(null);

  useEffect(() => {
    const unsubscribe = adapter.subscribe(setState);
    void adapter.connect().catch(() => undefined);
    return () => {
      unsubscribe();
      void adapter.disconnect();
    };
  }, [adapter]);

  useEffect(() => {
    if (
      state.lastVerified !== null
      && state.lastVerified !== notifiedVerifiedState.current
      && onVerified !== undefined
    ) {
      notifiedVerifiedState.current = state.lastVerified;
      void onVerified(state.lastVerified);
    }
  }, [onVerified, state.lastVerified]);

  const isBusy = state.loading || state.restoring || state.submittingProductId !== null;
  const reconnect = async (): Promise<void> => {
    try {
      await adapter.connect();
    } catch {
      // The adapter exposes only a stable error code through state.
    }
  };
  const restore = async (): Promise<void> => {
    try {
      await adapter.restore();
    } catch {
      // The adapter exposes only a stable error code through state.
    }
  };

  return (
    <View accessibilityLabel={t(language, 'purchaseSection')} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t(language, 'purchaseSection')}</Text>
        {state.loading ? <ActivityIndicator color={colors.accent} /> : null}
      </View>
      <Text style={styles.caption}>{t(language, 'purchaseVerificationHelp')}</Text>

      {state.error === null ? null : (
        <Notice
          message={purchaseErrorMessage(state.error.code, language)}
          tone={errorTone(state.error.code)}
        />
      )}
      {!state.connected && state.error?.retryable === true ? (
        <PrimaryButton
          label={t(language, 'purchaseReconnect')}
          loading={state.loading}
          onPress={() => void reconnect()}
        />
      ) : null}

      {state.products.map((product) => {
        const productBusy = state.submittingProductId === product.id;
        const disabled = !state.connected || !product.available || isBusy;
        return (
          <View key={product.id} style={styles.product}>
            <View style={styles.productText}>
              <Text style={styles.productTitle}>{product.title}</Text>
              {product.description === undefined ? null : (
                <Text style={styles.caption}>{product.description}</Text>
              )}
              {product.displayPrice === null ? (
                <Text style={styles.unavailable}>{t(language, 'purchaseProductUnavailable')}</Text>
              ) : (
                <Text style={styles.price}>{product.displayPrice}</Text>
              )}
            </View>
            <PrimaryButton
              disabled={disabled}
              label={t(language, 'purchaseBuy')}
              loading={productBusy}
              onPress={() => {
                void adapter.purchase(product.id).catch(() => undefined);
              }}
            />
          </View>
        );
      })}

      <PrimaryButton
        disabled={!state.connected || isBusy}
        label={t(language, 'purchaseRestore')}
        loading={state.restoring}
        onPress={() => void restore()}
      />
    </View>
  );
}

function purchaseErrorMessage(
  code: NativeStoreBillingErrorCode,
  language: UiLanguage,
): string {
  switch (code) {
    case 'PURCHASE_CANCELLED':
      return t(language, 'purchaseCancelled');
    case 'PURCHASE_PENDING':
      return t(language, 'purchasePending');
    case 'ALREADY_OWNED':
      return t(language, 'purchaseAlreadyOwned');
    case 'PRODUCT_NOT_FOUND':
    case 'PRODUCT_UNAVAILABLE':
      return t(language, 'purchaseProductUnavailable');
    case 'DUPLICATE_SUBMIT':
      return t(language, 'purchaseBusy');
    case 'VERIFICATION_FAILED':
    case 'FINISH_FAILED':
      return t(language, 'purchaseVerificationFailed');
    case 'NETWORK':
    case 'CONNECTION_FAILED':
    case 'NOT_CONNECTED':
    case 'STORE_UNAVAILABLE':
      return t(language, 'purchaseNetworkError');
    case 'PURCHASE_FAILED':
    case 'RESTORE_FAILED':
      return t(language, 'purchaseFailed');
  }
}

function errorTone(
  code: NativeStoreBillingErrorCode,
): 'danger' | 'info' {
  return code === 'PURCHASE_CANCELLED'
    || code === 'PURCHASE_PENDING'
    || code === 'ALREADY_OWNED'
    || code === 'DUPLICATE_SUBMIT'
    ? 'info'
    : 'danger';
}

const styles = StyleSheet.create({
  caption: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  container: {
    gap: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  price: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '800',
  },
  product: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  productText: {
    flex: 1,
    gap: spacing.xs,
  },
  productTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  title: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  unavailable: {
    color: colors.muted,
    fontSize: 14,
  },
});
