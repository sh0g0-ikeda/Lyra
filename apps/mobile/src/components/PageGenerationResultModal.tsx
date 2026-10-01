import { useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PageImageViewer } from '@/components/PageImageViewer';
import { SegmentedControl } from '@/components/SegmentedControl';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { RemoteImageSource } from '@/domain/imageSourceCandidates';
import type { UiLanguage } from '@/domain/types';
import { pageWorkflowMessage as message } from '@/lib/pageWorkflowMessages';

export function PageGenerationResultModal({ visible, language, pageNumber, sources, hasNextPage, canGenerate, canRegenerate = canGenerate, renderStyle, onRenderStyleChange, onClose, onRegenerate, onNextPage, onReviewPages, onExpand, restoreFocusRef }: {
  visible: boolean; language: UiLanguage; pageNumber: number; sources: readonly RemoteImageSource[];
  hasNextPage: boolean; canGenerate: boolean; canRegenerate?: boolean; renderStyle: 'color' | 'monochrome'; onRenderStyleChange: (value: 'color' | 'monochrome') => void; onClose: () => void; onRegenerate: () => void; onNextPage: () => void;
  onReviewPages: () => void; onExpand: (source: RemoteImageSource) => void; restoreFocusRef?: RefObject<View | null>;
}): React.JSX.Element {
  const wasVisible = useRef(visible);
  useEffect(() => {
    const restore = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!restore || restoreFocusRef === undefined) return;
    const node = findNodeHandle(restoreFocusRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, [restoreFocusRef, visible]);
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaProvider><SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} style={styles.root}>
        <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{message(language, 'complete', { number: pageNumber })}</Text><PrimaryButton label={message(language, 'close')} onPress={onClose} variant="ghost" testID="page-result-close" /></View>
        <ScrollView contentContainerStyle={styles.body}>
          {sources.length === 0 ? <Text style={styles.help}>{message(language, 'imageMissing')}</Text> : <PageImageViewer sources={sources} expandLabel={message(language, 'viewResult')} onExpand={onExpand} imageStyle={styles.image} />}
          <Text style={styles.help}>{message(language, 'noAutomaticCharge')}</Text>
          <SegmentedControl value={renderStyle} onChange={onRenderStyleChange} options={[{ value: 'color', label: message(language, 'quoteColor') }, { value: 'monochrome', label: message(language, 'quoteMonochrome') }]} />
          {!hasNextPage ? <Text style={styles.help}>{message(language, 'lastPage')}</Text> : null}
        </ScrollView>
        <View style={styles.actions}>
          <PrimaryButton disabled={!canRegenerate} label={message(language, 'regenerate')} onPress={onRegenerate} variant="secondary" testID="page-result-regenerate" />
          {hasNextPage ? <PrimaryButton disabled={!canGenerate} label={message(language, 'nextPage')} onPress={onNextPage} testID="page-result-next" /> : <PrimaryButton label={message(language, 'reviewPages')} onPress={onReviewPages} testID="page-result-last" />}
        </View>
      </View>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.canvas }, header: { padding: spacing.md, gap: spacing.sm, borderBottomColor: colors.border, borderBottomWidth: 1 }, title: { ...textStyles.title }, body: { padding: spacing.md, gap: spacing.md }, image: { width: '100%', aspectRatio: 0.7, minHeight: 240 }, help: { ...textStyles.body }, actions: { padding: spacing.md, gap: spacing.sm } });
