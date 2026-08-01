import { useEffect, useRef, type RefObject } from 'react';
import type { ListRenderItem } from 'react-native';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import { t } from '@/lib/i18n';

interface OrganizationCollectionModalProps<T extends { id: string }> {
  data: readonly T[];
  emptyLabel: string;
  fetchingNextPage: boolean;
  hasNextPage: boolean;
  language?: 'ja' | 'en';
  loading?: boolean;
  onClose: () => void;
  onEndReached: () => void;
  renderItem: ListRenderItem<T>;
  restoreFocusRef?: RefObject<View | null>;
  title: string;
  visible: boolean;
}

export function OrganizationCollectionModal<T extends { id: string }>({
  data,
  emptyLabel,
  fetchingNextPage,
  hasNextPage,
  language = 'ja',
  loading = false,
  onClose,
  onEndReached,
  renderItem,
  restoreFocusRef,
  title,
  visible
}: OrganizationCollectionModalProps<T>): React.JSX.Element {
  const wasVisibleRef = useRef(visible);

  useEffect(() => {
    if (!visible && wasVisibleRef.current && restoreFocusRef !== undefined) {
      const triggerNode = findNodeHandle(restoreFocusRef.current);
      if (triggerNode !== null) {
        AccessibilityInfo.setAccessibilityFocus(triggerNode);
      }
    }
    wasVisibleRef.current = visible;
  }, [restoreFocusRef, visible]);

  const loadNextPage = (): void => {
    if (!hasNextPage || fetchingNextPage) {
      return;
    }
    onEndReached();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}
    >
      {visible ? (
        <SafeAreaView
          accessibilityViewIsModal
          edges={['top', 'bottom']}
          onAccessibilityEscape={onClose}
          style={styles.safeArea}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <PrimaryButton
              label={t(language, "generated.components.OrganizationCollectionModal.close.603bc62f")}
              onPress={onClose}
              variant="secondary"
            />
          </View>
          <FlatList
            accessibilityLabel={title}
            contentContainerStyle={data.length === 0 ? styles.emptyContent : styles.content}
            data={data as T[]}
            initialNumToRender={12}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator
                  accessibilityLabel={t(language, "generated.components.OrganizationCollectionModal.loading.7c96f399")}
                  color={colors.primary}
                  size="small"
                />
              ) : (
                <Text style={styles.emptyLabel}>{emptyLabel}</Text>
              )
            }
            ListFooterComponent={
              fetchingNextPage ? (
                <ActivityIndicator
                  accessibilityLabel={t(language, "generated.components.OrganizationCollectionModal.loading.more.7c040051")}
                  color={colors.primary}
                  size="small"
                />
              ) : null
            }
            maxToRenderPerBatch={12}
            onEndReached={loadNextPage}
            onEndReachedThreshold={0.35}
            removeClippedSubviews
            renderItem={renderItem}
            windowSize={7}
          />
        </SafeAreaView>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xl
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.md
  },
  emptyLabel: {
    ...textStyles.body,
    color: colors.muted,
    textAlign: 'center'
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md
  },
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1
  },
  title: {
    ...textStyles.title,
    color: colors.inkStrong,
    flex: 1
  }
});
