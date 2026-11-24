import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { GenerationBatch, GenerationBatchKind, GenerationBatchRenderStyle } from '../../../../packages/api-contract/src/generationBatch.ts';
import { acceptGenerationBatchWithReconciliation } from '../../../../packages/api-contract/src/generationBatch.ts';
import type { LyraApiClient } from '../lib/api';

interface Props {
  api: LyraApiClient;
  beforeQuote: () => Promise<void>;
  canGenerate: boolean;
  episodeId?: string | null;
  kind: GenerationBatchKind;
  language: 'ja' | 'en';
  onCompleted: () => Promise<void> | void;
  organizationId?: string | null;
  renderStyles: readonly GenerationBatchRenderStyle[];
  sessionKey: string;
  workId: string | null;
}

const activeStatuses = new Set<GenerationBatch['status']>(['running', 'paused', 'needs_review']);
const displayableStatuses = new Set<GenerationBatch['status']>([...activeStatuses, 'completed', 'cancelled']);
const requestKeyStorageKey = (batchId: string): string => `lyra:web:generation-batch:${batchId}:request-key`;

// A cancellation recovery can touch updated_at long after a batch started. The
// visible batch therefore follows user admission time, with stable fallbacks.
function compareBatchAdmission(left: GenerationBatch, right: GenerationBatch): number {
  const leftAdmission = left.accepted_at ?? left.created_at;
  const rightAdmission = right.accepted_at ?? right.created_at;
  return rightAdmission.localeCompare(leftAdmission)
    || right.created_at.localeCompare(left.created_at)
    || right.batch_id.localeCompare(left.batch_id);
}

const japaneseBatchStatus: Record<GenerationBatch['status'], string> = {
  quoted: '見積確認待ち',
  running: '生成中',
  paused: '一時停止',
  needs_review: '要確認',
  completed: '完了',
  cancelled: '停止済み',
};

const japaneseItemStatus: Record<GenerationBatch['items'][number]['status'], string> = {
  pending: '待機中',
  active: '生成中',
  confirming: '確定中',
  completed: '完了',
  skipped: '対象外',
  failed: '失敗',
  cancelled: '停止済み',
  needs_review: '要確認',
};

function batchStatusLabel(status: GenerationBatch['status'], language: Props['language']): string {
  return language === 'ja' ? japaneseBatchStatus[status] : status;
}

function itemStatusLabel(status: GenerationBatch['items'][number]['status'], language: Props['language']): string {
  return language === 'ja' ? japaneseItemStatus[status] : status;
}

export function GenerationBatchControls(props: Props): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const { onCompleted } = props;
  const [quoted, setQuoted] = useState<{ batch: GenerationBatch; requestKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const scope = `${props.sessionKey}:${props.organizationId ?? 'personal'}:${props.workId ?? 'none'}:${props.episodeId ?? 'none'}:${props.kind}`;
  const scopeRef = useRef(scope);
  const completedProgressRef = useRef(new Map<string, number>());
  const completionInFlightRef = useRef(new Set<string>());
  const [completionFailureKey, setCompletionFailureKey] = useState<string | null>(null);
  const [completionRetry, setCompletionRetry] = useState(0);
  const capability = useQuery({
    queryKey: ['generation-batch-capability', props.sessionKey, props.organizationId],
    queryFn: () => props.api.getGenerationBatchCapabilities(props.organizationId),
    enabled: props.workId !== null,
    staleTime: 60_000,
  });
  const batches = useQuery({
    queryKey: ['generation-batches', scope],
    queryFn: () => props.api.listGenerationBatches(props.workId ?? '', props.episodeId, props.organizationId),
    enabled: capability.data?.enabled === true && props.workId !== null,
    refetchInterval: (query) => (query.state.data ?? []).some((candidate) => candidate.status === 'running') ? 2_000 : false,
  });
  const batch = useMemo(() => [...(batches.data ?? [])]
    .filter((candidate) => candidate.kind === props.kind
      && candidate.work_id === props.workId
      && displayableStatuses.has(candidate.status))
    .sort(compareBatchAdmission)[0] ?? null, [batches.data, props.kind, props.workId]);

  useEffect(() => {
    scopeRef.current = scope;
    // A workspace switch invalidates a quote and its visible error atomically.
    completedProgressRef.current.clear();
    completionInFlightRef.current.clear();
    setCompletionFailureKey(null);
    setQuoted(null);
    setError(null);
  }, [scope]);
  useEffect(() => {
    if (batch === null || batch.progress.completed === 0) return;
    const notificationKey = `${scope}:${batch.batch_id}`;
    const notifiedCompleted = completedProgressRef.current.get(notificationKey) ?? 0;
    if (batch.progress.completed <= notifiedCompleted
      || completionInFlightRef.current.has(notificationKey)
      || completionFailureKey === notificationKey) return;

    // Design: the newest terminal batch remains visible, and every newly completed
    // child refreshes images once. A failed refresh is deliberately unacknowledged
    // so the user can retry it without creating a new batch or charging again.
    const origin = scope;
    const completed = batch.progress.completed;
    completionInFlightRef.current.add(notificationKey);
    void Promise.resolve()
      .then(() => onCompleted())
      .then(() => {
        if (scopeRef.current !== origin) return;
        completedProgressRef.current.set(notificationKey, completed);
        setCompletionFailureKey(null);
        if (batch.status === 'completed' || batch.status === 'cancelled') {
          window.localStorage.removeItem(requestKeyStorageKey(batch.batch_id));
        }
      })
      .catch((cause: unknown) => {
        if (scopeRef.current !== origin) return;
        setCompletionFailureKey(notificationKey);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        completionInFlightRef.current.delete(notificationKey);
      });
  }, [batch, completionFailureKey, completionRetry, onCompleted, scope]);

  if (capability.data?.enabled !== true || props.workId === null) return null;

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['generation-batches', scope] });
  };
  const accept = async (target: { batch: GenerationBatch; requestKey: string }, origin: string): Promise<void> => {
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const accepted = await acceptGenerationBatchWithReconciliation({
        accept: (id, request) => props.api.acceptGenerationBatch(id, request, props.organizationId),
        get: (id) => props.api.getGenerationBatch(id, props.organizationId),
      }, target.batch, target.requestKey);
      if (scopeRef.current !== origin) return;
      setQuoted(null);
      queryClient.setQueryData<GenerationBatch[]>(['generation-batches', scope], (current = []) => [accepted, ...current.filter((item) => item.batch_id !== accepted.batch_id)]);
      await refresh();
    } catch (cause) {
      if (scopeRef.current === origin) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      if (scopeRef.current === origin) setBusy(false);
    }
  };
  const quote = async (renderStyle: GenerationBatchRenderStyle): Promise<void> => {
    if (busyRef.current || quoted !== null || props.workId === null || !props.canGenerate) return;
    const origin = scope;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await props.beforeQuote();
      if (scopeRef.current !== origin) return;
      const result = await props.api.createGenerationBatchQuote({
        work_id: props.workId,
        kind: props.kind,
        ...(props.kind === 'pages' && props.episodeId !== null && props.episodeId !== undefined ? { episode_id: props.episodeId } : {}),
        selection: 'missing_only', render_style: renderStyle,
      }, props.organizationId);
      if (scopeRef.current !== origin) return;
      const target = { batch: result, requestKey: crypto.randomUUID() };
      window.localStorage.setItem(requestKeyStorageKey(result.batch_id), target.requestKey);
      setQuoted(target);
      const autoConfirm = props.kind === 'character_references'
        ? (props.language === 'ja' ? 'キャラクター本体と状態変化の画像は生成後に自動確定されます。' : 'Character base and state images will be confirmed automatically.')
        : (props.language === 'ja' ? '未生成ページのみを生成します。' : 'Only pages without generated images will be generated.');
      const labels = result.items.map((item) => `• ${item.label}`).join('\n');
      const confirmed = window.confirm(`${result.items.length}${props.language === 'ja' ? '件' : ' items'} / ${props.language === 'ja' ? '最大' : 'up to'} ${result.maximum_credits} credits\n${autoConfirm}\n\n${labels}`);
      if (!confirmed) { setQuoted(null); window.localStorage.removeItem(requestKeyStorageKey(result.batch_id)); return; }
      await accept(target, origin);
    } catch (cause) {
      if (scopeRef.current === origin) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      if (scopeRef.current === origin) setBusy(false);
    }
  };
  const cancel = async (): Promise<void> => {
    if (batch === null || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await props.api.cancelGenerationBatch(batch.batch_id, props.organizationId); window.localStorage.removeItem(requestKeyStorageKey(batch.batch_id)); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const resume = async (): Promise<void> => {
    if (batch === null || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const requestKey = window.localStorage.getItem(requestKeyStorageKey(batch.batch_id));
      if (requestKey === null) throw new Error(props.language === 'ja' ? 'このブラウザでは再開キーを確認できません。新しい一括生成を見積もってください。' : 'The resume key is unavailable in this browser. Request a new batch quote.');
      await props.api.resumeGenerationBatch(batch.batch_id, { request_key: requestKey }, props.organizationId);
      await refresh();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <div className="batch-generation" data-testid={`generation-batch-${props.kind}`}>
    <div className="toolbar batch-generation-actions">
      {props.renderStyles.map((style) => <button className="secondary-button" key={style} type="button" disabled={!props.canGenerate || busy || quoted !== null || batch?.status === 'running'} onClick={() => { void quote(style); }}>
        {props.kind === 'character_references'
          ? (props.language === 'ja' ? '未確定キャラ・状態変化を一括生成して確定' : 'Generate and confirm missing character images')
          : style === 'color'
            ? (props.language === 'ja' ? '未生成の画像を一括生成（カラー）' : 'Generate missing pages (color)')
            : (props.language === 'ja' ? '未生成の画像を一括生成（モノクロ）' : 'Generate missing pages (monochrome)')}
      </button>)}
    </div>
    {batch === null ? null : <div className="notice info batch-generation-status">
      <p><strong>{props.language === 'ja' ? '一括生成' : 'Batch'}: {batchStatusLabel(batch.status, props.language)}</strong> · {batch.progress.completed + batch.progress.skipped}/{batch.progress.total}</p>
      {batch.items.filter((item) => item.status === 'failed' || item.status === 'needs_review').map((item) => <p key={item.item_id} className="batch-generation-item-error">• {item.label}: {itemStatusLabel(item.status, props.language)}</p>)}
      <div className="toolbar batch-generation-status-actions">
        {batch.status === 'paused' ? <button className="secondary-button" type="button" disabled={busy} onClick={() => { void resume(); }}>{props.language === 'ja' ? '再開' : 'Resume'}</button> : null}
        {batch.status === 'running' ? <button className="ghost-button danger" type="button" disabled={busy} onClick={() => { void cancel(); }}>{props.language === 'ja' ? '停止' : 'Stop'}</button> : null}
      </div>
    </div>}
    {error === null ? null : <div className="notice error batch-generation-error" role="alert">
      <p>{error}</p>
      {quoted === null ? null : <button className="secondary-button" type="button" disabled={busy} onClick={() => { void accept(quoted, scope); }}>
        {props.language === 'ja' ? '開始結果を再確認' : 'Check start result again'}
      </button>}
      {quoted === null && completionFailureKey !== null ? <button className="secondary-button" type="button" disabled={busy} onClick={() => {
        setCompletionFailureKey(null);
        setError(null);
        setCompletionRetry((value) => value + 1);
      }}>
        {props.language === 'ja' ? '生成済み画像を再読込' : 'Refresh generated images'}
      </button> : null}
    </div>}
  </div>;
}
