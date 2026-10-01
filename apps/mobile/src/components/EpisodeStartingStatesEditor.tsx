import { StyleSheet, Text, View } from 'react-native';

import { EntityStatePicker } from '@/components/EntityStatePicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RecordPicker } from '@/components/RecordPicker';
import { Section } from '@/components/Section';
import { addStartingEntityState, MAX_EPISODE_STARTING_STATES, type EpisodeStartingState } from '@/domain/episodeStartingStates';
import type { EntityRecord, UiLanguage } from '@/domain/types';
import { colors, spacing, textStyles } from '@/constants/theme';
import { episodeStateMessage as message } from '@/lib/episodeStateMessages';

interface EpisodeStartingStatesEditorProps {
  language: UiLanguage;
  entities: EntityRecord[];
  value: EpisodeStartingState[];
  onChange: (value: EpisodeStartingState[]) => void;
  disabled?: boolean;
  hasMoreEntities?: boolean;
  loadingEntities?: boolean;
  onLoadMoreEntities?: () => void;
}

// Controlled input only. Opening/changing this UI never saves, generates an
// image, or silently drops a saved assignment absent from the current page.
export function EpisodeStartingStatesEditor({ language, entities, value, onChange, disabled = false, hasMoreEntities, loadingEntities, onLoadMoreEntities }: EpisodeStartingStatesEditorProps): React.JSX.Element {
  const availableEntities = entities.filter((entity) => !value.some((state) => state.entity_id === entity.id));
  return (
    <Section collapsible defaultCollapsed persistKey="story:starting-states" title={message(language, 'startingTitle')}>
      <Text style={styles.help}>{message(language, 'startingHelp')}</Text>
      {value.length === 0 ? <Text style={styles.help}>{message(language, 'startingEmpty')}</Text> : null}
      {value.map((state, index) => {
        const entity = entities.find((item) => item.id === state.entity_id);
        return (
          <View key={`${state.entity_id}:${index}`} style={styles.row}>
            {entity === undefined ? <Text style={styles.help}>{message(language, 'startingUnknown')}</Text> : (
              <EntityStatePicker entityId={entity.id} entityName={entity.name} selectedStateId={state.state_id} disabled={disabled} onSelect={(stateId) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, state_id: stateId } : item))} />
            )}
            <PrimaryButton disabled={disabled} label={message(language, 'startingRemove')} onPress={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} variant="ghost" testID={`starting-state-remove-${index}`} />
          </View>
        );
      })}
      {disabled ? <Text style={styles.help}>{message(language, 'startingUnavailable')}</Text> : value.length >= MAX_EPISODE_STARTING_STATES ? <Text style={styles.help}>{message(language, 'startingLimit')}</Text> : (
        <>
          <Text style={styles.label}>{message(language, 'startingAdd')}</Text>
          <RecordPicker
            emptyLabel={message(language, 'startingEmpty')}
            items={availableEntities}
            selectedId={null}
            language={language}
            labelForItem={(entity) => entity.name}
            onSelect={(entityId) => {
              if (availableEntities.some((entity) => entity.id === entityId)) onChange(addStartingEntityState(value, entityId));
            }}
            hasNextPage={hasMoreEntities}
            isFetchingNextPage={loadingEntities}
            onEndReached={onLoadMoreEntities}
          />
        </>
      )}
      <PrimaryButton disabled={disabled} label={message(language, 'startingReset')} onPress={() => onChange([])} variant="secondary" testID="starting-state-reset" />
    </Section>
  );
}

const styles = StyleSheet.create({
  help: { ...textStyles.body, color: colors.muted },
  label: { ...textStyles.sectionTitle },
  row: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }
});
