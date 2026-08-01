import { useEffect, useRef, useState, type RefObject } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, textStyles } from '@/constants/theme';
import { t } from '@/lib/i18n';

interface ImagePreviewModalProps {
  uri: string | null;
  headers?: Record<string, string>;
  language: 'ja' | 'en';
  onClose: () => void;
  restoreFocusRef?: RefObject<View | null>;
}

export function ImagePreviewModal({ uri, headers, language, onClose, restoreFocusRef }: ImagePreviewModalProps): React.JSX.Element {
  const [sharing, setSharing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const previewWidth = Math.min(520, Math.max(240, windowWidth - spacing.lg * 2));
  const previewHeight = Math.min(720, Math.max(240, windowHeight - 250));
  const wasVisibleRef = useRef(uri !== null);

  useEffect(() => {
    if (uri === null && wasVisibleRef.current && restoreFocusRef !== undefined) {
      const triggerNode = findNodeHandle(restoreFocusRef.current);
      if (triggerNode !== null) {
        AccessibilityInfo.setAccessibilityFocus(triggerNode);
      }
    }
    wasVisibleRef.current = uri !== null;
  }, [restoreFocusRef, uri]);

  const shareImage = async (): Promise<void> => {
    if (uri === null || sharing) {
      return;
    }

    setSharing(true);
    setErrorMessage(null);
    let temporaryFileUri: string | null = null;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available || FileSystem.cacheDirectory === null) {
        setErrorMessage(t(language, "generated.components.ImagePreviewModal.sharing.is.not.available.on.this.device.d6d5d6ff"));
        return;
      }

      const extension = uri.toLowerCase().includes('.jpg') || uri.toLowerCase().includes('.jpeg') ? 'jpg' : 'png';
      const fileUri = `${FileSystem.cacheDirectory}lyra-preview-${Date.now()}.${extension}`;
      const downloaded = await FileSystem.downloadAsync(uri, fileUri, { headers });
      temporaryFileUri = downloaded.uri;
      if (downloaded.status < 200 || downloaded.status >= 300) {
        throw new Error(`Image download failed with status ${downloaded.status}.`);
      }
      await Sharing.shareAsync(downloaded.uri, {
        dialogTitle: t(language, "generated.components.ImagePreviewModal.share.or.save.image.469fc004"),
        mimeType: extension === 'jpg' ? 'image/jpeg' : 'image/png'
      });
    } catch {
      setErrorMessage(t(language, "generated.components.ImagePreviewModal.failed.to.share.or.save.the.image.752f4863"));
    } finally {
      if (temporaryFileUri !== null) {
        await FileSystem.deleteAsync(temporaryFileUri, { idempotent: true }).catch(() => undefined);
      }
      setSharing(false);
    }
  };

  return (
    <Modal animationType="fade" transparent visible={uri !== null} onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
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
          {uri === null ? null : (
            <ScrollView
              centerContent
              contentContainerStyle={styles.zoomContent}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image
                resizeMode="contain"
                source={headers === undefined ? { uri } : { uri, headers }}
                style={{ height: previewHeight, width: previewWidth }}
              />
            </ScrollView>
          )}
          <View style={styles.footer}>
            <Text style={styles.hint}>{t(language, "generated.components.ImagePreviewModal.pinch.to.zoom.then.pan.the.enlarged.imag.a4a196d1")}</Text>
            {errorMessage === null ? null : <Text style={styles.error}>{errorMessage}</Text>}
            <Pressable
              accessibilityLabel={t(language, "generated.components.ImagePreviewModal.share.or.save.image.9f845398")}
              accessibilityRole="button"
              disabled={sharing || uri === null}
              onPress={() => void shareImage()}
              style={styles.shareButton}
            >
              {sharing ? <ActivityIndicator color={colors.primaryText} size="small" /> : null}
              <Text style={styles.shareText}>{t(language, "generated.components.ImagePreviewModal.share.save.9cc82713")}</Text>
            </Pressable>
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
  error: {
    ...textStyles.caption,
    color: colors.danger
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
  shareButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm
  },
  shareText: {
    ...textStyles.body,
    color: colors.primaryText,
    fontWeight: '700'
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
