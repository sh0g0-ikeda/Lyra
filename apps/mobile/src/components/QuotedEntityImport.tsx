import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AssetGenerationQuoteDialog } from '@/components/AssetGenerationQuoteDialog';
import { EntityReferenceUploadStatus } from '@/components/EntityReferenceUploadStatus';
import { JobStatusCard } from '@/components/JobStatusCard';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { textStyles } from '@/constants/theme';
import { entityImportResponseSchema } from '@/domain/apiSchemas';
import type { EntityType } from '@/domain/types';
import type { EntityReferenceUploadMimeType } from '@/domain/payloads';
import { useAssetGenerationQuote } from '@/hooks/useAssetGenerationQuote';
import type { LyraMobileApiClient } from '@/lib/api';
import { assetQuoteMessages } from '@/lib/assetQuoteMessages';
import { appendAiProviderDisclosure } from '@/lib/aiProviderDisclosure';
import { confirmAction } from '@/lib/confirm';
import { DirectEntityUploadError, uploadAndImportEntityReference, type BinaryUploadSource, type DirectEntityUploadStage } from '@/lib/directEntityReferenceUpload';
import { createExpoBinaryUploadFile } from '@/lib/expoBinaryUpload';
import { jobQueryKey } from '@/lib/queryKeys';
import { useAppState } from '@/state/appState';
export type ImportedEntityDetails = Awaited<ReturnType<LyraMobileApiClient['importEntityImage']>>;
interface Props { entityId: string | null; entityType: EntityType; entityName: string; workId: string | null; draftRevision: string; parentBusy?: boolean; onApply: (result: ImportedEntityDetails, expectedRevision: string) => void; onBusyChange: (busy: boolean) => void; }
interface Upload { source: BinaryUploadSource; mimeType: EntityReferenceUploadMimeType; sizeBytes: number; token: string | null; scope: string; revision: string; }
function mimeType(asset: ImagePicker.ImagePickerAsset): EntityReferenceUploadMimeType | null {
  if (asset.mimeType === 'image/png' || asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/webp') return asset.mimeType;
  const source = `${asset.uri} ${asset.fileName ?? ''}`.toLowerCase();
  return /\.png\b/u.test(source) ? 'image/png' : /\.webp\b/u.test(source) ? 'image/webp' : /\.jpe?g\b/u.test(source) ? 'image/jpeg' : null;
}
// Uploading only obtains a server-owned source token. Analysis begins through
// quote acceptance, and its result never writes the editor without confirmation.
export function QuotedEntityImport(props: Props): React.JSX.Element {
  const { api, language, session, sessionKey, selection, hasCapability, trackJob } = useAppState();
  const organizationId = selection.organizationId;
  const scope = JSON.stringify([sessionKey, organizationId, props.workId, props.entityId, props.entityType]);
  const enabled = session?.capabilities?.generation_quotes === true && hasCapability('generate') && props.workId !== null;
  const copy = assetQuoteMessages(language);
  const queryClient = useQueryClient();
  const [upload, setUpload] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<DirectEntityUploadStage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [job, setJob] = useState<{ id: string; scope: string; revision: string } | null>(null);
  const [appliedJobId, setAppliedJobId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lock = useRef(false); const alive = useRef(true);
  const current = useRef({ scope, revision: props.draftRevision, enabled });
  useLayoutEffect(() => { current.current = { scope, revision: props.draftRevision, enabled }; }, [scope, props.draftRevision, enabled]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); }; }, []);
  useEffect(() => { abort.current?.abort(); }, [scope]);
  const quote = useAssetGenerationQuote({
    api, contextKey: scope, organizationId, enabled,
    onAccepted: async (receipt, target, originKey) => {
      if (receipt.job_id === null || !alive.current || current.current.scope !== originKey) return;
      setJob({ id: receipt.job_id, scope: originKey, revision: target.revision }); setUpload(null); setAppliedJobId(null);
      await trackJob(receipt.job_id).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ['session', sessionKey] });
    }
  });
  const jobId = job?.scope === scope ? job.id : null;
  const jobQuery = useQuery({ queryKey: jobQueryKey(sessionKey, jobId, organizationId), enabled: jobId !== null, queryFn: () => api.getJob(jobId ?? '', organizationId), refetchInterval: (query) => query.state.data?.status === 'queued' || query.state.data?.status === 'processing' ? 2500 : false });
  const importJob = jobQuery.data?.id === jobId && jobQuery.data?.job_type === 'entity_import_analysis' && (jobQuery.data.params.entity_id ?? null) === props.entityId && jobQuery.data.params.entity_type === props.entityType ? jobQuery.data : null;
  const parsedResult = entityImportResponseSchema.safeParse(importJob?.status === 'completed' ? importJob.result : null);
  const result = parsedResult.success ? parsedResult.data : null;
  const activeJob = jobId !== null && (jobQuery.data === undefined || importJob?.status === 'queued' || importJob?.status === 'processing');
  const acceptancePending = quote.state.phase === 'unknown' || quote.state.phase === 'accepting';
  const busy = uploading || activeJob || acceptancePending;
  const onBusyChange = props.onBusyChange;
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  const openQuote = async (item: Upload): Promise<void> => {
    if (item.token === null || item.scope !== current.current.scope || !alive.current) return;
    await quote.controller.open({ label: props.entityName.trim() || copy.entity_import_analysis, revision: item.revision,
      request: { operation: 'entity_import_analysis', upload_token: item.token, entity_type: props.entityType, ...(props.entityId === null ? {} : { entity_id: props.entityId }) } });
  };
  const startUpload = async (retry: boolean): Promise<void> => {
    if (lock.current || !enabled || props.parentBusy || activeJob || acceptancePending) return;
    lock.current = true; setUploading(true); setError(null);
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const origin = scope;
    try {
      let item = retry && upload?.scope === origin ? upload : null;
      if (item === null) {
        const chosen = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, base64: false, mediaTypes: ['images'], quality: 1 });
        if (chosen.canceled || !alive.current || current.current.scope !== origin) return;
        const asset = chosen.assets[0]; const kind = asset === undefined ? null : mimeType(asset);
        if (asset === undefined || kind === null) throw new Error('INVALID_IMAGE');
        const file = createExpoBinaryUploadFile(asset.uri);
        if (!file.exists || file.sizeBytes <= 0 || file.sizeBytes > 5 * 1024 * 1024) throw new Error('INVALID_IMAGE');
        item = { source: file.source, mimeType: kind, sizeBytes: file.sizeBytes, token: null, scope: origin, revision: current.current.revision };
        setUpload(item);
      }
      const pending = item; setProgress(0);
      const token = await uploadAndImportEntityReference({
        source: pending.source, mimeType: pending.mimeType, sizeBytes: pending.sizeBytes, entityType: props.entityType, entityId: props.entityId,
        resumeFinalizeToken: pending.token, signal: controller.signal,
        createPresignedUpload: (body) => api.createEntityReferenceUpload(body, organizationId),
        finalizeImport: async (uploadToken) => uploadToken,
        onFinalizeTokenReady: (uploadToken) => { if (alive.current && current.current.scope === origin) setUpload({ ...pending, token: uploadToken }); },
        onProgress: (value) => { if (alive.current && current.current.scope === origin) setProgress(value); },
        onStageChange: (value) => { if (alive.current && current.current.scope === origin) setStage(value === 'finalize' ? null : value); }
      });
      if (!alive.current || current.current.scope !== origin || controller.signal.aborted) return;
      const completed = { ...pending, token }; setUpload(completed); setStage(null);
      await openQuote(completed);
    } catch (cause) { if (alive.current && current.current.scope === origin) setError(cause); }
    finally { lock.current = false; if (abort.current === controller) abort.current = null; if (alive.current) setUploading(false); }
  };
  const requestUpload = (): void => confirmAction({ language, title: copy.reviewImport, message: appendAiProviderDisclosure(copy.imageType, language, 'image'), confirmLabel: copy.reviewImport, onConfirm: () => { void startUpload(false); } });
  const apply = (): void => {
    if (result === null || jobId === null || job?.scope !== scope) return;
    const revision = current.current.revision; const id = jobId;
    confirmAction({ language, title: copy.applyTitle, message: `${job.revision === revision ? '' : `${copy.changedDraft}\n\n`}${copy.applyBody}`, confirmLabel: copy.applyConfirm,
      onConfirm: () => { if (!alive.current || current.current.scope !== scope || current.current.revision !== revision) return; props.onApply(result, revision); setAppliedJobId(id); } });
  };
  return <View>
    {!enabled ? <Notice message={copy.unavailable} tone="info" /> : null}
    <PrimaryButton label={copy.reviewImport} disabled={!enabled || props.parentBusy || busy || quote.state.phase === 'quoting'} loading={uploading} onPress={requestUpload} variant="secondary" testID="quoted-import-upload" />
    <EntityReferenceUploadStatus language={language} isPending={uploading} error={error instanceof DirectEntityUploadError ? error : null} onCancel={() => abort.current?.abort()} onRetry={() => { void startUpload(true); }} progress={progress} stage={stage} />
    {upload?.scope === scope && upload.token !== null && !uploading && !activeJob ? <PrimaryButton label={copy.title} onPress={() => { void openQuote(upload); }} variant="secondary" testID="quoted-import-review" /> : null}
    {acceptancePending ? <Notice message={copy.unknown} actionLabel={copy.reconcile} onAction={() => { void quote.controller.reconcile(); }} tone="warning" /> : null}
    {error !== null && !(error instanceof DirectEntityUploadError) || jobQuery.error !== null || (importJob?.status === 'completed' && !parsedResult.success) ? <Notice message={copy.importError} tone="warning" /> : null}
    {activeJob ? <Text style={textStyles.caption}>{copy.importPending}</Text> : null}
    <JobStatusCard api={api} sessionKey={sessionKey} organizationId={organizationId} language={language} jobId={jobId} job={importJob ?? undefined} onCompleted={() => { void jobQuery.refetch(); }} />
    {result === null || appliedJobId === jobId ? null : <><Notice message={copy.importReady} tone="info" /><PrimaryButton label={copy.apply} onPress={apply} testID="quoted-import-apply" variant="secondary" /></>}
    <AssetGenerationQuoteDialog state={quote.state} language={language} canAccept={quote.controller.canAccept()} onAccept={() => { void quote.controller.accept(); }} onClose={() => quote.controller.close()} onReconcile={() => { void quote.controller.reconcile(); }} onRequote={() => { if (upload !== null) void openQuote(upload); }} />
  </View>;
}
