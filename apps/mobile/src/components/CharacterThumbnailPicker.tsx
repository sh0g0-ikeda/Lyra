import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ZoomIn } from 'lucide-react-native';

import { ResilientImage } from '@/components/ResilientImage';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { buildEntityReferenceImageSources } from '@/domain/entityImageSources';
import { canDisplayMobileImage } from '@/domain/imageAccess';
import type { EntityRecord, UiLanguage } from '@/domain/types';
import { config } from '@/lib/config';
import { entityReferenceSetQueryKey } from '@/lib/queryKeys';
import { t } from '@/lib/i18n';
import { useAppState } from '@/state/appState';
import type { RemoteImageSource } from '@/domain/imageSourceCandidates';

const pageSizeForWidth = (width: number): number => width >= 380 ? 12 : 8;

interface CharacterThumbnailPickerProps {
  characters: readonly EntityRecord[];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  language: UiLanguage;
  onEndReached?: () => Promise<unknown> | unknown;
  selectedId: string | null;
  onSelect: (entityId: string) => void;
  onPreview: (entityId: string, sources: readonly RemoteImageSource[]) => void;
}

export function CharacterThumbnailPicker({ characters, hasNextPage = false, isFetchingNextPage = false, language, onEndReached, selectedId, onSelect, onPreview }: CharacterThumbnailPickerProps): React.JSX.Element {
  const { width: windowWidth } = useWindowDimensions();
  const columnCount = windowWidth >= 540 ? 4 : windowWidth >= 380 ? 3 : 2;
  const pageSize = pageSizeForWidth(windowWidth);
  const initiallySelectedIndex = selectedId === null ? -1 : characters.findIndex((character) => character.id === selectedId);
  const [pageIndex, setPageIndex] = useState(() => initiallySelectedIndex < 0 ? 0 : Math.floor(initiallySelectedIndex / pageSize));
  const [loadingRemotePage, setLoadingRemotePage] = useState(false);
  const pageCount = Math.ceil(characters.length / pageSize);
  const safePageIndex = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const visibleCharacters = characters.slice(safePageIndex * pageSize, (safePageIndex + 1) * pageSize);
  const gridWidth = Math.min(720, Math.max(0, windowWidth - spacing.lg * 4));
  const cardWidth = Math.floor((gridWidth - spacing.sm * (columnCount - 1)) / columnCount);
  const previousLabel = language === 'ja' ? '前のキャラクター' : 'Previous characters';
  const nextLabel = language === 'ja' ? '次のキャラクター' : 'Next characters';

  if (characters.length === 0) return <Text style={styles.empty}>{t(language, 'component.characterThumbnailPicker.empty')}</Text>;

  const showPrevious = safePageIndex > 0;
  const showNext = safePageIndex < pageCount - 1 || hasNextPage;
  const moveNext = async (): Promise<void> => {
    if (safePageIndex < pageCount - 1) {
      setPageIndex(safePageIndex + 1);
      return;
    }
    if (!hasNextPage || isFetchingNextPage || loadingRemotePage || onEndReached === undefined) return;
    setLoadingRemotePage(true);
    try {
      await onEndReached();
      // The query result is committed before fetchNextPage resolves. If the
      // fetched server page only fills the current local page, safePageIndex
      // remains clamped here; otherwise the new grid page opens immediately.
      setPageIndex(safePageIndex + 1);
    } catch {
      // Keep the current cards visible so the user can retry the next control.
    } finally {
      setLoadingRemotePage(false);
    }
  };

  return <View style={styles.root}>
    <View style={styles.grid} testID={`character-thumbnail-grid-${columnCount}`}>
      {visibleCharacters.map((character) => <CharacterThumbnail cardWidth={cardWidth} character={character} key={character.id} language={language} onPreview={onPreview} onSelect={onSelect} selected={selectedId === character.id} />)}
    </View>
    {showPrevious || showNext ? <View style={styles.pagination}>
      {showPrevious ? <Pressable accessibilityLabel={previousLabel} accessibilityRole="button" onPress={() => setPageIndex(safePageIndex - 1)} style={styles.pageButton}><Text style={styles.pageButtonText}>‹</Text></Pressable> : <View style={styles.pageSpacer} />}
      <Text style={styles.pageLabel}>{`${safePageIndex + 1} / ${pageCount}${hasNextPage ? '+' : ''}`}</Text>
      {showNext ? <Pressable accessibilityLabel={nextLabel} accessibilityRole="button" disabled={isFetchingNextPage || loadingRemotePage} onPress={() => { void moveNext(); }} style={[styles.pageButton, isFetchingNextPage || loadingRemotePage ? styles.loadMoreDisabled : null]} testID="character-thumbnail-load-more">{isFetchingNextPage || loadingRemotePage ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.pageButtonText}>›</Text>}</Pressable> : <View style={styles.pageSpacer} />}
    </View> : null}
  </View>;
}

function CharacterThumbnail({ cardWidth, character, language, onPreview, onSelect, selected }: { cardWidth: number; character: EntityRecord; language: UiLanguage; onPreview: CharacterThumbnailPickerProps['onPreview']; onSelect: CharacterThumbnailPickerProps['onSelect']; selected: boolean }): React.JSX.Element {
  const { api, selection, sessionKey, tokens } = useAppState();
  const organizationId = selection.organizationId;
  const referencesQuery = useQuery({ queryKey: entityReferenceSetQueryKey(sessionKey, character.id, organizationId), queryFn: () => api.getEntityReferenceSet(character.id, organizationId) });
  const sources = useMemo(() => {
    const referenceSet = referencesQuery.data;
    const eligible = referenceSet?.reference_images.filter(canDisplayMobileImage) ?? [];
    const reference = eligible.find((candidate) => candidate.ref_id === referenceSet?.primary_ref_id) ?? eligible[0];
    if (reference === undefined || referenceSet === undefined) return [];
    return buildEntityReferenceImageSources({ apiBaseUrl: config.apiBaseUrl, authorizationHeader: tokens === null ? null : `Bearer ${tokens.idToken}`, entityId: character.id, organizationId, reference, revision: referenceSet.updated_at, sessionKey });
  }, [character.id, organizationId, referencesQuery.data, sessionKey, tokens]);
  const selectLabel = t(language, 'component.characterThumbnailPicker.select', { name: character.name });
  const previewLabel = t(language, 'component.characterThumbnailPicker.preview', { name: character.name });

  return <View style={[styles.card, { width: cardWidth }, selected ? styles.selected : null]}>
    <Pressable accessibilityLabel={selectLabel} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onSelect(character.id)} style={styles.selectButton}>
      {sources.length === 0 ? <View style={styles.placeholder} testID={`character-thumbnail-empty-${character.id}`} /> : <ResilientImage contentFit="cover" sources={sources} style={styles.thumbnail} />}
      <Text numberOfLines={1} style={styles.name}>{character.name}</Text>
    </Pressable>
    {sources.length === 0 ? null : <Pressable accessibilityLabel={previewLabel} accessibilityRole="button" onPress={() => onPreview(character.id, sources)} style={styles.previewButton}><ZoomIn color={colors.inkStrong} size={19} strokeWidth={2.2} /></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, padding: spacing.xs, position: 'relative' },
  empty: { ...textStyles.caption, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: spacing.xs },
  loadMoreDisabled: { opacity: 0.6 },
  name: { ...textStyles.caption, color: colors.ink, fontWeight: '700', marginTop: spacing.xs },
  pageButton: { alignItems: 'center', backgroundColor: colors.controlSurface, borderColor: colors.controlBorder, borderRadius: radius.sm, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  pageButtonText: { color: colors.primary, fontSize: 28, fontWeight: '700', lineHeight: 34 },
  pageLabel: { ...textStyles.caption, color: colors.muted, fontWeight: '700' },
  pageSpacer: { height: 44, width: 44 },
  pagination: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  placeholder: { aspectRatio: 0.72, backgroundColor: colors.field, borderRadius: 4, width: '100%' },
  previewButton: { alignItems: 'center', backgroundColor: 'rgba(8, 8, 8, 0.88)', borderColor: colors.controlBorder, borderRadius: 4, borderWidth: 1, bottom: 32, height: 48, justifyContent: 'center', position: 'absolute', right: spacing.xs, width: 48 },
  root: { gap: spacing.xs },
  selectButton: { minHeight: 48 },
  selected: { borderColor: colors.primary, borderWidth: 2 },
  thumbnail: { aspectRatio: 0.72, backgroundColor: colors.field, borderRadius: 4, width: '100%' },
});
