import { useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, Image, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, textStyles } from '@/constants/theme';
import { AiContentReportButton } from '@/components/AiContentReportButton';
import { downloadExternalFile } from '@/lib/download';
import { t } from '@/lib/i18n';

interface ImagePreviewModalProps {
  contentId?: string | null;
  uri: string | null;
  headers?: Record<string, string>;
  language: 'ja' | 'en';
  onClose: () => void;
  restoreFocusRef?: RefObject<View | null>;
}

interface PreviewPoint {
  x: number;
  y: number;
}

interface PreviewGesture {
  initialDistance: number | null;
  initialScale: number;
  initialTranslation: PreviewPoint;
  moved: boolean;
  startPoint: PreviewPoint | null;
}

const MAX_ZOOM = 4;
const MIN_ZOOM = 1;
const DOUBLE_TAP_DELAY_MS = 280;

function touchPoints(event: GestureResponderEvent): PreviewPoint[] {
  return event.nativeEvent.touches.map((touch) => ({ x: touch.pageX, y: touch.pageY }));
}

function distanceBetween(points: readonly PreviewPoint[]): number | null {
  if (points.length < 2) return null;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function constrain(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

export function ImagePreviewModal({ contentId, uri, headers, language, onClose, restoreFocusRef }: ImagePreviewModalProps): React.JSX.Element {
  const [sharing, setSharing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const previewWidth = Math.min(520, Math.max(240, windowWidth - spacing.lg * 2));
  const previewHeight = Math.min(720, Math.max(240, windowHeight - 250));
  const wasVisibleRef = useRef(uri !== null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [translation, setTranslation] = useState<PreviewPoint>({ x: 0, y: 0 });
  const zoomRef = useRef(MIN_ZOOM);
  const translationRef = useRef<PreviewPoint>({ x: 0, y: 0 });
  const gestureRef = useRef<PreviewGesture | null>(null);
  const lastTapAtRef = useRef(0);
  const resetIdentityRef = useRef(`${uri ?? 'closed'}:${previewWidth}:${previewHeight}`);

  const resetZoom = (): void => {
    zoomRef.current = MIN_ZOOM;
    translationRef.current = { x: 0, y: 0 };
    gestureRef.current = null;
    lastTapAtRef.current = 0;
    setZoom(MIN_ZOOM);
    setTranslation({ x: 0, y: 0 });
  };

  const applyZoom = (nextZoom: number): void => {
    const constrainedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    zoomRef.current = constrainedZoom;
    setZoom(constrainedZoom);
    const xLimit = (previewWidth * (constrainedZoom - MIN_ZOOM)) / 2;
    const yLimit = (previewHeight * (constrainedZoom - MIN_ZOOM)) / 2;
    const constrainedTranslation = {
      x: constrain(translationRef.current.x, xLimit),
      y: constrain(translationRef.current.y, yLimit)
    };
    translationRef.current = constrainedTranslation;
    setTranslation(constrainedTranslation);
  };

  const applyTranslation = (next: PreviewPoint, activeZoom = zoomRef.current): void => {
    const xLimit = (previewWidth * (activeZoom - MIN_ZOOM)) / 2;
    const yLimit = (previewHeight * (activeZoom - MIN_ZOOM)) / 2;
    const constrained = { x: constrain(next.x, xLimit), y: constrain(next.y, yLimit) };
    translationRef.current = constrained;
    setTranslation(constrained);
  };

  const beginGesture = (event: GestureResponderEvent): void => {
    const points = touchPoints(event);
    const initialDistance = distanceBetween(points);
    gestureRef.current = {
      initialDistance,
      initialScale: zoomRef.current,
      initialTranslation: translationRef.current,
      moved: false,
      startPoint: initialDistance === null ? points[0] ?? null : null
    };
  };

  const moveGesture = (event: GestureResponderEvent): void => {
    const gesture = gestureRef.current;
    if (gesture === null) return;
    const points = touchPoints(event);
    const nextDistance = distanceBetween(points);
    if (nextDistance !== null) {
      if (gesture.initialDistance === null) {
        gesture.initialDistance = nextDistance;
        gesture.initialScale = zoomRef.current;
        gesture.startPoint = null;
        return;
      }
      gesture.moved = true;
      applyZoom(gesture.initialScale * (nextDistance / gesture.initialDistance));
      return;
    }
    const point = points[0];
    if (point === undefined || gesture.startPoint === null || zoomRef.current === MIN_ZOOM) return;
    gesture.moved = gesture.moved || point.x !== gesture.startPoint.x || point.y !== gesture.startPoint.y;
    applyTranslation({
      x: gesture.initialTranslation.x + point.x - gesture.startPoint.x,
      y: gesture.initialTranslation.y + point.y - gesture.startPoint.y
    });
  };

  const endGesture = (): void => {
    const gesture = gestureRef.current;
    const wasPinch = gesture?.initialDistance !== null;
    gestureRef.current = null;
    if (zoomRef.current < 1.05) {
      resetZoom();
      return;
    }
    if (wasPinch || gesture?.moved) return;
    const now = Date.now();
    if (now - lastTapAtRef.current <= DOUBLE_TAP_DELAY_MS) {
      resetZoom();
      lastTapAtRef.current = 0;
      return;
    }
    lastTapAtRef.current = now;
  };

  useEffect(() => {
    const resetIdentity = `${uri ?? 'closed'}:${previewWidth}:${previewHeight}`;
    if (resetIdentityRef.current === resetIdentity) {
      return;
    }
    resetIdentityRef.current = resetIdentity;
    const resetTimer = setTimeout(resetZoom, 0);
    return () => clearTimeout(resetTimer);
  }, [previewHeight, previewWidth, uri]);

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
    try {
      const extension = uri.toLowerCase().includes('.jpg') || uri.toLowerCase().includes('.jpeg') ? 'jpg' : 'png';
      await downloadExternalFile({
        filename: `lyra-preview-${Date.now()}.${extension}`,
        headers,
        mimeType: extension === 'jpg' ? 'image/jpeg' : 'image/png',
        url: uri
      });
    } catch {
      setErrorMessage(t(language, "generated.components.ImagePreviewModal.failed.to.share.or.save.the.image.752f4863"));
    } finally {
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
            <View
              onMoveShouldSetResponder={() => true}
              onResponderGrant={beginGesture}
              onResponderMove={moveGesture}
              onResponderRelease={endGesture}
              onResponderTerminate={endGesture}
              onStartShouldSetResponder={() => true}
              style={[styles.zoomSurface, { height: previewHeight, width: previewWidth }]}
              testID="image-preview-zoom-surface"
            >
              <Image
                resizeMode="contain"
                source={headers === undefined ? { uri } : { uri, headers }}
                style={[
                  styles.previewImage,
                  {
                    height: previewHeight,
                    width: previewWidth,
                    transform: [
                      { translateX: translation.x },
                      { translateY: translation.y },
                      { scale: zoom }
                    ]
                  }
                ]}
              />
            </View>
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
            <AiContentReportButton contentId={contentId} contentKind="generated_image" language={language} />
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
    color: '#FFD56A'
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
  previewImage: {
    position: 'absolute'
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
  zoomSurface: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  }
});
