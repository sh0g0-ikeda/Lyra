import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image, type ImageSource } from 'expo-image';

import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { PageRecord } from '@/domain/types';
import { t } from '@/lib/i18n';

const pageThumbnailItemWidth = 114;

interface PageThumbnailPickerProps {
  pages: readonly PageRecord[];
  selectedId: string | null;
  emptyLabel: string;
  helperText?: string;
  language: 'ja' | 'en';
  imageSourceFor: (page: PageRecord) => ImageSource | null;
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
  imageSourceFor,
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
          const source = page.generated_image === null ? null : imageSourceFor(page);
          return (
            <Pressable
              accessibilityLabel={label}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(page.id)}
              style={[styles.item, selected ? styles.itemSelected : null]}
            >
              {source === null ? (
                <View style={styles.placeholder}>
                  <Text style={styles.placeholderText}>{page.page_number}</Text>
                </View>
              ) : (
                <Image
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  priority={selected ? 'normal' : 'low'}
                  recyclingKey={`${page.id}:${page.generated_image?.generated_at ?? page.updated_at}`}
                  source={source}
                  style={styles.thumbnail}
                />
              )}
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
