import { canDisplayMobileImage, type MobileImageProvenance } from '@/domain/imageAccess';
import type { z } from 'zod';
import type { entityStateSchema } from '@/domain/apiSchemas';
import { deduplicateImageSources, publicHttpsImageSource, type RemoteImageSource } from '@/domain/imageSourceCandidates';
import { withPageImageRevision } from '@/domain/pageImageCache';
import { stateMessage } from '@/lib/entityStateMessages';
import type { UiLanguage } from '@/domain/types';

export type EditableEntityState = z.infer<typeof entityStateSchema> & {
  reference_status?: 'legacy' | 'draft' | 'confirmed' | 'stale';
  reference_image?: {
    ref_id: string; image_model: string; base_ref_id: string; created_at: string; input_fingerprint: string;
  } | null;
};
export interface NamedEntityStatePayload { name: string; description: string }
export interface StateReferenceCandidate extends MobileImageProvenance { candidate_token: string; cdn_url?: string }
export interface InitialStateCandidate { entityId: string; name: string; description: string; stateId?: string | null }
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Only the two authored variant fields are sent. Hidden legacy fields, base references
// and prior confirmed image descriptors remain server-owned and are never cleared.
export function buildNamedStatePayload(name: string, description: string): NamedEntityStatePayload | null {
  const payload = { name: name.trim(), description: description.trim() };
  return payload.name.length > 0 && payload.name.length <= 100 &&
    payload.description.length > 0 && payload.description.length <= 2000 ? payload : null;
}

export function readStatePreviewCapability(session: unknown): { enabled: boolean; cost: number | null } {
  const capabilities = record(record(session)?.capabilities);
  const rawCost = capabilities?.entity_state_preview_credit_cost;
  const cost = typeof rawCost === 'number' && Number.isInteger(rawCost) && rawCost > 0 ? rawCost : null;
  return { enabled: capabilities?.entity_state_reference_generation === true && cost !== null, cost };
}

export function stateOptionSelectable(state: EditableEntityState): boolean {
  if (!canDisplayMobileImage(state.reference_image)) return false;
  if (state.name == null && state.description == null) return true;
  return state.reference_status === 'confirmed' && state.reference_image != null;
}
export function stateLabel(state: EditableEntityState, entityName: string, language: UiLanguage): string {
  const label = state.name?.trim() || state.condition_note?.trim() || state.costume_note?.trim() || state.hair_note?.trim() ||
    stateMessage(language, 'legacyName');
  return `${entityName}・${label}`;
}
export function isStateReferenceJob(job: unknown, entityId: string, stateId?: string): boolean {
  const jobRecord = record(job); const params = record(jobRecord?.params);
  return jobRecord?.job_type === 'entity_generate' && params?.target === 'entity_state' &&
    params.entity_id === entityId && typeof params.entity_state_id === 'string' &&
    (stateId === undefined || params.entity_state_id === stateId);
}
export function stateReferenceCandidates(job: unknown, state: EditableEntityState): StateReferenceCandidate[] {
  const jobRecord = record(job); const params = record(jobRecord?.params); const result = record(jobRecord?.result);
  if (!canDisplayMobileImage(result) || !isStateReferenceJob(job, state.entity_id, state.id) || jobRecord?.status !== 'completed' ||
      params?.state_revision !== state.updated_at || result?.provider_result !== true || !Array.isArray(result.candidates)) return [];
  return result.candidates.flatMap((value) => {
    const candidate = record(value);
    if (!canDisplayMobileImage(candidate) || typeof candidate?.candidate_token !== 'string' || candidate.candidate_token.trim().length === 0 || candidate.candidate_token.length > 4096) return [];
    return [{ candidate_token: candidate.candidate_token, ...(typeof candidate.cdn_url === 'string' ? { cdn_url: candidate.cdn_url } : {}) }];
  });
}

export function buildStateImageSources(input: {
  apiBaseUrl: string; sessionKey: string; organizationId: string | null; authorizationHeader: string | null;
  entityId: string; stateId: string; revision: string; referenceId?: string; candidate?: StateReferenceCandidate; provenance?: MobileImageProvenance | null;
}): RemoteImageSource[] {
  if (!canDisplayMobileImage(input.provenance) || !canDisplayMobileImage(input.candidate)) return [];
  const url = new URL(`${input.apiBaseUrl.replace(/\/+$/u, '')}/api/entities/${encodeURIComponent(input.entityId)}/states/${encodeURIComponent(input.stateId)}/${input.candidate === undefined ? 'reference-image' : 'reference-candidate-image'}`);
  if (input.organizationId !== null) url.searchParams.set('organization_id', input.organizationId);
  if (input.candidate !== undefined) {
    url.searchParams.set('candidate_token', input.candidate.candidate_token);
    url.searchParams.set('expected_state_revision', input.revision);
  }
  const cacheKey = ['state-reference', input.sessionKey, input.organizationId ?? 'personal', input.entityId, input.stateId, input.referenceId ?? 'candidate', input.revision].map(encodeURIComponent).join(':');
  return deduplicateImageSources([
    publicHttpsImageSource(input.candidate?.cdn_url),
    {
      uri: input.candidate === undefined ? withPageImageRevision(url.toString(), input.revision, cacheKey) : url.toString(),
      ...(input.candidate === undefined ? { cacheKey } : {}),
      ...(input.authorizationHeader === null ? {} : { headers: { Authorization: input.authorizationHeader } })
    }
  ]);
}
