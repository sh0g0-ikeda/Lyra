import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { GenerationBatch, GenerationBatchKind, GenerationBatchRenderStyle } from '@/domain/generationBatchContract';
import { acceptGenerationBatchWithReconciliation } from '@/domain/generationBatchContract';
import type { LyraMobileApiClient } from '@/lib/api';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Notice } from '@/components/Notice';
import { colors, spacing } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import { t } from '@/lib/i18n';

interface GenerationBatchControlsProps {
  api: LyraMobileApiClient;
  beforeQuote: () => Promise<boolean>;
  canGenerate: boolean;
  episodeId?: string | null;
  kind: GenerationBatchKind;
  language: UiLanguage;
  onCompleted: () => Promise<void> | void;
  organizationId?: string | null;
  renderStyles: readonly GenerationBatchRenderStyle[];
  sessionKey: string;
  workId: string | null;
}

const activeStatuses = new Set<GenerationBatch['status']>(['running', 'paused', 'needs_review']);
const requestKeyStorageKey = (batchId: string): string => `lyra.mobile.generation-batch.${batchId}.request-key`;

function newestRelevantBatch(batches: readonly GenerationBatch[], kind: GenerationBatchKind): GenerationBatch | null {
  return [...batches]
    .filter((batch) => batch.kind === kind && (activeStatuses.has(batch.status) || batch.status === 'completed'))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null;
}

export function GenerationBatchControls(props: GenerationBatchControlsProps): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const [quoted, setQuoted] = useState<{ batch: GenerationBatch; requestKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const scope = `${props.sessionKey}:${props.organizationId ?? 'personal'}:${props.workId ?? 'none'}:${props.episodeId ?? 'none'}:${props.kind}`;
  const scopeRef = useRef(scope);
  const completedRef = useRef(new Set<string>());

  const capabilityQuery = useQuery({
    queryKey: ['generation-batch-capability', props.sessionKey, props.organizationId],
    queryFn: () => props.api.getGenerationBatchCapabilities(props.organizationId),
    enabled: props.workId !== null,
    staleTime: 60_000,
  });
  const batchesQuery = useQuery({
    queryKey: ['generation-batches', scope],
    queryFn: () => props.api.listGenerationBatches(props.workId ?? '', props.episodeId, props.organizationId),
    enabled: capabilityQuery.data?.enabled === true && props.workId !== null,
    refetchInterval: (query) => {
      const batches = query.state.data ?? [];
      return batches.some((batch) => batch.status === 'running') ? 2_000 : false;
    },
  });
  const batch = useMemo(() => newestRelevantBatch(batchesQuery.data ?? [], props.kind), [batchesQuery.data, props.kind]);

  useEffect(() => {
    scopeRef.current = scope;
    // A workspace switch invalidates a quote and its visible error atomically.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuoted(null);
    setError(null);
  }, [scope]);

  useEffect(() => {
    if (batch?.status !== 'completed' || completedRef.current.has(batch.batch_id)) return;
    completedRef.current.add(batch.batch_id);
    void SecureStore.deleteItemAsync(requestKeyStorageKey(batch.batch_id));
    void props.onCompleted();
  }, [batch, props]);

  if (capabilityQuery.data?.enabled !== true || props.workId === null) return null;

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['generation-batches', scope] });
  };
  const acceptQuote = async (target: { batch: GenerationBatch; requestKey: string }, originScope: string): Promise<void> => {
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const accepted = await acceptGenerationBatchWithReconciliation({
        accept: (batchId, request) => props.api.acceptGenerationBatch(batchId, request, props.organizationId),
        get: (batchId) => props.api.getGenerationBatch(batchId, props.organizationId),
      }, target.batch, target.requestKey);
      if (scopeRef.current !== originScope) return;
      setQuoted(null);
      queryClient.setQueryData<GenerationBatch[]>(['generation-batches', scope], (current = []) => [
        accepted,
        ...current.filter((candidate) => candidate.batch_id !== accepted.batch_id),
      ]);
      await invalidate();
    } catch (cause) {
      if (scopeRef.current === originScope) {
        setError(cause instanceof Error ? cause.message : t(props.language, 'shared.generationBatch.acceptUnknown'));
      }
    } finally {
      busyRef.current = false;
      if (scopeRef.current === originScope) setBusy(false);
    }
  };
  const quote = async (renderStyle: GenerationBatchRenderStyle): Promise<void> => {
    if (busyRef.current || quoted !== null || props.workId === null || !props.canGenerate) return;
    const originScope = scope;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!await props.beforeQuote() || scopeRef.current !== originScope) return;
      const result = await props.api.createGenerationBatchQuote({
        work_id: props.workId,
        kind: props.kind,
        ...(props.kind === 'pages' && props.episodeId !== null && props.episodeId !== undefined ? { episode_id: props.episodeId } : {}),
        selection: 'missing_only',
        render_style: renderStyle,
      }, props.organizationId);
      if (scopeRef.current !== originScope) return;
      const target = { batch: result, requestKey: Crypto.randomUUID() };
      await SecureStore.setItemAsync(requestKeyStorageKey(result.batch_id), target.requestKey);
      setQuoted(target);
      const labels = result.items.map((item) => `• ${item.label}`).join('\n');
      const autoConfirm = props.kind === 'character_references'
        ? t(props.language, 'shared.generationBatch.characterAutoConfirm')
        : t(props.language, 'shared.generationBatch.pagesMissingOnly');
      Alert.alert(
        t(props.language, 'shared.generationBatch.confirmTitle'),
        `${t(props.language, 'shared.generationBatch.confirmSummary', { count: result.items.length, credits: result.maximum_credits })}\n${autoConfirm}\n\n${labels}`,
        [
          { text: t(props.language, 'shared.generationBatch.cancel'), style: 'cancel', onPress: () => {
            setQuoted(null);
            void SecureStore.deleteItemAsync(requestKeyStorageKey(result.batch_id));
          } },
          { text: t(props.language, 'shared.generationBatch.start'), onPress: () => { void acceptQuote(target, originScope); } },
        ],
      );
    } catch (cause) {
      if (scopeRef.current === originScope) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      if (scopeRef.current === originScope) setBusy(false);
    }
  };
  const cancel = async (): Promise<void> => {
    if (batch === null || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await props.api.cancelGenerationBatch(batch.batch_id, props.organizationId);
      await SecureStore.deleteItemAsync(requestKeyStorageKey(batch.batch_id));
      await invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { busyRef.current = false; setBusy(false); }
  };
  const resume = async (): Promise<void> => {
    if (batch === null || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const requestKey = await SecureStore.getItemAsync(requestKeyStorageKey(batch.batch_id));
      if (requestKey === null) {
        throw new Error(t(props.language, 'shared.generationBatch.resumeKeyMissing'));
      }
      await props.api.resumeGenerationBatch(batch.batch_id, { request_key: requestKey }, props.organizationId);
      await invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <View style={styles.container} testID={`generation-batch-${props.kind}`}>
      <View style={styles.buttons}>
        {props.renderStyles.map((style) => (
          <PrimaryButton
            key={style}
            disabled={!props.canGenerate || batch?.status === 'running' || quoted !== null}
            label={props.kind === 'character_references'
              ? t(props.language, 'shared.generationBatch.charactersAction')
              : style === 'color'
                ? t(props.language, 'shared.generationBatch.pagesColorAction')
                : t(props.language, 'shared.generationBatch.pagesMonochromeAction')}
            loading={busy}
            onPress={() => { void quote(style); }}
            variant="secondary"
          />
        ))}
      </View>
      {batch !== null ? (
        <View style={styles.status}>
          <Text style={styles.statusText}>{t(props.language, 'shared.generationBatch.status')}: {batch.status} · {batch.progress.completed + batch.progress.skipped}/{batch.progress.total}</Text>
          {batch.items.filter((item) => item.status === 'failed' || item.status === 'needs_review').map((item) => (
            <Text key={item.item_id} style={styles.failure}>• {item.label}: {item.status}</Text>
          ))}
          {batch.status === 'paused' ? <PrimaryButton compact label={t(props.language, 'shared.generationBatch.resume')} onPress={() => { void resume(); }} /> : null}
          {batch.status === 'running' ? <PrimaryButton compact label={t(props.language, 'shared.generationBatch.stop')} onPress={() => { void cancel(); }} variant="danger" /> : null}
        </View>
      ) : null}
      {error === null ? null : <Notice
        actionLabel={quoted === null ? undefined : t(props.language, 'shared.generationBatch.checkAgain')}
        message={error}
        onAction={quoted === null ? undefined : () => { void acceptQuote(quoted, scope); }}
        tone="danger"
      />}
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: spacing.sm },
  container: { gap: spacing.sm },
  failure: { color: colors.danger, fontSize: 12 },
  status: { gap: spacing.xs },
  statusText: { color: colors.muted, fontSize: 13 },
});
