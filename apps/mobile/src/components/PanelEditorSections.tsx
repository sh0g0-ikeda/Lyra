import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ChevronRight } from 'lucide-react-native';

import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import type { ComponentTranslationKey } from '@/lib/i18nComponentMessages';
import { t } from '@/lib/i18n';

interface PanelEditorSectionContent {
  characters: React.ReactNode;
  compositionAndCamera: React.ReactNode;
  dialogue: React.ReactNode;
  effectsAndNotes: React.ReactNode;
  situationAndBackground: React.ReactNode;
}

interface PanelEditorSectionsProps {
  disabled?: boolean;
  language: UiLanguage;
  panelId: string | null;
  sections: PanelEditorSectionContent;
}

type PanelEditorSectionKey = keyof PanelEditorSectionContent;

interface SectionDefinition {
  key: PanelEditorSectionKey;
  labelKey: ComponentTranslationKey;
}

const definitions: readonly SectionDefinition[] = [
  { key: 'situationAndBackground', labelKey: 'component.panelEditorSections.situationAndBackground' },
  { key: 'compositionAndCamera', labelKey: 'component.panelEditorSections.compositionAndCamera' },
  { key: 'characters', labelKey: 'component.panelEditorSections.characters' },
  { key: 'dialogue', labelKey: 'component.panelEditorSections.dialogue' },
  { key: 'effectsAndNotes', labelKey: 'component.panelEditorSections.effectsAndNotes' }
];

export function PanelEditorSections({
  disabled = false,
  language,
  panelId,
  sections
}: PanelEditorSectionsProps): React.JSX.Element {
  const [activeDialog, setActiveDialog] = useState<{
    key: PanelEditorSectionKey;
    panelId: string | null;
  } | null>(null);
  const triggerRefs = useRef(new Map<PanelEditorSectionKey, View | null>());
  const restoreFocusRef = useRef<PanelEditorSectionKey | null>(null);
  const headerRef = useRef<View | null>(null);
  const previouslyVisibleRef = useRef(false);

  const visible = activeDialog !== null && activeDialog.panelId === panelId && !disabled;

  if (activeDialog !== null && (disabled || activeDialog.panelId !== panelId)) {
    setActiveDialog(null);
  }

  const restoreTriggerFocus = useCallback((): void => {
    if (restoreFocusRef.current === null) {
      return;
    }
    const triggerNode = findNodeHandle(triggerRefs.current.get(restoreFocusRef.current) ?? null);
    if (triggerNode !== null) {
      AccessibilityInfo.setAccessibilityFocus(triggerNode);
    }
    restoreFocusRef.current = null;
  }, []);

  useEffect(() => {
    if (!visible && previouslyVisibleRef.current && Platform.OS === 'android') {
      restoreTriggerFocus();
    }
    previouslyVisibleRef.current = visible;
  }, [restoreTriggerFocus, visible]);

  const close = (): void => {
    if (activeDialog !== null) {
      restoreFocusRef.current = activeDialog.key;
    }
    setActiveDialog(null);
  };

  const open = (key: PanelEditorSectionKey): void => {
    if (disabled) {
      return;
    }
    restoreFocusRef.current = null;
    setActiveDialog({ key, panelId });
  };

  const focusHeader = (): void => {
    const headerNode = findNodeHandle(headerRef.current);
    if (headerNode !== null) {
      AccessibilityInfo.setAccessibilityFocus(headerNode);
    }
  };

  const activeDefinition = activeDialog === null
    ? null
    : definitions.find((definition) => definition.key === activeDialog.key) ?? null;
  const activeLabel = activeDefinition === null ? '' : t(language, activeDefinition.labelKey);

  return (
    <View style={styles.root}>
      {definitions.map((definition) => {
        const label = t(language, definition.labelKey);
        return (
          <Pressable
            accessibilityLabel={t(language, 'component.panelEditorSections.open', { label })}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            key={definition.key}
            onPress={() => open(definition.key)}
            ref={(node: View | null): void => { triggerRefs.current.set(definition.key, node); }}
            style={styles.trigger}
          >
            <Text style={styles.triggerText}>{label}</Text>
            <ChevronRight color={colors.primary} size={20} strokeWidth={2} />
          </Pressable>
        );
      })}

      <Modal
        animationType="slide"
        backdropColor={colors.canvas}
        onDismiss={restoreTriggerFocus}
        onRequestClose={() => close()}
        onShow={focusHeader}
        presentationStyle="fullScreen"
        visible={visible}
      >
        {visible && activeDefinition !== null ? (
          <SafeAreaProvider>
            <SafeAreaView
              accessibilityViewIsModal
              edges={['top', 'right', 'bottom', 'left']}
              onAccessibilityEscape={() => close()}
              style={styles.safeArea}
            >
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoiding}>
                <View style={styles.header}>
                  <Text accessibilityRole="header" ref={headerRef} style={styles.headerTitle}>
                    {activeLabel}
                  </Text>
                  <Pressable
                    accessibilityLabel={t(language, 'component.panelEditorSections.close')}
                    accessibilityRole="button"
                    onPress={() => close()}
                    style={styles.closeButton}
                  >
                    <Text style={styles.closeText}>{t(language, 'component.panelEditorSections.close')}</Text>
                  </Pressable>
                </View>
                <ScrollView
                  contentContainerStyle={styles.content}
                  indicatorStyle="white"
                  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  style={styles.scroll}
                >
                  {sections[activeDefinition.key]}
                </ScrollView>
              </KeyboardAvoidingView>
            </SafeAreaView>
          </SafeAreaProvider>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm
  },
  closeText: {
    ...textStyles.body,
    color: colors.primary,
    fontWeight: '700'
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.lg
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing.md
  },
  headerTitle: {
    ...textStyles.sectionTitle,
    color: colors.inkStrong,
    flex: 1
  },
  keyboardAvoiding: {
    flex: 1,
    minHeight: 0
  },
  root: {
    gap: spacing.sm
  },
  safeArea: {
    backgroundColor: colors.canvas,
    flex: 1
  },
  scroll: {
    flex: 1,
    minHeight: 0
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  triggerText: {
    ...textStyles.body,
    color: colors.inkStrong,
    fontWeight: '700'
  }
});
