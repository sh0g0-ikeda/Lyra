import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text } from 'react-native';
import { AssetGenerationQuoteDialog } from '@/components/AssetGenerationQuoteDialog';
import { useAssetGenerationQuote } from '@/hooks/useAssetGenerationQuote';
import { assetQuoteMessages } from '@/lib/assetQuoteMessages';
import { canDisplayMobileImage, imageAccessNotice } from '@/domain/imageAccess';
import { FormField } from '@/components/FormField';
import { JobStatusCard } from '@/components/JobStatusCard';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RecordPicker } from '@/components/RecordPicker';
import { ResilientImage } from '@/components/ResilientImage';
import { Section } from '@/components/Section';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { buildEntityReferenceImageSources } from '@/domain/entityImageSources';
import { buildNamedStatePayload, buildStateImageSources, isStateReferenceJob, stateLabel, stateReferenceCandidates, type EditableEntityState, type InitialStateCandidate } from '@/domain/entityStateEditor';
import type { EntityRecord } from '@/domain/types';
import { config } from '@/lib/config';
import { stateMessage } from '@/lib/entityStateMessages';
import { entityReferenceSetQueryKey, entityStatesQueryKey, jobQueryKey } from '@/lib/queryKeys';
import { useAppState } from '@/state/appState';
import { useDirtyEditorRegistration, useDirtyState } from '@/state/dirtyState';

interface Props {
  entity: EntityRecord;
  parentDirty: boolean;
  parentBusy: boolean;
  availableCredits: number | null;
  initialCandidate?: InitialStateCandidate;
  onReturnToPages?: () => void;
}
interface Draft { stateId: string | null; name: string; description: string; loaded: boolean }
type StateOperationError = 'saveUnknown' | 'confirmUnknown' | 'savedRefreshFailed' | 'confirmedRefreshFailed' | 'readFailed';
interface StateFailure { kind: StateOperationError; name: string }
interface PendingConfirmation { state: EditableEntityState; token: string; jobId: string; candidateIndex: number; candidateCount: number }
const unknownMutation = (failure: StateFailure | null): boolean => failure?.kind === 'saveUnknown' || failure?.kind === 'confirmUnknown';
const draftFromState = (state: EditableEntityState | null): Draft => ({ stateId: state?.id ?? null, name: state?.name ?? '', description: state?.description ?? '', loaded: true });

// State drafts and their paid previews are independent of the character's base
// reference. Every paid request has an explicit confirmation and fixed scope.
export function EntityStateEditor(props: Props): React.JSX.Element {
  const { sessionKey, selection } = useAppState();
  return <ScopedEntityStateEditor key={JSON.stringify([sessionKey, selection.organizationId, props.entity.id])} {...props} />;
}

function ScopedEntityStateEditor({ entity, parentDirty, parentBusy, initialCandidate, onReturnToPages }: Props): React.JSX.Element {
  const { api, hasCapability, language, selection, session, sessionKey, tokens, trackJob } = useAppState();
  const { resolveDirtyEditors } = useDirtyState();
  const queryClient = useQueryClient();
  const organizationId = selection.organizationId;
  const scope = JSON.stringify([sessionKey, organizationId, entity.id]);
  const statesKey = entityStatesQueryKey(sessionKey, entity.id, organizationId);
  const jobsKey = ['entity-state-jobs', sessionKey, organizationId ?? 'personal', entity.id] as const;
  const validCandidate = initialCandidate?.entityId === entity.id ? initialCandidate : undefined;
  const [draft, setDraft] = useState<Draft>(() => validCandidate?.stateId != null
    ? { stateId: validCandidate.stateId, name: '', description: '', loaded: false }
    : { stateId: null, name: validCandidate?.name ?? '', description: validCandidate?.description ?? '', loaded: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StateFailure | null>(null);
  const [reviewedChangedState, setReviewedChangedState] = useState<EditableEntityState | null>(null);
  const [heldConfirmation, setHeldConfirmation] = useState<{ name: string; request: PendingConfirmation } | null>(null);
  const [success, setSuccess] = useState<'saved' | 'confirmedDone' | null>(null);
  const [candidateToken, setCandidateToken] = useState<string | null>(null);
  const [localJob, setLocalJob] = useState<{ id: string; stateId: string; revision: string } | null>(null);
  const lockRef = useRef(false);
  const operationRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const pendingConfirmationRef = useRef<PendingConfirmation | null>(null);
  const pendingConfirmationsRef = useRef(new Map<string, PendingConfirmation>());
  const aliveRef = useRef(true);
  const referenceKey = entityReferenceSetQueryKey(sessionKey, entity.id, organizationId);
  const statesQuery = useQuery({ queryKey: statesKey, queryFn: () => api.getEntityStates(entity.id, organizationId) });
  const referenceQuery = useQuery({ queryKey: referenceKey, queryFn: () => api.getEntityReferenceSet(entity.id, organizationId) });
  const jobsQuery = useQuery({
    queryKey: jobsKey,
    queryFn: async () => (await api.listJobs({ organizationId, jobTypes: ['entity_generate'], limit: 100 })).jobs.filter((job) => job.params.entity_id === entity.id),
    refetchInterval: (query) => query.state.data?.some((job) => job.status === 'queued' || job.status === 'processing') ? 2500 : false
  });
  const states = (statesQuery.data?.entity_states ?? []).filter((state) => state.entity_id === entity.id);
  const selected = states.find((state) => state.id === draft.stateId) ?? null;
  if (!draft.loaded && selected !== null) setDraft(draftFromState(selected));
  const dirty = draft.loaded && (draft.name !== (selected?.name ?? '') || draft.description !== (selected?.description ?? ''));
  const payload = buildNamedStatePayload(draft.name, draft.description);
  const quotedPreviewEnabled = session?.capabilities?.entity_state_reference_generation === true && session?.capabilities?.generation_quotes === true;
  const quoteCopy = assetQuoteMessages(language);
  const baseReference = referenceQuery.data?.reference_images.find((reference) => reference.ref_id === referenceQuery.data?.primary_ref_id);
  const matchingJobs = (jobsQuery.data ?? []).filter((job) => isStateReferenceJob(job, entity.id, draft.stateId ?? '')).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const jobId = localJob?.stateId === draft.stateId ? localJob.id : matchingJobs[0]?.id ?? null;
  const jobQuery = useQuery({
    enabled: jobId !== null,
    queryKey: jobQueryKey(sessionKey, jobId, organizationId),
    queryFn: () => api.getJob(jobId ?? '', organizationId),
    refetchInterval: (query) => query.state.data?.status === 'queued' || query.state.data?.status === 'processing' || query.state.status === 'error' ? 2500 : false
  });
  const stateJob = isStateReferenceJob(jobQuery.data, entity.id, draft.stateId ?? '') ? jobQuery.data : undefined;
  const candidates = selected === null ? [] : stateReferenceCandidates(stateJob, selected);
  const canEdit = hasCapability('edit_work');
  const currentRef = useRef({ scope, draft, selected, states, previewBlocker: null as string | null, baseId: baseReference?.ref_id, dirty, canEdit, parentBusy, parentDirty, error, candidateToken });
  const stateQuote = useAssetGenerationQuote({
    api, contextKey: scope, organizationId, enabled: quotedPreviewEnabled && hasCapability('generate'),
    revision: JSON.stringify([draft, selected?.updated_at, baseReference?.ref_id, parentDirty, parentBusy]),
    prepare: async (target) => {
      const current = currentRef.current;
      if (current.scope !== scope || current.previewBlocker !== null || current.selected?.id !== target.request.target_id || current.selected?.updated_at !== target.revision) throw new Error('State quote inputs changed');
      return target;
    },
    onAccepted: async (receipt, target, originKey) => {
      if (receipt.job_id === null || target.request.target_id === undefined || !aliveRef.current || currentRef.current.scope !== originKey) return;
      setLocalJob({ id: receipt.job_id, stateId: target.request.target_id, revision: target.revision }); setCandidateToken(null);
      await trackJob(receipt.job_id).catch(() => undefined); await refresh();
    }
  });
  const receiptPending = stateQuote.state.phase === 'unknown';
  const quoteBusy = stateQuote.state.phase === 'quoting' || stateQuote.state.phase === 'accepting';
  const activeJob = (jobsQuery.data ?? []).some((job) => job.status === 'queued' || job.status === 'processing') || stateJob?.status === 'queued' || stateJob?.status === 'processing';
  const previewBlocker = !quotedPreviewEnabled ? 'unavailable'
    : !hasCapability('generate') ? 'permission'
    : !statesQuery.isSuccess || !referenceQuery.isSuccess || !jobsQuery.isSuccess || !draft.loaded ? 'checking'
    : unknownMutation(error) ? 'checkResult'
    : parentDirty || dirty ? 'dirty'
    : selected === null || payload === null || selected.updated_at === undefined ? 'invalid'
    : baseReference === undefined || !canDisplayMobileImage(baseReference) || referenceQuery.data?.status !== 'ready' ? 'baseMissing'
    : busy || parentBusy || activeJob || receiptPending || quoteBusy ? 'processing' : null;
  useLayoutEffect(() => { currentRef.current = { scope, draft, selected, states, previewBlocker, baseId: baseReference?.ref_id, dirty, canEdit, parentBusy, parentDirty, error, candidateToken }; }, [scope, draft, selected, states, previewBlocker, baseReference?.ref_id, dirty, canEdit, parentBusy, parentDirty, error, candidateToken]);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const isCurrentOperation = (operation: number): boolean => aliveRef.current && currentRef.current.scope === scope && operationRef.current === operation;
  const updateDraft = (next: Draft): void => {
    currentRef.current = { ...currentRef.current, draft: next };
    setDraft(next);
  };
  const changeDraft = (fields: Partial<Pick<Draft, 'name' | 'description'>>): void => {
    if (!aliveRef.current || currentRef.current.scope !== scope) return;
    updateDraft({ ...currentRef.current.draft, ...fields });
    setSuccess(null);
    if (!unknownMutation(currentRef.current.error)) setError(null);
  };
  const finishMutation = (operation: number): void => {
    if (!isCurrentOperation(operation)) return;
    lockRef.current = false; setBusy(false);
  };
  // A response belongs to this scope and pinned state. A newer cached revision
  // from another read/mutation must not be replaced by a delayed receipt.
  const cacheReceipt = (saved: EditableEntityState, expectedRevision: string | undefined): boolean => {
    let applied = false;
    queryClient.setQueryData<{ entity_states: EditableEntityState[] }>(statesKey, (previous) => {
      const existing = previous?.entity_states.find((state) => state.id === saved.id);
      if (existing !== undefined && existing.updated_at !== expectedRevision && existing.updated_at !== saved.updated_at) return previous;
      applied = true;
      return { entity_states: [...(previous?.entity_states ?? []).filter((state) => state.id !== saved.id), saved] };
    });
    return applied;
  };
  const refresh = async (): Promise<void> => {
    await Promise.all([
      statesKey, referenceKey, jobsKey, jobQueryKey(sessionKey, jobId, organizationId),
      ['jobs', sessionKey], ['session', sessionKey], ['page-generation-readiness', sessionKey]
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey }, { throwOnError: true })));
  };
  const recover = async (): Promise<void> => {
    const operation = operationRef.current;
    const current = currentRef.current;
    try {
      await refresh();
      if (!isCurrentOperation(operation) || currentRef.current.draft !== current.draft) return;
      // Reading old state cannot prove that an unknown mutation never committed.
      if (!unknownMutation(current.error)) setError(null);
      const pinned = pendingConfirmationRef.current;
      const latest = queryClient.getQueryData<{ entity_states: EditableEntityState[] }>(statesKey)?.entity_states.find((state) => state.entity_id === entity.id && state.id === current.draft.stateId);
      if (current.error?.kind === 'confirmUnknown' && pinned !== null && latest !== undefined && latest.id === pinned.state.id && latest.updated_at !== pinned.state.updated_at && (latest.name !== pinned.state.name || latest.description !== pinned.state.description)) setReviewedChangedState(latest);
    } catch {
      if (isCurrentOperation(operation) && currentRef.current.draft === current.draft && current.error === null) setError({ kind: 'readFailed', name: current.draft.name });
    }
  };
  const continueEditing = (): void => {
    const current = currentRef.current;
    const pinned = pendingConfirmationRef.current;
    if (!aliveRef.current || lockRef.current || current.scope !== scope || current.error?.kind !== 'confirmUnknown' || reviewedChangedState === null || pinned === null || current.selected?.id !== reviewedChangedState.id || current.selected.updated_at !== reviewedChangedState.updated_at) return;
    // A changed saved input lets the user leave this local hold, but neither a
    // conflict nor a GET proves storage settlement. Keep that uncertainty visible.
    ++operationRef.current;
    setHeldConfirmation({ name: current.error.name, request: pinned });
    pendingConfirmationsRef.current.delete(pinned.state.id);
    pendingConfirmationRef.current = null;
    setReviewedChangedState(null); setError(null); setSuccess(null);
  };
  const save = async (): Promise<void> => {
    const current = currentRef.current;
    const body = buildNamedStatePayload(current.draft.name, current.draft.description);
    if (!aliveRef.current || lockRef.current || current.scope !== scope || current.draft !== draft || !current.canEdit || current.parentBusy || unknownMutation(current.error) || body === null) throw new Error('State input cannot be saved');
    const operation = ++operationRef.current;
    setReviewedChangedState(null);
    lockRef.current = true; setBusy(true); setError(null); setSuccess(null);
    let saved: EditableEntityState;
    try {
      saved = await api.saveNamedEntityState(entity.id, current.draft.stateId, body, organizationId);
      if (saved.entity_id !== entity.id || (current.draft.stateId !== null && saved.id !== current.draft.stateId)) throw new Error('State response did not match the requested state');
    } catch (cause) {
      if (isCurrentOperation(operation)) setError({ kind: 'saveUnknown', name: body.name });
      finishMutation(operation);
      throw cause;
    }
    if (!isCurrentOperation(operation)) return;
    let savedDraft = current.draft;
    if (cacheReceipt(saved, current.selected?.updated_at) && currentRef.current.draft === current.draft) {
      savedDraft = draftFromState(saved);
      updateDraft(savedDraft); setCandidateToken(null); setSuccess('saved');
    }
    finishMutation(operation);
    // The save has already succeeded. Refresh failure must not reject a dirty
    // editor save, lose its receipt, or offer a second mutation as recovery.
    try {
      await queryClient.invalidateQueries({ queryKey: statesKey }, { throwOnError: true });
    } catch {
      if (isCurrentOperation(operation) && currentRef.current.draft === savedDraft) setError({ kind: 'savedRefreshFailed', name: saved.name ?? body.name });
    }
  };
  useDirtyEditorRegistration({
    id: `entity-state-editor:${scope}`, revision: JSON.stringify(draft), dirty,
    discard: () => updateDraft(draftFromState(currentRef.current.selected)), save
  });
  const selectState = (stateId: string | null): void => {
    if (lockRef.current || !aliveRef.current || currentRef.current.draft !== draft) return;
    const request = ++selectionRequestRef.current;
    void resolveDirtyEditors(language).then((allowed) => {
      if (!allowed || !aliveRef.current || currentRef.current.scope !== scope || request !== selectionRequestRef.current || lockRef.current) return;
      ++operationRef.current;
      const pending = stateId === null ? null : pendingConfirmationsRef.current.get(stateId) ?? null;
      pendingConfirmationRef.current = pending;
      setReviewedChangedState(null);
      updateDraft(draftFromState(currentRef.current.states.find((state) => state.id === stateId) ?? null));
      setCandidateToken(null); setSuccess(null); setError(pending === null ? null : { kind: 'confirmUnknown', name: pending.state.name ?? '' });
    });
  };
  const confirmPreview = (): void => {
    if (previewBlocker !== null || selected === null || selected.updated_at === undefined) return;
    void stateQuote.controller.open({ label: stateLabel(selected, entity.name, language), revision: selected.updated_at,
      request: { operation: 'entity_state_preview', target_id: selected.id, entity_id: entity.id } });
  };
  const confirmCandidate = async (reconcile = false): Promise<void> => {
    const current = currentRef.current;
    if (!aliveRef.current || lockRef.current || current.scope !== scope || current.dirty || current.parentBusy || current.parentDirty || !current.canEdit) return;
    let pinned = pendingConfirmationRef.current;
    if (reconcile) {
      if (current.error?.kind !== 'confirmUnknown' || pinned === null || current.selected?.id !== pinned.state.id) return;
    } else {
      if (unknownMutation(current.error) || current.selected?.id !== selected?.id || current.selected?.updated_at !== selected?.updated_at || current.candidateToken !== candidateToken) return;
      if (selected?.updated_at === undefined || candidateToken === null || jobId === null) return;
      const candidateIndex = candidates.findIndex((candidate) => candidate.candidate_token === candidateToken);
      if (candidateIndex < 0) return;
      pinned = { state: selected, token: candidateToken, jobId, candidateIndex, candidateCount: candidates.length };
      pendingConfirmationRef.current = pinned;
      pendingConfirmationsRef.current.set(pinned.state.id, pinned);
    }
    if (pinned === null || pinned.state.updated_at === undefined) return;
    const operation = ++operationRef.current;
    setReviewedChangedState(null);
    lockRef.current = true; setBusy(true); setSuccess(null);
    if (!reconcile) setError(null);
    let receipt: Awaited<ReturnType<typeof api.confirmEntityStateReference>>;
    try {
      let token = pinned.token;
      if (reconcile) {
        // Tokens expire. The completed job's immutable ordered candidates let us
        // renew the same candidate, never substitute a newer job or paid preview.
        const refreshedJob = await api.getJob(pinned.jobId, organizationId);
        const renewedCandidates = stateReferenceCandidates(refreshedJob, pinned.state);
        if (refreshedJob.id !== pinned.jobId || renewedCandidates.length !== pinned.candidateCount || renewedCandidates[pinned.candidateIndex] === undefined) throw new Error('Original confirmation candidate could not be refreshed');
        token = renewedCandidates[pinned.candidateIndex]!.candidate_token;
        const latest = currentRef.current;
        if (!isCurrentOperation(operation) || latest.draft !== current.draft || latest.selected?.id !== pinned.state.id || latest.dirty || latest.parentBusy || latest.parentDirty || !latest.canEdit) { finishMutation(operation); return; }
      }
      receipt = await api.confirmEntityStateReference(entity.id, pinned.state.id, { candidate_token: token, expected_state_revision: pinned.state.updated_at }, organizationId);
      if (receipt.entity_id !== entity.id || receipt.state_id !== pinned.state.id) throw new Error('Confirmation response did not match the requested state');
    } catch {
      if (isCurrentOperation(operation)) setError({ kind: 'confirmUnknown', name: current.draft.name });
      finishMutation(operation);
      return;
    }
    if (!isCurrentOperation(operation)) return;
    cacheReceipt({ ...pinned.state, updated_at: receipt.state_revision, reference_status: 'confirmed', reference_image: receipt.reference_image }, pinned.state.updated_at);
    pendingConfirmationsRef.current.delete(pinned.state.id);
    pendingConfirmationRef.current = null;
    if (heldConfirmation?.request.jobId === pinned.jobId && heldConfirmation.request.candidateIndex === pinned.candidateIndex) setHeldConfirmation(null);
    setCandidateToken(null); setError(null);
    if (currentRef.current.draft === current.draft) setSuccess('confirmedDone');
    finishMutation(operation);
    try { await refresh(); }
    catch { if (isCurrentOperation(operation) && currentRef.current.draft === current.draft) setError({ kind: 'confirmedRefreshFailed', name: current.draft.name }); }
  };
  const authorizationHeader = tokens === null ? null : `Bearer ${tokens.idToken}`;
  const baseSources = baseReference === undefined ? [] : buildEntityReferenceImageSources({ apiBaseUrl: config.apiBaseUrl, authorizationHeader, entityId: entity.id, organizationId, reference: baseReference, revision: referenceQuery.data?.updated_at ?? baseReference.created_at, sessionKey });
  const confirmedSources = selected?.reference_status !== 'confirmed' || selected.reference_image == null ? [] : buildStateImageSources({ apiBaseUrl: config.apiBaseUrl, authorizationHeader, entityId: entity.id, organizationId, stateId: selected.id, sessionKey, revision: selected.updated_at ?? selected.created_at, referenceId: selected.reference_image.ref_id, provenance: selected.reference_image });
  const blockedCandidates = Array.isArray(stateJob?.result?.candidates) && stateJob.result.candidates.some((candidate) => typeof candidate === 'object' && candidate !== null && !canDisplayMobileImage(candidate));
  const status = selected?.reference_status ?? (selected?.name == null ? 'legacy' : 'draft');
  return (
    <Section collapsible persistKey="characters:named-states" title={stateMessage(language, 'title')}>
      <Text style={styles.label}>{stateMessage(language, 'base')}</Text>
      {baseSources.length === 0 ? <Notice message={!canDisplayMobileImage(baseReference) ? imageAccessNotice(language) : stateMessage(language, 'baseMissing')} tone="info" /> : <ResilientImage accessibilityLabel={`${entity.name}・${stateMessage(language, 'default')}`} contentFit="contain" sources={baseSources} style={styles.image} />}
      <RecordPicker language={language} items={states} selectedId={draft.stateId} onSelect={(id) => selectState(id)} labelForItem={(state) => stateLabel(state, entity.name, language)} emptyLabel={stateMessage(language, 'noStates')} />
      <PrimaryButton disabled={!canEdit || busy || parentBusy} label={stateMessage(language, 'newState')} onPress={() => selectState(null)} variant="secondary" />
      {selected === null ? null : <Text style={styles.caption}>{stateMessage(language, status)}</Text>}
      {selected?.reference_image != null ? <Text style={styles.caption}>{stateMessage(language, 'retained')}</Text> : null}
      {!canDisplayMobileImage(selected?.reference_image) ? <Notice message={imageAccessNotice(language)} tone="warning" /> : null}
      {confirmedSources.length === 0 ? null : <ResilientImage accessibilityLabel={stateLabel(selected!, entity.name, language)} contentFit="contain" sources={confirmedSources} style={styles.image} />}
      <FormField editable={canEdit && !busy && !parentBusy && draft.loaded} label={stateMessage(language, 'name')} maxLength={100} placeholder={stateMessage(language, 'nameExample')} onChangeText={(name) => changeDraft({ name })} value={draft.name} />
      <FormField editable={canEdit && !busy && !parentBusy && draft.loaded} label={stateMessage(language, 'description')} maxLength={2000} multiline placeholder={stateMessage(language, 'descriptionExample')} onChangeText={(description) => changeDraft({ description })} value={draft.description} />
      <PrimaryButton disabled={!canEdit || busy || parentBusy || payload === null || !dirty || unknownMutation(error)} label={stateMessage(language, 'save')} loading={busy} onPress={() => save().catch(() => undefined)} variant="secondary" />
      <PrimaryButton disabled={previewBlocker !== null} disabledReason={previewBlocker === null ? undefined : stateMessage(language, previewBlocker)} label={quoteCopy.reviewPreview} onPress={confirmPreview} variant="secondary" />
      {!receiptPending ? null : <Notice message={quoteCopy.unknown} actionLabel={quoteCopy.title} onAction={() => { if (stateQuote.state.target !== null) void stateQuote.controller.open(stateQuote.state.target); }} tone="warning" />}
      {error !== null || statesQuery.error != null || referenceQuery.error != null || jobsQuery.error != null ? <Notice announce message={stateMessage(language, error?.kind ?? 'readFailed', { name: error?.name ?? draft.name })} actionLabel={stateMessage(language, 'refresh')} onAction={() => { void recover(); }} tone="warning" /> : null}
      {error?.kind !== 'confirmUnknown' ? null : <PrimaryButton disabled={!canEdit || busy || parentBusy || parentDirty || dirty} label={stateMessage(language, 'reconcileConfirmation')} onPress={() => { void confirmCandidate(true); }} variant="secondary" />}
      {error?.kind !== 'confirmUnknown' || reviewedChangedState === null ? null : <PrimaryButton disabled={busy || parentBusy} label={stateMessage(language, 'continueEditingUnconfirmed')} onPress={continueEditing} variant="secondary" />}
      {heldConfirmation === null ? null : <Notice message={stateMessage(language, 'confirmationHeld', { name: heldConfirmation.name })} tone="warning" />}
      {success === null || error !== null ? null : <Notice message={stateMessage(language, success)} tone="success" />}
      {blockedCandidates ? <Notice message={imageAccessNotice(language)} tone="warning" /> : null}
      {candidates.map((candidate, index) => (
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: candidateToken === candidate.candidate_token, disabled: busy || dirty || unknownMutation(error) }} accessibilityLabel={`${stateMessage(language, 'selectCandidate')} ${index + 1}`} disabled={busy || dirty || unknownMutation(error)} key={candidate.candidate_token} onPress={() => { if (!lockRef.current && !currentRef.current.dirty && !unknownMutation(currentRef.current.error)) setCandidateToken(candidate.candidate_token); }} style={[styles.candidate, candidateToken === candidate.candidate_token ? styles.selected : null]}>
          <ResilientImage accessibilityLabel={`${stateMessage(language, 'candidate')} ${index + 1}`} contentFit="contain" sources={buildStateImageSources({ apiBaseUrl: config.apiBaseUrl, authorizationHeader, entityId: entity.id, organizationId, stateId: selected!.id, sessionKey, revision: selected!.updated_at!, candidate, provenance: candidate })} style={styles.image} />
          <Text style={styles.caption}>{stateMessage(language, 'selectCandidate')}{candidateToken === candidate.candidate_token ? ' ✓' : ''}</Text>
        </Pressable>
      ))}
      {candidates.length === 0 ? null : <PrimaryButton disabled={!canEdit || busy || parentBusy || parentDirty || dirty || candidateToken === null || unknownMutation(error)} label={stateMessage(language, 'confirm')} onPress={() => { void confirmCandidate(); }} variant="secondary" />}
      <AssetGenerationQuoteDialog state={stateQuote.state} language={language} canAccept={stateQuote.controller.canAccept()} onAccept={() => { void stateQuote.controller.accept(); }} onClose={() => stateQuote.controller.close()} onReconcile={() => { void stateQuote.controller.reconcile(); }} onRequote={confirmPreview} />
      <JobStatusCard api={api} sessionKey={sessionKey} organizationId={organizationId} language={language} jobId={jobId} job={stateJob} onCompleted={recover} onFailed={recover} onCanceled={recover} />
      {onReturnToPages === undefined || (success !== 'confirmedDone' && selected?.reference_status !== 'confirmed') ? null : <PrimaryButton label={stateMessage(language, 'returnPages')} onPress={onReturnToPages} variant="secondary" />}
    </Section>
  );
}
const styles = StyleSheet.create({
  label: { ...textStyles.sectionTitle }, caption: { ...textStyles.caption },
  image: { width: '100%', height: 200, borderRadius: radius.md },
  candidate: { minHeight: 48, padding: spacing.sm, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: radius.md },
  selected: { borderColor: colors.primary, borderWidth: 2 }
});
