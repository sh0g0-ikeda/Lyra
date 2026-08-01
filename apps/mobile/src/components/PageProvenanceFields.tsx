import { StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { SceneRecord, UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface PageProvenanceFieldsProps {
  continuityNote: string;
  editable: boolean;
  language: UiLanguage;
  onContinuityNoteChange: (value: string) => void;
  onPagePurposeChange: (value: string) => void;
  pagePurpose: string;
  scenes: readonly SceneRecord[];
  sourceSceneIds: readonly string[];
}

const sceneLabel = (scene: SceneRecord, language: UiLanguage): string => {
  const prefix = `${t(language, "generated.components.PageProvenanceFields.scene.dd61f732")} ${scene.order}`;
  const location = scene.location?.trim() ?? '';
  return location.length === 0 ? prefix : `${prefix}: ${location}`;
};

export function PageProvenanceFields({
  continuityNote,
  editable,
  language,
  onContinuityNoteChange,
  onPagePurposeChange,
  pagePurpose,
  scenes,
  sourceSceneIds
}: PageProvenanceFieldsProps): React.JSX.Element {
  const sourceScenes = sourceSceneIds.map((sceneId) => ({
    id: sceneId,
    scene: scenes.find((candidate) => candidate.id === sceneId) ?? null
  }));

  return (
    <View style={styles.root}>
      <Text style={styles.label}>{t(language, "generated.components.PageProvenanceFields.source.scenes.28eebb39")}</Text>
      {sourceScenes.length === 0 ? (
        <Text style={styles.empty}>
          {t(language, "generated.components.PageProvenanceFields.no.source.scenes.4b466703")}
        </Text>
      ) : (
        <View accessibilityLabel={t(language, "generated.components.PageProvenanceFields.source.scenes.28eebb39")} style={styles.chips}>
          {sourceScenes.map(({ id, scene }) => (
            <View key={id} style={styles.chip}>
              <Text numberOfLines={2} style={styles.chipText}>
                {scene === null
                  ? t(language, "generated.components.PageProvenanceFields.deleted.source.scene.2ecddecb")
                  : sceneLabel(scene, language)}
              </Text>
            </View>
          ))}
        </View>
      )}
      <FormField
        editable={editable}
        label={t(language, 'pagePurpose')}
        maxLength={500}
        multiline
        multilineMaxHeight={96}
        multilineMinHeight={64}
        onChangeText={onPagePurposeChange}
        value={pagePurpose}
      />
      <FormField
        editable={editable}
        label={t(language, 'continuityNote')}
        maxLength={1000}
        multiline
        multilineMaxHeight={96}
        multilineMinHeight={64}
        onChangeText={onContinuityNoteChange}
        value={continuityNote}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  chipText: {
    ...textStyles.body,
    color: colors.primary,
    fontWeight: '700'
  },
  chips: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  empty: {
    ...textStyles.caption
  },
  label: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  root: {
    gap: spacing.md
  }
});
