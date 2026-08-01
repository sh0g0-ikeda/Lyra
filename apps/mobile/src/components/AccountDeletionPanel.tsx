import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type {
  AccountDeletionPreviewRecord,
  AccountDeletionRequestInput,
  AccountDeletionResultRecord,
} from '../lib/api';
import { t, type UiLanguage } from '../lib/i18n';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

export interface AccountDeletionApiPort {
  requestAccountDeletion(
    input: AccountDeletionRequestInput,
  ): Promise<AccountDeletionResultRecord>;
}

interface AccountDeletionPanelProps {
  api: AccountDeletionApiPort;
  language: UiLanguage;
  onCompleted(): Promise<void>;
  onReloadPreview(): Promise<void>;
  preview: AccountDeletionPreviewRecord;
}

export function AccountDeletionPanel({
  api,
  language,
  onCompleted,
  onReloadPreview,
  preview,
}: AccountDeletionPanelProps): React.JSX.Element {
  const [acknowledgePersonalAssets, setAcknowledgePersonalAssets] = useState(false);
  const [acknowledgePersonalSubscriptions, setAcknowledgePersonalSubscriptions] = useState(false);
  const [acknowledgeStoreBilling, setAcknowledgeStoreBilling] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [cleanupError, setCleanupError] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<AccountDeletionResultRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const requiresPersonalSubscriptionAcknowledgement =
    preview.active_personal_stripe_subscription_count > 0;
  const requiresStoreAcknowledgement = preview.active_store_subscriptions.length > 0;
  const requiresAssetAcknowledgement = preview.personal_asset_count > 0;
  const previewHasHardBlocker = preview.unique_owner_organizations.length > 0
    || preview.active_personal_job_count > 0;
  const resultHasHardBlocker = result?.status === 'blocked'
    && result.blockers.some((blocker) =>
      blocker.code === 'UNIQUE_ORGANIZATION_OWNER'
      || blocker.code === 'ACTIVE_PERSONAL_JOB');
  const acknowledgementsComplete =
    (!requiresPersonalSubscriptionAcknowledgement || acknowledgePersonalSubscriptions)
    && (!requiresStoreAcknowledgement || acknowledgeStoreBilling)
    && (!requiresAssetAcknowledgement || acknowledgePersonalAssets);
  const completed = result?.status === 'completed';
  const canSubmit = confirmation === 'DELETE'
    && acknowledgementsComplete
    && !previewHasHardBlocker
    && resultHasHardBlocker !== true
    && !completed
    && !submitting;

  const submit = async (): Promise<void> => {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(false);
    try {
      const next = await api.requestAccountDeletion({
        acknowledge_personal_assets: acknowledgePersonalAssets,
        acknowledge_personal_subscriptions: acknowledgePersonalSubscriptions,
        acknowledge_store_billing: acknowledgeStoreBilling,
        confirmation: 'DELETE',
      });
      setResult(next);
      if (next.status === 'completed') {
        try {
          await onCompleted();
        } catch {
          setCleanupError(true);
        }
      }
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const retryLocalCleanup = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setCleanupError(false);
    try {
      await onCompleted();
    } catch {
      setCleanupError(true);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const reloadPreview = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(false);
    try {
      await onReloadPreview();
      setResult(null);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.warning}>{t(language, 'accountDeletionWarning')}</Text>
      <View style={styles.impactList}>
        <Text style={styles.body}>{t(language, 'accountDeletionImpactWorks')}</Text>
        <Text style={styles.body}>{t(language, 'accountDeletionImpactMemberships')}</Text>
        <Text style={styles.body}>{t(language, 'accountDeletionImpactBilling')}</Text>
        <Text style={styles.body}>
          {t(language, 'accountDeletionAssetCount', {
            count: String(preview.personal_asset_count),
          })}
        </Text>
      </View>

      <PreviewBlockers language={language} preview={preview} />
      {result?.status !== 'blocked' ? null : (
        <ResultBlockers blockers={result.blockers} language={language} />
      )}

      {requiresPersonalSubscriptionAcknowledgement ? (
        <Acknowledgement
          checked={acknowledgePersonalSubscriptions}
          disabled={submitting || result !== null}
          label={t(language, 'accountDeletionAcknowledgeSubscriptions', {
            count: String(preview.active_personal_stripe_subscription_count),
          })}
          onPress={() => setAcknowledgePersonalSubscriptions((current) => !current)}
        />
      ) : null}
      {requiresStoreAcknowledgement ? (
        <>
          <Text style={styles.body}>
            {t(language, 'accountDeletionStoreSubscriptions', {
              stores: preview.active_store_subscriptions
                .map((subscription) => storeLabel(subscription.store, language))
                .join(', '),
            })}
          </Text>
          <Acknowledgement
            checked={acknowledgeStoreBilling}
            disabled={submitting || result !== null}
            label={t(language, 'accountDeletionAcknowledgeStore')}
            onPress={() => setAcknowledgeStoreBilling((current) => !current)}
          />
        </>
      ) : null}
      {requiresAssetAcknowledgement ? (
        <Acknowledgement
          checked={acknowledgePersonalAssets}
          disabled={submitting || result !== null}
          label={t(language, 'accountDeletionAcknowledgeAssets', {
            count: String(preview.personal_asset_count),
          })}
          onPress={() => setAcknowledgePersonalAssets((current) => !current)}
        />
      ) : null}

      <Text style={styles.label}>{t(language, 'accountDeletionConfirmationHelp')}</Text>
      <TextInput
        accessibilityLabel={t(language, 'accountDeletionConfirmationLabel')}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!submitting && result === null}
        maxLength={6}
        onChangeText={setConfirmation}
        placeholder="DELETE"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={confirmation}
      />

      {result === null ? null : <DeletionStatus language={language} result={result} />}
      {error ? <Notice message={t(language, 'accountDeletionFailed')} tone="danger" /> : null}
      {cleanupError ? (
        <Notice message={t(language, 'accountDeletionCleanupFailed')} tone="danger" />
      ) : null}

      {result?.status === 'blocked' ? (
        <PrimaryButton
          disabled={submitting}
          label={t(language, 'accountDeletionReloadPreview')}
          loading={submitting}
          onPress={() => void reloadPreview()}
        />
      ) : completed ? (
        cleanupError ? (
          <PrimaryButton
            disabled={submitting}
            label={t(language, 'accountDeletionClearSession')}
            loading={submitting}
            onPress={() => void retryLocalCleanup()}
            tone="danger"
          />
        ) : null
      ) : (
        <>
          <PrimaryButton
            disabled={!canSubmit}
            label={result === null
              ? t(language, 'accountDeletionStart')
              : t(language, 'accountDeletionCheckProgress')}
            loading={submitting}
            onPress={() => void submit()}
            tone="danger"
          />
          {result === null && previewHasHardBlocker ? (
            <PrimaryButton
              disabled={submitting}
              label={t(language, 'accountDeletionReloadPreview')}
              loading={submitting}
              onPress={() => void reloadPreview()}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

function Acknowledgement({
  checked,
  disabled,
  label,
  onPress,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onPress(): void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.checkbox,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={[styles.checkboxMark, checked && styles.checkboxMarkChecked]}>
        <Text style={styles.checkboxGlyph}>{checked ? '✓' : ''}</Text>
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}

function PreviewBlockers({
  language,
  preview,
}: {
  language: UiLanguage;
  preview: AccountDeletionPreviewRecord;
}): React.JSX.Element | null {
  if (
    preview.unique_owner_organizations.length === 0
    && preview.active_personal_job_count === 0
  ) return null;
  return (
    <Notice
      message={[
        ...preview.unique_owner_organizations.map((organization) =>
          t(language, 'accountDeletionOwnerBlocker', { name: organization.name })),
        ...(preview.active_personal_job_count === 0
          ? []
          : [t(language, 'accountDeletionJobBlocker', {
              count: String(preview.active_personal_job_count),
            })]),
      ].join('\n')}
      tone="danger"
    />
  );
}

function ResultBlockers({
  blockers,
  language,
}: {
  blockers: Extract<AccountDeletionResultRecord, { status: 'blocked' }>['blockers'];
  language: UiLanguage;
}): React.JSX.Element {
  const messages = blockers.flatMap((blocker) => {
    switch (blocker.code) {
      case 'UNIQUE_ORGANIZATION_OWNER':
        return blocker.organizations.map((organization) =>
          t(language, 'accountDeletionOwnerBlocker', { name: organization.name }));
      case 'ACTIVE_PERSONAL_JOB':
        return [t(language, 'accountDeletionJobBlocker', {
          count: String(blocker.job_count),
        })];
      case 'ACTIVE_PERSONAL_SUBSCRIPTION':
        return [t(language, 'accountDeletionSubscriptionBlocker', {
          count: String(blocker.subscription_count),
        })];
      case 'ACTIVE_STORE_SUBSCRIPTION':
        return [t(language, 'accountDeletionStoreBlocker', {
          count: String(blocker.subscription_count),
        })];
      case 'PERSONAL_ASSETS':
        return [t(language, 'accountDeletionAssetsBlocker', {
          count: String(blocker.asset_count),
        })];
    }
  });
  return <Notice message={messages.join('\n')} tone="danger" />;
}

function DeletionStatus({
  language,
  result,
}: {
  language: UiLanguage;
  result: AccountDeletionResultRecord;
}): React.JSX.Element | null {
  if (result.status === 'blocked') return null;
  if (result.status === 'completed') {
    return <Notice message={t(language, 'accountDeletionCompleted')} />;
  }
  if (result.status === 'in_progress') {
    return <Notice message={t(language, 'accountDeletionInProgress')} />;
  }
  return (
    <Notice message={t(language, nextActionMessage(result.next_action))} />
  );
}

function nextActionMessage(
  action: Extract<
    AccountDeletionResultRecord,
    { status: 'pending_external_action' }
  >['next_action'],
):
  | 'accountDeletionPendingSubscriptions'
  | 'accountDeletionPendingAssets'
  | 'accountDeletionPendingAnonymize'
  | 'accountDeletionPendingDisableIdentity'
  | 'accountDeletionPendingDeleteIdentity' {
  switch (action) {
    case 'cancel_personal_subscriptions':
      return 'accountDeletionPendingSubscriptions';
    case 'delete_personal_assets':
      return 'accountDeletionPendingAssets';
    case 'anonymize_personal_data':
      return 'accountDeletionPendingAnonymize';
    case 'disable_identity':
      return 'accountDeletionPendingDisableIdentity';
    case 'delete_identity':
      return 'accountDeletionPendingDeleteIdentity';
  }
}

function storeLabel(store: 'apple' | 'google', language: UiLanguage): string {
  if (store === 'apple') return 'App Store';
  return language === 'ja' ? 'Google Play' : 'Google Play';
}

const styles = StyleSheet.create({
  body: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 21,
  },
  checkbox: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  checkboxGlyph: {
    color: colors.accentInk,
    fontSize: 14,
    fontWeight: '900',
  },
  checkboxLabel: {
    color: colors.ink,
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
  },
  checkboxMark: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxMarkChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  container: {
    gap: spacing.md,
  },
  disabled: {
    opacity: 0.5,
  },
  impactList: {
    gap: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  label: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.75,
  },
  warning: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
  },
});
