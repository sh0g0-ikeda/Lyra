import { StyleSheet, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { spacing } from '@/constants/theme';
import type {
  EntityReferenceGenerationBlocker,
  EntityReferenceGenerationBlockerCode,
} from '@/domain/entityReferencePolicy';
import type { UiLanguage } from '@/domain/types';
import {
  entityGenerationBlockerRecoveryTarget,
  errorRecoveryActionLabel
} from '@/lib/errorRecovery';
import { t } from '@/lib/i18n';

interface EntityGenerationBlockersProps {
  blockers: readonly EntityReferenceGenerationBlocker[];
  language: UiLanguage;
  messageForCode: (code: EntityReferenceGenerationBlockerCode) => string;
  onAction: (code: EntityReferenceGenerationBlockerCode) => void;
}

export function EntityGenerationBlockers({
  blockers,
  language,
  messageForCode,
  onAction,
}: EntityGenerationBlockersProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      {blockers.map((blocker) => {
        const actionLabel = blockerActionLabel(blocker.code, language);
        return (
          <View key={blocker.code} style={styles.blocker}>
            <Notice message={messageForCode(blocker.code)} tone="warning" />
            {actionLabel === null ? null : (
              <PrimaryButton
                label={actionLabel}
                onPress={() => onAction(blocker.code)}
                variant="ghost"
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function blockerActionLabel(
  code: EntityReferenceGenerationBlockerCode,
  language: UiLanguage,
): string | null {
  const recoveryTarget = entityGenerationBlockerRecoveryTarget(code);
  if (recoveryTarget !== null) {
    return errorRecoveryActionLabel(recoveryTarget, language);
  }

  switch (code) {
    case 'ENTITY_SAVE_REQUIRED':
    case 'NAME_REQUIRED':
    case 'UNSUPPORTED_TYPE':
      return t(language, "generated.components.EntityGenerationBlockers.go.to.character.fields.89f8f72c");
    case 'IMPORT_IN_PROGRESS':
      return t(language, "generated.components.EntityGenerationBlockers.go.to.image.import.353096cb");
    case 'ACTIVE_PREVIEW_JOB':
    case 'INSUFFICIENT_CREDITS':
    case 'PERMISSION_REQUIRED':
      return null;
    case 'FEATURE_DISABLED':
      return null;
  }
}

const styles = StyleSheet.create({
  blocker: {
    gap: spacing.xs,
  },
  root: {
    gap: spacing.sm,
  },
});
