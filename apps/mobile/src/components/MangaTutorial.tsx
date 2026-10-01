import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { AccessibilityInfo, AppState, findNodeHandle, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { CreditBalanceBadge } from '@/components/CreditBalanceBadge';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { mangaGuidanceMessages } from '@/lib/mangaGuidanceMessages';
import { loadMangaTutorialHistory, markMangaTutorialSeen } from '@/lib/mangaTutorialHistory';
import { useAppState } from '@/state/appState';
import { useDirtyState } from '@/state/dirtyState';

interface MangaTutorialProps {
  firstRun?: boolean;
}

// U03: a skippable guide with no editor, selection or generation side effects.
// Auto-open is limited to the focused library without dirty editors. Modal owns
// its safe-area context and scrolling so large text never pushes close offscreen.
export function MangaTutorial({ firstRun = false }: MangaTutorialProps): React.JSX.Element {
  const { language } = useAppState();
  const { hasDirtyEditors } = useDirtyState();
  const focused = useIsFocused();
  const copy = mangaGuidanceMessages(language);
  const [step, setStep] = useState<number | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const autoAttempted = useRef(false);
  const triggerRef = useRef<View | null>(null);
  const titleRef = useRef<Text | null>(null);
  const restoreFocus = useRef(false);
  const openRef = useRef(false);
  const mountedRef = useRef(true);
  const visible = step !== null && focused && foreground && !hasDirtyEditors;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!firstRun || !focused || !foreground || hasDirtyEditors || autoAttempted.current) return;
    let current = true;
    void loadMangaTutorialHistory().then((history) => {
      if (!current || autoAttempted.current) return;
      autoAttempted.current = true;
      if (history === 'unseen' && !openRef.current) {
        openRef.current = true;
        setStep(0);
      }
    });
    return () => { current = false; };
  }, [firstRun, focused, foreground, hasDirtyEditors]);

  const restoreTriggerFocus = useCallback((): void => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    const node = findNodeHandle(triggerRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);
  useEffect(() => {
    if (!visible && Platform.OS === 'android') restoreTriggerFocus();
  }, [restoreTriggerFocus, visible]);
  const close = (): void => {
    if (!openRef.current) return;
    openRef.current = false;
    autoAttempted.current = true;
    restoreFocus.current = true;
    setStep(null);
    void markMangaTutorialSeen().then((saved) => {
      if (mountedRef.current) setStorageError(!saved);
    });
  };
  const open = (): void => {
    autoAttempted.current = true;
    restoreFocus.current = false;
    openRef.current = true;
    setStep(0);
  };
  const focusTitle = (): void => {
    const node = findNodeHandle(titleRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  };
  const currentStep = copy.steps[step ?? 0];
  return (
    <View style={styles.root}>
      <Pressable accessibilityLabel={copy.replay} accessibilityRole="button" onPress={open} ref={triggerRef} style={styles.replay} testID="manga-tutorial-replay">
        <Text style={styles.replayLabel}>{copy.replay}</Text>
      </Pressable>
      {storageError ? <Notice message={copy.historyError} tone="warning" /> : null}
      <Modal animationType="slide" backdropColor={colors.canvas} onDismiss={restoreTriggerFocus} onRequestClose={close} onShow={focusTitle} presentationStyle="fullScreen" visible={visible}>
        {visible ? (
          <SafeAreaProvider>
            <SafeAreaView accessibilityViewIsModal edges={['top', 'right', 'bottom', 'left']} onAccessibilityEscape={close} style={styles.safeArea}>
              <View style={styles.header}>
                <Text accessibilityRole="header" ref={titleRef} style={styles.title}>{copy.welcome}</Text>
                <Pressable accessibilityLabel={copy.close} accessibilityRole="button" onPress={close} style={styles.close} testID="manga-tutorial-close"><Text style={styles.closeText}>×</Text></Pressable>
              </View>
              <View style={styles.balance}><CreditBalanceBadge /></View>
              <ScrollView contentContainerStyle={styles.body}>
                <Text style={styles.progress}>{copy.progress} {(step ?? 0) + 1} / {copy.steps.length}</Text>
                <Text accessibilityRole="header" style={styles.stepTitle}>{currentStep.title}</Text>
                <Text style={styles.bodyText}>{currentStep.body}</Text>
              </ScrollView>
              <View style={styles.footer}>
                <PrimaryButton label={copy.skip} onPress={close} testID="manga-tutorial-skip" variant="ghost" />
                {(step ?? 0) > 0 ? <PrimaryButton label={copy.previous} onPress={() => setStep((value) => Math.max(0, (value ?? 0) - 1))} variant="secondary" testID="manga-tutorial-previous" /> : null}
                {(step ?? 0) === copy.steps.length - 1
                  ? <PrimaryButton label={copy.finish} onPress={close} testID="manga-tutorial-finish" />
                  : <PrimaryButton label={copy.next} onPress={() => setStep((value) => Math.min(copy.steps.length - 1, (value ?? 0) + 1))} testID="manga-tutorial-next" />}
              </View>
            </SafeAreaView>
          </SafeAreaProvider>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  balance: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  body: { padding: spacing.md, gap: spacing.md },
  bodyText: { ...textStyles.body, color: colors.ink },
  close: { minHeight: 44, minWidth: 44, borderColor: colors.controlBorder, borderWidth: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.ink, fontSize: 24 },
  footer: { gap: spacing.sm, padding: spacing.md, borderTopColor: colors.border, borderTopWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  progress: { ...textStyles.caption, color: colors.muted },
  replay: { minHeight: 46, padding: spacing.sm, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.secondarySurface, borderColor: colors.controlBorder, borderWidth: 1, borderRadius: radius.md },
  replayLabel: { ...textStyles.body, color: colors.inkStrong, fontWeight: '700' },
  root: { gap: spacing.sm },
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  stepTitle: { ...textStyles.sectionTitle, color: colors.primary },
  title: { ...textStyles.title, flex: 1 }
});
