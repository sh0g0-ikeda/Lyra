import type { EntityType } from '@/domain/types';

export interface EntityReferenceCandidate {
  candidate_token: string;
  cdn_url?: string;
  source: 'import' | 'generated';
}

export type EntityReferenceGenerationBlockerCode =
  | 'PERMISSION_REQUIRED'
  | 'FEATURE_DISABLED'
  | 'ENTITY_SAVE_REQUIRED'
  | 'NAME_REQUIRED'
  | 'UNSUPPORTED_TYPE'
  | 'IMPORT_IN_PROGRESS'
  | 'ACTIVE_PREVIEW_JOB'
  | 'INSUFFICIENT_CREDITS';

export interface EntityReferenceGenerationBlocker {
  code: EntityReferenceGenerationBlockerCode;
}

export function selectSingleReferenceCandidate(input: {
  generatedCandidates: readonly EntityReferenceCandidate[];
  importedCandidate: EntityReferenceCandidate | null;
}): EntityReferenceCandidate | null {
  const generatedCandidate = input.generatedCandidates.find(
    (candidate) => candidate.candidate_token.trim().length > 0
  );
  if (generatedCandidate !== undefined) {
    return generatedCandidate;
  }
  if (
    input.importedCandidate !== null &&
    input.importedCandidate.candidate_token.trim().length > 0
  ) {
    return input.importedCandidate;
  }
  return null;
}

export function buildSingleCandidateConfirmation(
  candidateToken: string
): {
  selected_candidate_tokens: string[];
  primary_candidate_token: string;
} | null {
  const normalizedToken = candidateToken.trim();
  if (normalizedToken.length === 0) {
    return null;
  }
  return {
    selected_candidate_tokens: [normalizedToken],
    primary_candidate_token: normalizedToken
  };
}

export function buildEntityReferenceGenerationBlockers(input: {
  availableCredits: number | null;
  canGenerate: boolean;
  entityType: EntityType;
  featureEnabled: boolean | null;
  hasActiveJob: boolean;
  importPending: boolean;
  name: string;
  selectedEntityId: string | null;
}): EntityReferenceGenerationBlocker[] {
  const blockers: EntityReferenceGenerationBlocker[] = [];
  if (!input.canGenerate) {
    blockers.push({ code: 'PERMISSION_REQUIRED' });
  }
  if (input.featureEnabled === false) {
    blockers.push({ code: 'FEATURE_DISABLED' });
  }
  if (input.selectedEntityId === null) {
    blockers.push({ code: 'ENTITY_SAVE_REQUIRED' });
  }
  if (input.name.trim().length === 0) {
    blockers.push({ code: 'NAME_REQUIRED' });
  }
  if (
    input.entityType !== 'character' &&
    input.entityType !== 'nonhuman' &&
    input.entityType !== 'object'
  ) {
    blockers.push({ code: 'UNSUPPORTED_TYPE' });
  }
  if (input.importPending) {
    blockers.push({ code: 'IMPORT_IN_PROGRESS' });
  }
  if (input.hasActiveJob) {
    blockers.push({ code: 'ACTIVE_PREVIEW_JOB' });
  }
  if (input.availableCredits !== null && input.availableCredits < 1) {
    blockers.push({ code: 'INSUFFICIENT_CREDITS' });
  }
  return blockers;
}
