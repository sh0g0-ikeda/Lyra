import { useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Circle, CircleCheck } from 'lucide-react-native';

import { ResilientImage } from '@/components/ResilientImage';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import {
  imageSourceListIdentity,
  type RemoteImageSource
} from '@/domain/imageSourceCandidates';
import type { PageRecord } from '@/domain/types';
import { t } from '@/lib/i18n';

const pageThumbnailItemWidth = 114;

interface PageThumbnailPickerProps {
  pages: readonly PageRecord[];
  selectedId: string | null;
  emptyLabel: string;
  helperText?: string;
  language: 'ja' | 'en';
  imageSourcesFor: (page: PageRecord) => readonly RemoteImageSource[];
  statusLabelFor: (status: PageRecord['status']) => string;
  onSelect: (pageId: string) => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onEndReached?: () => void;
}

export function PageThumbnailPicker({
  pages,
  selectedId,
  emptyLabel,
  helperText,
  language,
  imageSourcesFor,
  hasNextPage = false,
  isFetchingNextPage = false,
  statusLabelFor,
  onEndReached,
  onSelect
}: PageThumbnailPickerProps): React.JSX.Element {
  if (pages.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

  return (
    <View style={styles.wrapper}>
      {helperText === undefined ? null : <Text style={styles.helper}>{helperText}</Text>}
      <FlatList
        data={pages}
        extraData={selectedId}
        getItemLayout={(_data, index) => ({
          index,
          length: pageThumbnailItemWidth,
          offset: pageThumbnailItemWidth * index
        })}
        horizontal
        initialNumToRender={6}
        keyExtractor={(page) => page.id}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            onEndReached?.();
          }
        }}
        onEndReachedThreshold={0.5}
        maxToRenderPerBatch={6}
        nestedScrollEnabled
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={({ item: page }) => {
          const selected = page.id === selectedId;
          const status = statusLabelFor(page.status);
          const label = t(language, 'component.pageThumbnailPicker.accessibilityLabel', {
            pageNumber: page.page_number,
            status
          });
          const sources =
            page.generated_image === null ? [] : imageSourcesFor(page);
          return (
            <Pressable
              accessibilityLabel={label}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(page.id)}
              style={[styles.item, selected ? styles.itemSelected : null]}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.selectionIndicator}
              >
                {selected ? (
                  <CircleCheck color={colors.primary} size={22} strokeWidth={2.4} />
                ) : (
                  <Circle color={colors.muted} size={22} strokeWidth={2} />
                )}
              </View>
              <PageThumbnailImage
                page={page}
                priority={selected ? 'normal' : 'low'}
                sources={sources}
              />
              <Text numberOfLines={1} style={[styles.pageNumber, selected ? styles.pageNumberSelected : null]}>
                {t(language, 'component.pageThumbnailPicker.pageNumber', { pageNumber: page.page_number })}
              </Text>
              <Text numberOfLines={1} style={styles.status}>{status}</Text>
            </Pressable>
          );
        }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        windowSize={5}
      />
    </View>
  );
}

function PageThumbnailImage({
  page,
  priority,
  sources
}: {
  page: PageRecord;
  priority: 'low' | 'normal';
  sources: readonly RemoteImageSource[];
}): React.JSX.Element {
  const sourceIdentity = imageSourceListIdentity(sources);
  const [failedSourceIdentity, setFailedSourceIdentity] =
    useState<string | null>(null);
  const failed = failedSourceIdentity === sourceIdentity;

  if (sources.length === 0 || failed) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>{page.page_number}</Text>
      </View>
    );
  }

  return (
    <ResilientImage
      cachePolicy="memory-disk"
      contentFit="cover"
      onExhausted={() => setFailedSourceIdentity(sourceIdentity)}
      priority={priority}
      sources={sources}
      style={styles.thumbnail}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    ...textStyles.caption,
    color: colors.muted
  },
  item: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 3,
    padding: spacing.xs,
    position: 'relative',
    width: 106
  },
  helper: {
    ...textStyles.caption,
    color: colors.muted
  },
  itemSelected: {
    borderColor: colors.primary,
    borderWidth: 2
  },
  list: {
    gap: spacing.sm,
    paddingVertical: spacing.xs
  },
  pageNumber: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  pageNumberSelected: {
    color: colors.primary
  },
  placeholder: {
    alignItems: 'center',
    aspectRatio: 0.7,
    backgroundColor: colors.field,
    borderRadius: 4,
    justifyContent: 'center',
    width: '100%'
  },
  placeholderText: {
    color: colors.muted,
    fontSize: 24,
    fontWeight: '700'
  },
  selectionIndicator: {
    alignItems: 'center',
    backgroundColor: 'rgba(8, 8, 8, 0.82)',
    borderRadius: 4,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
    width: 30,
    zIndex: 1
  },
  status: {
    ...textStyles.caption,
    color: colors.muted
  },
  thumbnail: {
    aspectRatio: 0.7,
    backgroundColor: colors.field,
    borderRadius: 4,
    width: '100%'
  },
  wrapper: {
    gap: spacing.xs
  }
});
