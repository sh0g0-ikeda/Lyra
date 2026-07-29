import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import { LoadingState } from '@/components/LoadingState';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { spacing, textStyles } from '@/constants/theme';
import {
  invitationUnavailableReason,
  type InvitationUnavailableReason
} from '@/domain/invitationAvailability';
import type { OrganizationRole, OrganizationWorkspaceRecord } from '@/domain/types';
import { t } from '@/lib/i18n';
import type { ScreenTranslationKey } from '@/lib/i18nScreenMessages';
import { useAppState } from '@/state/appState';

interface InvitationScreenProps {
  onAccepted: (workspace: OrganizationWorkspaceRecord) => Promise<void>;
  onDismiss: () => Promise<void>;
  onSwitchAccount: () => Promise<void>;
  token: string;
}

const roleLabel = (
  role: OrganizationRole,
  language: 'ja' | 'en'
): string => {
  const labels: Record<OrganizationRole, ScreenTranslationKey> = {
    owner: 'screen.invitation.role.owner',
    admin: 'screen.invitation.role.admin',
    billing: 'screen.invitation.role.billing',
    editor: 'screen.invitation.role.editor',
    viewer: 'screen.invitation.role.viewer'
  };
  return t(language, labels[role]);
};

const unavailableMessage = (
  reason: InvitationUnavailableReason,
  invitedEmail: string,
  signedInEmail: string | null,
  language: 'ja' | 'en'
): string => {
  switch (reason) {
    case 'accepted':
      return t(language, "generated.screens.InvitationScreen.this.invitation.has.already.been.accepte.2c113ea3");
    case 'revoked':
      return t(language, "generated.screens.InvitationScreen.this.invitation.was.revoked.by.an.organi.3c92e56d");
    case 'expired':
      return t(language, "generated.screens.InvitationScreen.this.invitation.has.expired.ask.the.orga.b21aaea2");
    case 'email_mismatch':
      return t(language, 'screen.invitation.emailMismatch', {
        invitedEmail,
        signedInEmail: signedInEmail ?? '-'
      });
  }
};

export function InvitationScreen({
  onAccepted,
  onDismiss,
  onSwitchAccount,
  token
}: InvitationScreenProps): React.JSX.Element {
  const { api, language, session } = useAppState();
  const [openedAt] = useState(() => Date.now());
  const previewQuery = useQuery({
    queryKey: ['organization-invitation-preview', token],
    queryFn: () => api.previewOrganizationInvitation(token),
    retry: false
  });
  const acceptMutation = useMutation({
    mutationFn: () => api.acceptOrganizationInvitation(token),
    onSuccess: async (workspace) => onAccepted(workspace)
  });
  const preview = previewQuery.data ?? null;
  const unavailableReason =
    preview === null
      ? null
      : invitationUnavailableReason({
          expiresAt: preview.invitation.expires_at,
          invitedEmail: preview.invitation.email,
          nowMs: openedAt,
          signedInEmail: session?.user.email ?? null,
          status: preview.invitation.status
        });
  const unavailable = unavailableReason !== null;

  return (
    <Screen
      title={t(language, "generated.screens.InvitationScreen.organization.invitation.676739b1")}
    >
      {previewQuery.isLoading ? (
        <LoadingState
          label={t(language, "generated.screens.InvitationScreen.checking.invitation.4a34c674")}
        />
      ) : null}
      {previewQuery.isError ? (
        <ActionableErrorNotice
          actions={{
            login: () => {
              void onSwitchAccount();
            },
            retry: () => {
              void previewQuery.refetch();
            },
            workspace: () => {
              void onDismiss();
            }
          }}
          error={previewQuery.error}
          language={language}
        />
      ) : null}
      {preview === null ? null : (
        <Section title={preview.organization.name} tone="highlight">
          <View style={styles.detail}>
            <Text style={styles.label}>{t(language, "generated.screens.InvitationScreen.invited.email.8c95e5fa")}</Text>
            <Text style={styles.value}>{preview.invitation.email}</Text>
          </View>
          <View style={styles.detail}>
            <Text style={styles.label}>{t(language, "generated.screens.InvitationScreen.role.d6521bc4")}</Text>
            <Text style={styles.value}>{roleLabel(preview.invitation.role, language)}</Text>
          </View>
          <View style={styles.detail}>
            <Text style={styles.label}>{t(language, "generated.screens.InvitationScreen.signed.in.as.f7d810c5")}</Text>
            <Text style={styles.value}>{session?.user.email ?? '-'}</Text>
          </View>
          <Notice
            message={t(language, "generated.screens.InvitationScreen.confirm.that.you.are.signed.in.with.the.4461be8a")}
            tone="info"
          />
          {unavailableReason === null ? null : (
            <Notice
              message={unavailableMessage(
                unavailableReason,
                preview.invitation.email,
                session?.user.email ?? null,
                language,
              )}
              tone="danger"
            />
          )}
          {acceptMutation.isError ? (
            <ActionableErrorNotice
              actions={{
                login: () => {
                  void onSwitchAccount();
                },
                retry: () => {
                  acceptMutation.mutate();
                },
                workspace: () => {
                  void onDismiss();
                }
              }}
              error={acceptMutation.error}
              language={language}
            />
          ) : null}
          <PrimaryButton
            disabled={unavailable}
            disabledReason={
              unavailable
                ? t(language, "generated.screens.InvitationScreen.this.invitation.is.unavailable.165f0ff7")
                : undefined
            }
            label={t(language, "generated.screens.InvitationScreen.accept.invitation.392e11fb")}
            loading={acceptMutation.isPending}
            onPress={() => acceptMutation.mutate()}
          />
        </Section>
      )}
      <PrimaryButton
        label={t(language, "generated.screens.InvitationScreen.sign.in.with.another.account.03b3109a")}
        onPress={() => void onSwitchAccount()}
        variant="secondary"
      />
      <PrimaryButton
        label={t(language, "generated.screens.InvitationScreen.review.later.880bdff8")}
        onPress={() => void onDismiss()}
        variant="ghost"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  detail: {
    gap: spacing.xs
  },
  label: {
    ...textStyles.caption,
    fontWeight: '700'
  },
  value: {
    ...textStyles.body
  }
});
