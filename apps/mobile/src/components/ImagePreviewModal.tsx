import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ResilientImage } from '@/components/ResilientImage';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { RemoteImageSource } from '@/domain/imageSourceCandidates';
import { t } from '@/lib/i18n';

interface ImagePreviewModalProps {
  uri: string | null;
  headers?: Record<string, string>;
  sources?: readonly RemoteImageSource[];
  language: 'ja' | 'en';
  onClose: () => void;
  restoreFocusRef?: RefObject<View | null>;
}

export function ImagePreviewModal({ uri, headers, sources, language, onClose, restoreFocusRef }: ImagePreviewModalProps): React.JSX.Element {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const previewWidth = Math.min(520, Math.max(240, windowWidth - spacing.lg * 2));
  const previewHeight = Math.min(720, Math.max(240, windowHeight - 250));
  const previewSources = useMemo<readonly RemoteImageSource[]>(
    () => sources ?? (uri === null ? [] : [headers === undefined ? { uri } : { uri, headers }]),
    [headers, sources, uri]
  );
  const visible = previewSources.length > 0;
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

  return (
    <Modal
      animationType="fade"
      presentationStyle="fullScreen"
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
        <View style={styles.backdrop}>
          <Pressable
            accessibilityLabel={t(language, "generated.components.ImagePreviewModal.close.image.preview.a2ff8367")}
            accessibilityRole="button"
            onPress={onClose}
            style={styles.backdropDismiss}
          />
          <View
            accessibilityLabel={t(language, "generated.components.ImagePreviewModal.image.preview.0f884bd2")}
            accessibilityViewIsModal
            onAccessibilityEscape={onClose}
            style={styles.previewShell}
          >
          <View style={styles.previewHeader}>
            <Text style={styles.title}>{t(language, "generated.components.ImagePreviewModal.image.preview.0f884bd2")}</Text>
            <Pressable
              accessibilityLabel={t(language, "generated.components.ImagePreviewModal.close.image.preview.dialog.ae1f4907")}
              accessibilityRole="button"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>{t(language, "generated.components.ImagePreviewModal.close.603bc62f")}</Text>
            </Pressable>
          </View>
          {!visible ? null : (
            <ScrollView
              centerContent
              contentContainerStyle={styles.zoomContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <ResilientImage
                contentFit="contain"
                sources={previewSources}
                style={{ height: previewHeight, width: previewWidth }}
              />
            </ScrollView>
          )}
          <View style={styles.footer}>
            <Text style={styles.hint}>{t(language, "generated.components.ImagePreviewModal.pinch.to.zoom.then.pan.the.enlarged.imag.a4a196d1")}</Text>
          </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg
  },
  backdropDismiss: {
    ...StyleSheet.absoluteFill
  },
  closeButton: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  closeText: {
    ...textStyles.body,
    color: colors.primaryText,
    fontWeight: '700'
  },
  footer: {
    gap: spacing.sm
  },
  hint: {
    ...textStyles.caption,
    color: colors.muted
  },
  previewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  previewShell: {
    maxWidth: 520,
    gap: spacing.md,
    width: '100%'
  },
  safeArea: {
    flex: 1
  },
  title: {
    ...textStyles.body,
    color: colors.ink,
    flex: 1,
    fontWeight: '700'
  },
  zoomContent: {
    alignItems: 'center',
    justifyContent: 'center'
  }
});
