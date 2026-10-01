import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { pageCreationSteps, type PageCreationStep } from '@/domain/pageCreationWorkflow';
import type { UiLanguage } from '@/domain/types';
import { pageWorkflowMessage as message } from '@/lib/pageWorkflowMessages';

export function PageWorkflowSection({ active, children }: PropsWithChildren<{ active: boolean }>): React.JSX.Element {
  return <View accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={active ? styles.content : styles.hidden}>{children}</View>;
}

export function PageCreationStepNavigation({ language, step, hasPage, onChange }: {
  language: UiLanguage; step: PageCreationStep; hasPage: boolean; onChange: (step: PageCreationStep) => void;
}): React.JSX.Element {
  return <View style={styles.content}>
    <View accessibilityLabel={message(language, 'workflow')} style={styles.steps}>
      {pageCreationSteps.map((target, index) => <Pressable
        accessibilityRole="tab" accessibilityState={{ selected: step === target, disabled: target !== 'design' && !hasPage }}
        disabled={target !== 'design' && !hasPage} key={target} onPress={() => onChange(target)}
        style={[styles.step, step === target ? styles.selected : null]} testID={`page-step-${target}`}
      ><Text style={[styles.label, step === target ? styles.selectedLabel : null]}>{index + 1}. {message(language, target)}</Text></Pressable>)}
    </View>
    <Text style={styles.help}>{message(language, 'stepHelp')}</Text>
  </View>;
}

export function PageCreationStepActions({ language, step, hasPage, onChange }: {
  language: UiLanguage; step: PageCreationStep; hasPage: boolean; onChange: (step: PageCreationStep) => void;
}): React.JSX.Element {
  return <View style={styles.actions}>
    {step === 'design' ? null : <PrimaryButton label={message(language, 'previous')} onPress={() => onChange(step === 'create' ? 'settings' : 'design')} variant="ghost" testID="page-step-previous" />}
    {step === 'create' ? null : <PrimaryButton disabled={!hasPage} disabledReason={!hasPage ? message(language, 'noDesign') : undefined} label={message(language, step === 'design' ? 'nextSettings' : 'nextCreate')} onPress={() => onChange(step === 'design' ? 'settings' : 'create')} testID="page-step-next" />}
  </View>;
}
const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: spacing.md },
  content: { gap: spacing.sm }, hidden: { display: 'none' }, help: { ...textStyles.caption },
  label: { ...textStyles.caption, color: colors.inkStrong, fontWeight: '700', textAlign: 'center' },
  selectedLabel: { color: colors.primaryText }, selected: { backgroundColor: colors.primary },
  step: { minHeight: 44, minWidth: 92, flex: 1, justifyContent: 'center', borderRadius: radius.sm, borderColor: colors.controlBorder, borderWidth: 1, padding: spacing.sm },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }
});
