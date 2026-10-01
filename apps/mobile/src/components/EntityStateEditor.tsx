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
const draftFromState = (state: EditableEntityState | null): Draft => ({ stateId: state?.id ?? null, name: state?.name ?? '', description: state?.description ?? '', loaded: true });

// State drafts and their paid previews are independent of the character's base
// reference. Every paid request has an explicit confirmation and fixed scope.
export function EntityStateEditor({ entity, parentDirty, parentBusy, initialCandidate, onReturnToPages }: Props): React.JSX.Element {
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
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState<'saved' | 'confirmedDone' | null>(null);
  const [candidateToken, setCandidateToken] = useState<string | null>(null);
  const [localJob, setLocalJob] = useState<{ id: string; stateId: string; revision: string } | null>(null);
  const lockRef = useRef(false);
  const aliveRef = useRef(true);
  const statesQuery = useQuery({ queryKey: statesKey, queryFn: () => api.getEntityStates(entity.id, organizationId) });
  const referenceQuery = useQuery({ queryKey: entityReferenceSetQueryKey(sessionKey, entity.id, organizationId), queryFn: () => api.getEntityReferenceSet(entity.id, organizationId) });
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
  const canEdit = hasCapability('edit_work');
  const previewBlocker = !quotedPreviewEnabled ? 'unavailable'
    : !hasCapability('generate') ? 'permission'
    : !statesQuery.isSuccess || !referenceQuery.isSuccess || !jobsQuery.isSuccess || !draft.loaded ? 'checking'
    : parentDirty || dirty ? 'dirty'
    : selected === null || payload === null || selected.updated_at === undefined ? 'invalid'
    : baseReference === undefined || !canDisplayMobileImage(baseReference) || referenceQuery.data?.status !== 'ready' ? 'baseMissing'
    : busy || parentBusy || activeJob || receiptPending || quoteBusy ? 'processing' : null;
  const currentRef = useRef({ scope, draft, selected, previewBlocker, baseId: baseReference?.ref_id, dirty, canEdit, parentBusy });
  useLayoutEffect(() => { currentRef.current = { scope, draft, selected, previewBlocker, baseId: baseReference?.ref_id, dirty, canEdit, parentBusy }; }, [scope, draft, selected, previewBlocker, baseReference?.ref_id, dirty, canEdit, parentBusy]);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: statesKey }), queryClient.invalidateQueries({ queryKey: jobsKey }),
      queryClient.invalidateQueries({ queryKey: ['jobs', sessionKey] }), queryClient.invalidateQueries({ queryKey: ['session', sessionKey] }),
      queryClient.invalidateQueries({ queryKey: ['page-generation-readiness', sessionKey] })
    ]);
  };
  const save = async (): Promise<void> => {
    const current = currentRef.current;
    const body = buildNamedStatePayload(current.draft.name, current.draft.description);
    if (lockRef.current || current.scope !== scope || !current.canEdit || current.parentBusy || body === null) throw new Error('State input cannot be saved');
    lockRef.current = true; setBusy(true); setError(false); setSuccess(null);
    try {
      const saved = await api.saveNamedEntityState(entity.id, current.draft.stateId, body, organizationId);
      queryClient.setQueryData<{ entity_states: EditableEntityState[] }>(statesKey, (previous) => ({ entity_states: [...(previous?.entity_states ?? []).filter((state) => state.id !== saved.id), saved] }));
      if (aliveRef.current && currentRef.current.scope === scope) { setDraft(draftFromState(saved)); setCandidateToken(null); setSuccess('saved'); }
      await queryClient.invalidateQueries({ queryKey: statesKey });
    } catch (cause) {
      if (aliveRef.current && currentRef.current.scope === scope) setError(true);
      throw cause;
    } finally { lockRef.current = false; if (aliveRef.current) setBusy(false); }
  };
  useDirtyEditorRegistration({
    id: `entity-state-editor:${scope}`, revision: JSON.stringify(draft), dirty,
    discard: () => setDraft(draftFromState(selected)), save
  });
  const selectState = (stateId: string | null): void => {
    if (busy) return;
    void resolveDirtyEditors(language).then((allowed) => {
      if (!allowed || !aliveRef.current || currentRef.current.scope !== scope) return;
      setDraft(draftFromState(states.find((state) => state.id === stateId) ?? null));
      setCandidateToken(null); setSuccess(null); setError(false);
    });
  };
  const confirmPreview = (): void => {
    if (previewBlocker !== null || selected === null || selected.updated_at === undefined) return;
    void stateQuote.controller.open({ label: stateLabel(selected, entity.name, language), revision: selected.updated_at,
      request: { operation: 'entity_state_preview', target_id: selected.id, entity_id: entity.id } });
  };
  const confirmCandidate = async (): Promise<void> => {
    const current = currentRef.current;
    if (current.scope !== scope || current.dirty || current.parentBusy || !current.canEdit || current.selected?.id !== selected?.id || current.selected?.updated_at !== selected?.updated_at) return;
    if (lockRef.current || !canEdit || busy || parentBusy || parentDirty || dirty || selected?.updated_at === undefined || candidateToken === null || !candidates.some((candidate) => candidate.candidate_token === candidateToken)) return;
    lockRef.current = true; setBusy(true); setError(false); setSuccess(null);
    try {
      await api.confirmEntityStateReference(entity.id, selected.id, { candidate_token: candidateToken, expected_state_revision: selected.updated_at }, organizationId);
      if (aliveRef.current && currentRef.current.scope === scope) { setCandidateToken(null); setSuccess('confirmedDone'); }
      await refresh();
    } catch { if (aliveRef.current && currentRef.current.scope === scope) setError(true); }
    finally { lockRef.current = false; if (aliveRef.current) setBusy(false); }
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
      <FormField editable={canEdit && !busy && !parentBusy && draft.loaded} label={stateMessage(language, 'name')} maxLength={100} placeholder={stateMessage(language, 'nameExample')} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} value={draft.name} />
      <FormField editable={canEdit && !busy && !parentBusy && draft.loaded} label={stateMessage(language, 'description')} maxLength={2000} multiline placeholder={stateMessage(language, 'descriptionExample')} onChangeText={(description) => setDraft((current) => ({ ...current, description }))} value={draft.description} />
      <PrimaryButton disabled={!canEdit || busy || parentBusy || payload === null || !dirty} label={stateMessage(language, 'save')} loading={busy} onPress={() => save().catch(() => undefined)} variant="secondary" />
      <PrimaryButton disabled={previewBlocker !== null} disabledReason={previewBlocker === null ? undefined : stateMessage(language, previewBlocker)} label={quoteCopy.reviewPreview} onPress={confirmPreview} variant="secondary" />
      {!receiptPending ? null : <Notice message={quoteCopy.unknown} actionLabel={quoteCopy.title} onAction={() => { if (stateQuote.state.target !== null) void stateQuote.controller.open(stateQuote.state.target); }} tone="warning" />}
      {error || statesQuery.error != null || referenceQuery.error != null || jobsQuery.error != null ? <Notice message={stateMessage(language, 'error')} actionLabel={stateMessage(language, 'refresh')} onAction={() => { void refresh(); }} tone="warning" /> : null}
      {success === null ? null : <Notice message={stateMessage(language, success)} tone="success" />}
      {blockedCandidates ? <Notice message={imageAccessNotice(language)} tone="warning" /> : null}
      {candidates.map((candidate, index) => (
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: candidateToken === candidate.candidate_token, disabled: busy || dirty }} accessibilityLabel={`${stateMessage(language, 'selectCandidate')} ${index + 1}`} disabled={busy || dirty} key={candidate.candidate_token} onPress={() => { if (!busy && !dirty) setCandidateToken(candidate.candidate_token); }} style={[styles.candidate, candidateToken === candidate.candidate_token ? styles.selected : null]}>
          <ResilientImage accessibilityLabel={`${stateMessage(language, 'candidate')} ${index + 1}`} contentFit="contain" sources={buildStateImageSources({ apiBaseUrl: config.apiBaseUrl, authorizationHeader, entityId: entity.id, organizationId, stateId: selected!.id, sessionKey, revision: selected!.updated_at!, candidate, provenance: candidate })} style={styles.image} />
          <Text style={styles.caption}>{stateMessage(language, 'selectCandidate')}{candidateToken === candidate.candidate_token ? ' ✓' : ''}</Text>
        </Pressable>
      ))}
      {candidates.length === 0 ? null : <PrimaryButton disabled={!canEdit || busy || parentBusy || parentDirty || dirty || candidateToken === null} label={stateMessage(language, 'confirm')} onPress={() => { void confirmCandidate(); }} variant="secondary" />}
      <AssetGenerationQuoteDialog state={stateQuote.state} language={language} canAccept={stateQuote.controller.canAccept()} onAccept={() => { void stateQuote.controller.accept(); }} onClose={() => stateQuote.controller.close()} onReconcile={() => { void stateQuote.controller.reconcile(); }} onRequote={confirmPreview} />
      <JobStatusCard api={api} sessionKey={sessionKey} organizationId={organizationId} language={language} jobId={jobId} job={stateJob} onCompleted={refresh} onFailed={refresh} onCanceled={refresh} />
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
