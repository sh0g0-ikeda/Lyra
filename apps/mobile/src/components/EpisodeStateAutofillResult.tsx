import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { EntityStatePicker } from '@/components/EntityStatePicker';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, spacing, textStyles } from '@/constants/theme';
import { readEpisodeStateResult } from '@/domain/episodeStateAutofillPolicy';
import type { EntityRecord } from '@/domain/types';
import { episodeStateMessage as message } from '@/lib/episodeStateMessages';
import { jobQueryKey } from '@/lib/queryKeys';
import { useAppState } from '@/state/appState';
import { useMangaWorkflow } from '@/state/mangaWorkflow';

interface EpisodeStateAutofillResultProps {
  jobId: string | null;
  episodeId: string | null;
  entities: EntityRecord[];
  canEdit: boolean;
}

export function EpisodeStateAutofillResult({ jobId, episodeId, entities, canEdit }: EpisodeStateAutofillResultProps): React.JSX.Element | null {
  const { api, language, selection, sessionKey } = useAppState();
  const workflow = useMangaWorkflow();
  const [transitionPage, setTransitionPage] = useState<{ jobId: string; count: number } | null>(null);
  const [failedCandidate, setFailedCandidate] = useState<string | null>(null);
  const query = useQuery({
    enabled: jobId !== null,
    queryKey: jobQueryKey(sessionKey, jobId, selection.organizationId),
    queryFn: () => api.getJob(jobId ?? '', selection.organizationId),
    // JobStatusCard is the existing polling owner for this same query key.
    staleTime: Infinity
  });
  const job = query.data;
  if (job?.job_type !== 'episode_story_autofill' || job.params.episode_id !== episodeId) return null;
  const result = readEpisodeStateResult(job.result);
  const blocker = job.status === 'failed' ? result.blocker : null;
  const transitions = job.status === 'completed' ? result.transitions : [];
  const visibleTransitions = transitionPage?.jobId === job.id ? transitionPage.count : 20;
  if (blocker === null && transitions.length === 0) return null;
  return (
    <View style={styles.root} testID="state-autofill-result">
      {blocker === null ? null : (
        <>
          <Text style={styles.title}>{message(language, 'blockerTitle')}</Text>
          <Text style={styles.help}>{message(language, blocker.code === 'STATE_ASSIGNMENT_CONFLICT' ? 'conflict' : blocker.candidates.length === 0 ? 'invalid' : 'blockerHelp')}</Text>
          {blocker.candidates.map((candidate, index) => {
            const entity = entities.find((item) => item.id === candidate.entity_id);
            return (
              <View key={`${candidate.entity_id}:${index}`} style={styles.candidate}>
                <Text style={styles.title}>{entity?.name ?? message(language, 'startingUnknown')} / {candidate.suggested_name}</Text>
                <Text style={styles.help}>{candidate.suggested_description}</Text>
                <Text style={styles.help}>{message(language, 'candidateEvidence')}: {candidate.source_quote}</Text>
                {failedCandidate === `${job.id}:${index}` ? <Notice tone="warning" message={message(language, 'candidateUnavailable')} /> : null}
                <PrimaryButton
                  disabled={!canEdit || workflow === null}
                  label={message(language, 'openCandidate')}
                  onPress={() => {
                    setFailedCandidate(null);
                    void workflow?.requestStateCandidate({ entityId: candidate.entity_id, name: candidate.suggested_name, description: candidate.suggested_description, stateId: candidate.candidate_state_id }).catch(() => setFailedCandidate(`${job.id}:${index}`));
                  }}
                  testID={`state-blocker-candidate-${index}`}
                  variant="secondary"
                />
              </View>
            );
          })}
        </>
      )}
      {transitions.length === 0 ? null : (
        <>
          <Text style={styles.title}>{message(language, 'transitionsTitle')}</Text>
          {transitions.slice(0, visibleTransitions).map((transition, index) => {
            const entity = entities.find((item) => item.id === transition.entity_id);
            return (
              <View key={`${transition.starts_at_panel_id}:${transition.entity_id}:${index}`} style={styles.candidate}>
                <Text style={styles.help}>{message(language, 'candidateEvidence')}: {transition.source_quote}</Text>
                {entity === undefined ? <Text style={styles.help}>{message(language, 'startingUnknown')}</Text> : <EntityStatePicker entityId={entity.id} entityName={entity.name} selectedStateId={transition.state_id} disabled onSelect={() => undefined} />}
              </View>
            );
          })}
          {transitions.length > visibleTransitions ? <PrimaryButton label={message(language, 'moreTransitions')} onPress={() => setTransitionPage({ jobId: job.id, count: visibleTransitions + 20 })} variant="secondary" /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  candidate: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  help: { ...textStyles.body },
  root: { gap: spacing.sm },
  title: { ...textStyles.sectionTitle }
});
