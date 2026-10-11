import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import {
  workDeletionBlockerMessage,
  workDeletionMessage,
  type WorkDeletionRecord
} from '@/domain/workDeletion';
import type { UiLanguage } from '@/domain/types';
import type { LyraMobileApiClient } from '@/lib/api';
import { operationErrorMessage } from '@/lib/operationErrorContext';

type WorkDeletionStatusApi = Pick<LyraMobileApiClient, 'getWorkDeletion' | 'getWorkDeletions'>;

interface WorkDeletionStatusListProps {
  api: WorkDeletionStatusApi;
  language: UiLanguage;
  organizationId: string | null;
  sessionKey: string;
}

const statusMessage = (record: WorkDeletionRecord, language: UiLanguage): string => {
  if (record.status === 'completed') return workDeletionMessage(language, 'completed');
  if (record.status === 'processing') return workDeletionMessage(language, 'processing');
  if (record.status === 'pending_external_action') return workDeletionBlockerMessage(language, record.blocker_code);
  return workDeletionMessage(language, 'pending');
};

function WorkDeletionStatusItem({
  api,
  language,
  organizationId,
  receipt,
  sessionKey
}: WorkDeletionStatusListProps & { receipt: WorkDeletionRecord }): React.JSX.Element {
  const statusQuery = useQuery({
    enabled: receipt.status !== 'completed',
    initialData: receipt,
    queryFn: () => api.getWorkDeletion(receipt.deletion_id, organizationId),
    queryKey: ['work-deletion', sessionKey, organizationId ?? 'personal', receipt.deletion_id],
    refetchInterval: (query) => query.state.data?.status === 'completed' ? false : 5_000,
    retry: false
  });
  const current = receipt.status === 'completed' ? receipt : statusQuery.data ?? receipt;
  return (
    <View style={styles.card} testID={`work-deletion-${receipt.deletion_id}`}>
      <Text style={styles.id}>{workDeletionMessage(language, 'workId', { workId: receipt.work_id })}</Text>
      <Text style={current.status === 'completed' ? styles.completed : styles.status}>{statusMessage(current, language)}</Text>
      {statusQuery.error === null ? null : (
        <>
          <Notice
            message={`${workDeletionMessage(language, 'statusUnavailable')}\n${operationErrorMessage(statusQuery.error, { operation: 'loadWorkDeletions' }, language)}`}
            tone="warning"
          />
          <PrimaryButton
            label={workDeletionMessage(language, 'refresh')}
            loading={statusQuery.isFetching}
            onPress={() => { void statusQuery.refetch(); }}
            variant="secondary"
          />
        </>
      )}
    </View>
  );
}

export function WorkDeletionStatusList(props: WorkDeletionStatusListProps): React.JSX.Element | null {
  const deletionsQuery = useQuery({
    queryFn: () => props.api.getWorkDeletions(props.organizationId),
    queryKey: ['work-deletions', props.sessionKey, props.organizationId ?? 'personal'],
    refetchInterval: 15_000,
    retry: false
  });
  const deletions = deletionsQuery.data?.deletions ?? [];
  if (deletions.length === 0 && deletionsQuery.error === null) return null;
  return (
    <View style={styles.list} testID="work-deletion-status-list">
      <Text style={styles.heading}>{workDeletionMessage(props.language, 'heading')}</Text>
      {deletions.map((receipt) => (
        <WorkDeletionStatusItem key={receipt.deletion_id} {...props} receipt={receipt} />
      ))}
      {deletionsQuery.error === null ? null : (
        <>
          <Notice message={operationErrorMessage(deletionsQuery.error, { operation: 'loadWorkDeletions' }, props.language)} tone="warning" />
          <PrimaryButton
            label={workDeletionMessage(props.language, 'refresh')}
            loading={deletionsQuery.isFetching}
            onPress={() => { void deletionsQuery.refetch(); }}
            variant="secondary"
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.controlBorder, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  completed: { ...textStyles.body, color: colors.success, fontWeight: '700' },
  heading: { ...textStyles.sectionTitle, color: colors.inkStrong },
  id: { ...textStyles.caption, color: colors.muted },
  list: { gap: spacing.md },
  status: { ...textStyles.body, color: colors.ink }
});
