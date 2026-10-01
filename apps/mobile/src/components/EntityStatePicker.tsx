import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ResilientImage } from '@/components/ResilientImage';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { buildEntityReferenceImageSources } from '@/domain/entityImageSources';
import { buildStateImageSources, stateLabel, stateOptionSelectable } from '@/domain/entityStateEditor';
import { config } from '@/lib/config';
import { stateMessage } from '@/lib/entityStateMessages';
import { entityReferenceSetQueryKey, entityStatesQueryKey } from '@/lib/queryKeys';
import { useAppState } from '@/state/appState';

export interface EntityStatePickerProps {
  entityId: string;
  entityName: string;
  selectedStateId: string | null;
  onSelect: (stateId: string | null) => void;
  disabled?: boolean;
}

// Selection is an explicit state ID; the same entity is never duplicated. Missing
// and legacy selections stay visible, and no query or selection triggers generation.
export function EntityStatePicker({ entityId, entityName, selectedStateId, onSelect, disabled = false }: EntityStatePickerProps): React.JSX.Element {
  const { api, language, selection, sessionKey, tokens } = useAppState();
  const organizationId = selection.organizationId;
  const statesQuery = useQuery({ queryKey: entityStatesQueryKey(sessionKey, entityId, organizationId), queryFn: () => api.getEntityStates(entityId, organizationId) });
  const referenceQuery = useQuery({ queryKey: entityReferenceSetQueryKey(sessionKey, entityId, organizationId), queryFn: () => api.getEntityReferenceSet(entityId, organizationId) });
  const states = (statesQuery.data?.entity_states ?? []).filter((state) => state.entity_id === entityId);
  const missing = selectedStateId !== null && statesQuery.data !== undefined && !states.some((state) => state.id === selectedStateId);
  const authorizationHeader = tokens === null ? null : `Bearer ${tokens.idToken}`;
  const baseReference = referenceQuery.data?.reference_images.find((reference) => reference.ref_id === referenceQuery.data?.primary_ref_id);
  const baseSources = baseReference === undefined ? [] : buildEntityReferenceImageSources({
    apiBaseUrl: config.apiBaseUrl, authorizationHeader, entityId, organizationId, reference: baseReference,
    revision: referenceQuery.data?.updated_at ?? baseReference.created_at, sessionKey
  });
  return (
    <View style={styles.root}>
      <Text style={styles.label}>{stateMessage(language, 'title')}</Text>
      <Pressable accessibilityRole="radio" accessibilityLabel={`${entityName}・${stateMessage(language, 'default')}`} accessibilityState={{ checked: selectedStateId === null, disabled }} disabled={disabled} onPress={() => { if (!disabled) onSelect(null); }} style={[styles.option, selectedStateId === null ? styles.selected : null]}>
        {baseSources.length === 0 ? null : <ResilientImage accessibilityLabel={stateMessage(language, 'base')} contentFit="cover" sources={baseSources} style={styles.thumbnail} />}
        <Text style={styles.copy}>{entityName}・{stateMessage(language, 'default')}{selectedStateId === null ? ` ✓ ${stateMessage(language, 'selected')}` : ''}</Text>
      </Pressable>
      {states.map((state) => {
        const checked = state.id === selectedStateId;
        const unavailable = disabled || !stateOptionSelectable(state);
        const label = stateLabel(state, entityName, language);
        const status = state.reference_status ?? (state.name == null ? 'legacy' : 'draft');
        const sources = state.reference_status !== 'confirmed' || state.reference_image == null ? [] : buildStateImageSources({
          apiBaseUrl: config.apiBaseUrl, authorizationHeader, entityId, organizationId, sessionKey,
          stateId: state.id, revision: state.updated_at ?? state.created_at, referenceId: state.reference_image.ref_id, provenance: state.reference_image
        });
        return (
          <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityHint={unavailable && !disabled ? stateMessage(language, 'notReady') : undefined} accessibilityState={{ checked, disabled: unavailable }} disabled={unavailable} key={state.id} onPress={() => { if (!unavailable) onSelect(state.id); }} style={[styles.option, checked ? styles.selected : null]}>
            {sources.length === 0 ? null : <ResilientImage accessibilityLabel={label} contentFit="cover" sources={sources} style={styles.thumbnail} />}
            <View style={styles.text}>
              <Text style={styles.copy}>{label}{checked ? ` ✓ ${stateMessage(language, 'selected')}` : ''}</Text>
              <Text style={styles.caption}>{stateMessage(language, status)}</Text>
            </View>
          </Pressable>
        );
      })}
      {missing ? <Text style={styles.warning}>{stateMessage(language, 'missing')}</Text> : null}
      {statesQuery.error == null ? null : <Text style={styles.warning}>{stateMessage(language, 'error')}</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: spacing.sm }, label: { ...textStyles.sectionTitle },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: radius.sm, backgroundColor: colors.controlSurface },
  selected: { borderColor: colors.primary, borderWidth: 2 },
  text: { flex: 1 }, copy: { ...textStyles.body, flexShrink: 1 }, caption: { ...textStyles.caption },
  thumbnail: { width: 48, height: 48, borderRadius: radius.sm }, warning: { ...textStyles.caption, color: colors.warning }
});
