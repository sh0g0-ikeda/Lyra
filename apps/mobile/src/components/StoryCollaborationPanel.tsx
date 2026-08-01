import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

const MAX_INSTRUCTION_LENGTH = 2000;
const MAX_APPLYABLE_DRAFT_LENGTH = 8000;

interface StoryCollaborationPanelProps {
  canEdit: boolean;
  error: string | null;
  instruction: string;
  language: UiLanguage;
  loading: boolean;
  onApply: () => void;
  onCancel: () => void;
  onInstructionChange: (value: string) => void;
  onRequest: () => void;
  proposal: string;
  selectedEpisode: boolean;
}

export function StoryCollaborationPanel({
  canEdit,
  error,
  instruction,
  language,
  loading,
  onApply,
  onCancel,
  onInstructionChange,
  onRequest,
  proposal,
  selectedEpisode
}: StoryCollaborationPanelProps): React.JSX.Element {
  const proposalTooLong = proposal.length > MAX_APPLYABLE_DRAFT_LENGTH;
  const requestDisabled = !canEdit || !selectedEpisode || instruction.trim().length === 0 || loading;
  const requestDisabledReason = !canEdit
    ? t(language, 'component.storyCollaboration.editPermissionRequired')
    : !selectedEpisode
      ? t(language, 'component.storyCollaboration.selectEpisodeFirst')
      : instruction.trim().length === 0
        ? t(language, 'component.storyCollaboration.enterInstruction')
        : undefined;

  return (
    <View style={styles.root}>
      <Text style={styles.description}>{t(language, 'component.storyCollaboration.description')}</Text>
      <FormField
        editable={!loading && canEdit}
        label={t(language, 'component.storyCollaboration.instruction')}
        maxLength={MAX_INSTRUCTION_LENGTH}
        multiline
        onChangeText={onInstructionChange}
        value={instruction}
      />
      <View style={styles.actions}>
        <PrimaryButton
          disabled={requestDisabled}
          disabledReason={requestDisabledReason}
          label={t(language, 'component.storyCollaboration.request')}
          loading={loading}
          onPress={onRequest}
        />
        {loading ? (
          <PrimaryButton
            label={t(language, 'component.storyCollaboration.cancel')}
            onPress={onCancel}
            variant="ghost"
          />
        ) : null}
      </View>
      {error === null ? null : <Notice message={error} tone="warning" />}
      {proposal.trim().length === 0 ? null : (
        <View style={styles.proposal}>
          <Text style={styles.proposalTitle}>{t(language, 'component.storyCollaboration.proposal')}</Text>
          <FormField
            editable={false}
            label={t(language, 'component.storyCollaboration.proposalDraft')}
            maxLength={25000}
            multiline
            multilineMaxHeight={280}
            onChangeText={() => undefined}
            value={proposal}
          />
          {proposalTooLong ? (
            <Notice message={t(language, 'component.storyCollaboration.proposalTooLong')} tone="warning" />
          ) : null}
          <PrimaryButton
            disabled={!canEdit || proposalTooLong}
            disabledReason={proposalTooLong ? t(language, 'component.storyCollaboration.proposalTooLong') : undefined}
            label={t(language, 'component.storyCollaboration.apply')}
            onPress={onApply}
            variant="secondary"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  description: {
    ...textStyles.caption,
    color: colors.mutedSoft
  },
  proposal: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingTop: spacing.md
  },
  proposalTitle: {
    ...textStyles.sectionTitle,
    color: colors.primary
  },
  root: {
    gap: spacing.md
  }
});
