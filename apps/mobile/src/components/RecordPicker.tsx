import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';

interface RecordPickerProps<T extends { id: string }> {
  items: T[];
  selectedId: string | null;
  emptyLabel: string;
  helperText?: string;
  language: 'ja' | 'en';
  labelForItem: (item: T) => string;
  onSelect: (id: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onEndReached?: () => void;
}

export function RecordPicker<T extends { id: string }>({
  items,
  selectedId,
  emptyLabel,
  helperText,
  language,
  labelForItem,
  hasNextPage = false,
  isFetchingNextPage = false,
  onEndReached,
  onSelect,
  searchable = true,
  searchPlaceholder
}: RecordPickerProps<T>): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const triggerRef = useRef<View>(null);
  const restoreFocusOnCloseRef = useRef(false);
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!searchable || normalizedQuery.length === 0) {
      return items;
    }
    return items.filter((item) => labelForItem(item).toLowerCase().includes(normalizedQuery));
  }, [items, labelForItem, query, searchable]);

  const closeModal = (): void => {
    setModalVisible(false);
    setQuery('');
    restoreFocusOnCloseRef.current = true;
  };

  useEffect(() => {
    if (modalVisible || !restoreFocusOnCloseRef.current) {
      return;
    }

    const triggerNode = findNodeHandle(triggerRef.current);
    if (triggerNode !== null) {
      AccessibilityInfo.setAccessibilityFocus(triggerNode);
    }
    restoreFocusOnCloseRef.current = false;
  }, [modalVisible]);

  if (items.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

  const selectedItem = items.find((item) => item.id === selectedId) ?? null;
  return (
    <View style={styles.wrapper}>
      {helperText === undefined ? null : <Text style={styles.helper}>{helperText}</Text>}
      <Pressable
        accessibilityHint={t(language, "generated.components.RecordPicker.open.selection.list.8d5d116b")}
        accessibilityLabel={selectedItem === null ? emptyLabel : labelForItem(selectedItem)}
        accessibilityRole="button"
        onPress={() => setModalVisible(true)}
        ref={triggerRef}
        style={styles.trigger}
      >
        <Text numberOfLines={2} style={styles.triggerLabel}>
          {selectedItem === null ? emptyLabel : labelForItem(selectedItem)}
        </Text>
        <Text accessibilityElementsHidden style={styles.triggerChevron}>v</Text>
      </Pressable>
      <Modal animationType="fade" onRequestClose={closeModal} transparent visible={modalVisible}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalRoot}>
          <View style={styles.modalBackdrop}>
            <Pressable
              accessibilityLabel={t(language, "generated.components.RecordPicker.dismiss.selection.list.b8396a1a")}
              accessibilityRole="button"
              onPress={closeModal}
              style={styles.modalBackdropDismiss}
            />
            <View
              accessibilityLabel={t(language, "generated.components.RecordPicker.selection.list.c7d6405c")}
              accessibilityViewIsModal
              onAccessibilityEscape={closeModal}
              style={styles.modalSheet}
            >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedItem === null ? emptyLabel : labelForItem(selectedItem)}</Text>
              <Pressable
                accessibilityLabel={t(language, "generated.components.RecordPicker.close.selection.list.530e9cf7")}
                accessibilityRole="button"
                onPress={closeModal}
                style={styles.closeButton}
              >
                <Text style={styles.closeText}>{t(language, "generated.components.RecordPicker.close.603bc62f")}</Text>
              </Pressable>
            </View>
            {searchable ? (
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t(language, "generated.components.RecordPicker.search.options.03c69ad2")}
                onChangeText={setQuery}
                placeholder={searchPlaceholder ?? t(language, "generated.components.RecordPicker.search.3c2220c0")}
                placeholderTextColor={colors.disabled}
                returnKeyType="search"
                style={styles.search}
                value={query}
              />
            ) : null}
            <FlatList
              contentContainerStyle={styles.modalOptions}
              data={filteredItems}
              extraData={selectedId}
              initialNumToRender={12}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => item.id}
              ListFooterComponent={
                isFetchingNextPage
                  ? <ActivityIndicator accessibilityLabel={t(language, "generated.components.RecordPicker.loading.more.items.f94cc32f")} />
                  : null
              }
              ListEmptyComponent={
                <Text style={styles.emptyInline}>
                  {t(language, "generated.components.RecordPicker.no.matching.items.a6659e80")}
                </Text>
              }
              maxToRenderPerBatch={12}
              onEndReached={() => {
                if (hasNextPage && !isFetchingNextPage && query.trim().length === 0) {
                  onEndReached?.();
                }
              }}
              onEndReachedThreshold={0.5}
              removeClippedSubviews={Platform.OS === 'android'}
              renderItem={({ item }) => {
                const selected = item.id === selectedId;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={labelForItem(item)}
                    key={item.id}
                    onPress={() => {
                      onSelect(item.id);
                      closeModal();
                    }}
                    style={[styles.radioOption, selected ? styles.radioOptionSelected : null]}
                  >
                    <View style={[styles.radioOuter, selected ? styles.radioOuterSelected : null]}>
                      {selected ? <View style={styles.radioInner} /> : null}
                    </View>
                    <Text style={[styles.label, selected ? styles.selectedLabel : null]}>{labelForItem(item)}</Text>
                  </Pressable>
                );
              }}
              windowSize={7}
            />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  closeText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700'
  },
  empty: {
    backgroundColor: 'rgba(16, 16, 16, 0.72)',
    borderColor: 'rgba(229, 199, 107, 0.16)',
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    color: colors.muted,
    fontSize: 14,
    letterSpacing: 0,
    padding: spacing.md
  },
  emptyInline: {
    color: colors.muted,
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 18
  },
  helper: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 16
  },
  label: {
    color: colors.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 18
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg
  },
  modalBackdropDismiss: {
    ...StyleSheet.absoluteFill
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  modalOptions: {
    gap: spacing.xs,
    paddingBottom: spacing.sm
  },
  modalRoot: {
    flex: 1
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: '76%',
    maxWidth: 560,
    padding: spacing.lg,
    width: '100%'
  },
  modalTitle: {
    color: colors.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21
  },
  radioInner: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 10,
    width: 10
  },
  radioOption: {
    alignItems: 'center',
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  radioOptionSelected: {
    backgroundColor: 'rgba(229, 199, 107, 0.12)',
    borderColor: colors.primary
  },
  radioOuter: {
    alignItems: 'center',
    borderColor: colors.muted,
    borderRadius: 999,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22
  },
  radioOuterSelected: {
    borderColor: colors.primary
  },
  search: {
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    color: colors.ink,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  selectedLabel: {
    color: colors.primary,
    fontWeight: '700'
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  triggerChevron: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700'
  },
  triggerLabel: {
    color: colors.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19
  },
  wrapper: {
    gap: spacing.xs
  }
});
