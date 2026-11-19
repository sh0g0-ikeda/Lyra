import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ZoomIn } from 'lucide-react-native';

import { ResilientImage } from '@/components/ResilientImage';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { buildEntityReferenceImageSources } from '@/domain/entityImageSources';
import type { EntityRecord, UiLanguage } from '@/domain/types';
import { config } from '@/lib/config';
import { entityReferenceSetQueryKey } from '@/lib/queryKeys';
import { t } from '@/lib/i18n';
import { useAppState } from '@/state/appState';
import type { RemoteImageSource } from '@/domain/imageSourceCandidates';

interface CharacterThumbnailPickerProps {
  characters: readonly EntityRecord[];
  language: UiLanguage;
  selectedId: string | null;
  onSelect: (entityId: string) => void;
  onPreview: (entityId: string, sources: readonly RemoteImageSource[]) => void;
}

export function CharacterThumbnailPicker({
  characters,
  language,
  selectedId,
  onSelect,
  onPreview,
}: CharacterThumbnailPickerProps): React.JSX.Element {
  if (characters.length === 0) {
    return <Text style={styles.empty}>{t(language, 'component.characterThumbnailPicker.empty')}</Text>;
  }

  return (
    <ScrollView contentContainerStyle={styles.list} horizontal showsHorizontalScrollIndicator={false}>
      {characters.map((character) => (
        <CharacterThumbnail
          character={character}
          key={character.id}
          language={language}
          onPreview={onPreview}
          onSelect={onSelect}
          selected={selectedId === character.id}
        />
      ))}
    </ScrollView>
  );
}

function CharacterThumbnail({
  character,
  language,
  onPreview,
  onSelect,
  selected,
}: {
  character: EntityRecord;
  language: UiLanguage;
  onPreview: CharacterThumbnailPickerProps['onPreview'];
  onSelect: CharacterThumbnailPickerProps['onSelect'];
  selected: boolean;
}): React.JSX.Element {
  const { api, selection, sessionKey, tokens } = useAppState();
  const organizationId = selection.organizationId;
  const referencesQuery = useQuery({
    queryKey: entityReferenceSetQueryKey(sessionKey, character.id, organizationId),
    queryFn: () => api.getEntityReferenceSet(character.id, organizationId),
  });
  const sources = useMemo(() => {
    const referenceSet = referencesQuery.data;
    const reference = referenceSet?.reference_images.find(
      (candidate) => candidate.ref_id === referenceSet.primary_ref_id,
    );
    if (reference === undefined || referenceSet === undefined) return [];
    return buildEntityReferenceImageSources({
      apiBaseUrl: config.apiBaseUrl,
      authorizationHeader: tokens === null ? null : `Bearer ${tokens.idToken}`,
      entityId: character.id,
      organizationId,
      reference,
      revision: referenceSet.updated_at,
      sessionKey,
    });
  }, [character.id, organizationId, referencesQuery.data, sessionKey, tokens]);
  const selectLabel = t(language, 'component.characterThumbnailPicker.select', { name: character.name });
  const previewLabel = t(language, 'component.characterThumbnailPicker.preview', { name: character.name });

  return (
    <View style={[styles.card, selected ? styles.selected : null]}>
      <Pressable
        accessibilityLabel={selectLabel}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        onPress={() => onSelect(character.id)}
        style={styles.selectButton}
      >
        {sources.length === 0 ? (
          <View style={styles.placeholder}><Text style={styles.placeholderText}>{character.name.slice(0, 1)}</Text></View>
        ) : (
          <ResilientImage contentFit="cover" sources={sources} style={styles.thumbnail} />
        )}
        <Text numberOfLines={1} style={styles.name}>{character.name}</Text>
      </Pressable>
      {sources.length === 0 ? null : (
        <Pressable
          accessibilityLabel={previewLabel}
          accessibilityRole="button"
          onPress={() => onPreview(character.id, sources)}
          style={styles.previewButton}
        >
          <ZoomIn color={colors.inkStrong} size={19} strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, padding: spacing.xs, position: 'relative', width: 106 },
  empty: { ...textStyles.caption, color: colors.muted },
  list: { gap: spacing.sm, paddingVertical: spacing.xs },
  name: { ...textStyles.caption, color: colors.ink, fontWeight: '700', marginTop: spacing.xs },
  placeholder: { alignItems: 'center', aspectRatio: 0.72, backgroundColor: colors.field, borderRadius: 4, justifyContent: 'center' },
  placeholderText: { ...textStyles.sectionTitle, color: colors.muted },
  previewButton: { alignItems: 'center', backgroundColor: 'rgba(8, 8, 8, 0.88)', borderColor: colors.controlBorder, borderRadius: 4, borderWidth: 1, bottom: 32, height: 48, justifyContent: 'center', position: 'absolute', right: spacing.xs, width: 48 },
  selectButton: { minHeight: 48 },
  selected: { borderColor: colors.primary, borderWidth: 2 },
  thumbnail: { aspectRatio: 0.72, backgroundColor: colors.field, borderRadius: 4, width: '100%' },
});
