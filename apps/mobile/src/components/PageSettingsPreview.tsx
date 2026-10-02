import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, textStyles } from '@/constants/theme';
import type { EntityRecord, PanelRecord, UiLanguage } from '@/domain/types';
import { pageWorkflowMessage as message } from '@/lib/pageWorkflowMessages';

export function PageSettingsPreview({ language, panels, entities, pageNumber }: { language: UiLanguage; panels: readonly PanelRecord[]; entities: readonly EntityRecord[]; pageNumber: number | null }): React.JSX.Element {
  return <View style={styles.root} testID="page-settings-preview">
    <Text style={styles.title}>{message(language, 'currentSettings')}{pageNumber === null ? '' : ` · ${message(language, 'page', { number: pageNumber })}`}</Text>
    {pageNumber === null ? <Text style={styles.copy}>{message(language, 'noSettings')}</Text> : panels.length === 0 ? <Text style={styles.copy}>{message(language, 'noPanel')}</Text> : panels.map((panel) => <View key={panel.id} style={styles.panel}>
      <Text style={styles.title}>{message(language, 'panel', { number: panel.order })}</Text>
      <Text style={styles.copy}>{panel.situation_text?.trim() || message(language, 'unset')}</Text>
      <Text style={styles.copy}>{panel.background_note?.trim() || message(language, 'unset')}</Text>
      <Text style={styles.copy}>{message(language, 'panelSummary', { entities: panel.entities.length, dialogues: panel.dialogue.length })}</Text>
      {panel.entities.length === 0 ? null : <Text style={styles.copy}>{panel.entities.map((assignment) => entities.find((entity) => entity.id === assignment.entity_id)?.name ?? message(language, 'unset')).join(' / ')}</Text>}
    </View>)}
  </View>;
}
const styles = StyleSheet.create({ root: { gap: spacing.sm }, title: { ...textStyles.sectionTitle }, copy: { ...textStyles.body }, panel: { gap: spacing.xs, borderColor: colors.border, borderWidth: 1, padding: spacing.sm } });
