import type { EntityReferenceGenerationBlockerCode } from '@/domain/entityReferencePolicy';
import type { PageGenerationBlockerCode, UiLanguage } from '@/domain/types';
import { ApiError } from '@/lib/api';
import { t, type TranslationKey } from '@/lib/i18n';

export type ErrorRecoveryTarget =
  | 'retry'
  | 'login'
  | 'workspace'
  | 'credits'
  | 'jobs'
  | 'layout'
  | 'characters';

const recoveryActionKeys: Record<ErrorRecoveryTarget, TranslationKey> = {
  retry: 'shared.error.action.retry',
  login: 'shared.error.action.login',
  workspace: 'shared.error.action.workspace',
  credits: 'shared.error.action.credits',
  jobs: 'shared.error.action.jobs',
  layout: 'shared.error.action.layout',
  characters: 'shared.error.action.characters'
};

const activeJobCodes = new Set([
  'ACTIVE_GENERATION_JOB',
  'ACTIVE_PREVIEW_JOB',
  'GENERATION_ALREADY_ACTIVE',
  'JOB_ALREADY_ACTIVE'
]);

const frameMismatchCodes = new Set([
  'FRAME_COUNT_MISMATCH',
  'FRAME_PANEL_COUNT_MISMATCH',
  'PANEL_FRAME_COUNT_MISMATCH'
]);

const missingReferenceCodes = new Set([
  'CONFIRMED_REFERENCE_REQUIRED',
  'MISSING_CHARACTER_REFERENCE',
  'REFERENCE_NOT_FOUND'
]);

const retryCodes = new Set([
  'NETWORK_OFFLINE',
  'PAGE_STALE',
  'RATE_LIMITED',
  'RESOURCE_STALE'
]);

const knownNetworkMessages = new Set([
  'failed to fetch',
  'network request failed',
  'networkerror'
]);

export const errorRecoveryTarget = (error: unknown): ErrorRecoveryTarget | null => {
  if (error instanceof ApiError) {
    const code = error.code?.trim().toUpperCase() ?? '';

    if (error.status === 401 || code === 'UNAUTHORIZED') {
      return 'login';
    }
    if (error.status === 403 || code === 'FORBIDDEN') {
      return 'workspace';
    }
    if (error.status === 402 || code === 'INSUFFICIENT_CREDITS') {
      return 'credits';
    }
    if (code === 'REQUEST_TIMEOUT') {
      return 'jobs';
    }
    if (activeJobCodes.has(code)) {
      return 'jobs';
    }
    if (frameMismatchCodes.has(code)) {
      return 'layout';
    }
    if (missingReferenceCodes.has(code)) {
      return 'characters';
    }
    if (
      error.status === 0 ||
      error.status === 429 ||
      error.status >= 500 ||
      retryCodes.has(code)
    ) {
      return 'retry';
    }
    return null;
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'jobs';
    }
    if (
      error instanceof TypeError &&
      knownNetworkMessages.has(error.message.trim().toLowerCase())
    ) {
      return 'retry';
    }
  }

  return null;
};

export const errorRecoveryActionLabel = (
  target: ErrorRecoveryTarget,
  language: UiLanguage
): string => t(language, recoveryActionKeys[target]);

export const pageGenerationBlockerRecoveryTarget = (
  code: PageGenerationBlockerCode
): ErrorRecoveryTarget | null => {
  switch (code) {
    case 'FRAME_REQUIRED':
    case 'FRAME_PANEL_MISMATCH':
      return 'layout';
    case 'CHARACTER_REFERENCE_REQUIRED':
      return 'characters';
    case 'PAGE_GENERATING':
    case 'ACTIVE_GENERATION_JOB':
      return 'jobs';
    case 'INSUFFICIENT_CREDITS':
      return 'credits';
    case 'GENERATION_DISABLED':
    case 'PANEL_REQUIRED':
    case 'PANEL_ORDER_INVALID':
    case 'DIALOGUE_SPEAKER_REQUIRED':
    case 'DIALOGUE_SPEAKER_NOT_IN_PANEL':
    case 'ASSIGNED_ENTITY_INVALID':
    case 'PAGE_REOPEN_REQUIRED':
    case 'REFERENCE_IMAGE_LIMIT_EXCEEDED':
      return null;
  }
};

export const entityGenerationBlockerRecoveryTarget = (
  code: EntityReferenceGenerationBlockerCode
): ErrorRecoveryTarget | null => {
  switch (code) {
    case 'ACTIVE_PREVIEW_JOB':
      return 'jobs';
    case 'INSUFFICIENT_CREDITS':
      return 'credits';
    case 'PERMISSION_REQUIRED':
      return 'workspace';
    case 'ENTITY_SAVE_REQUIRED':
    case 'FEATURE_DISABLED':
    case 'IMPORT_IN_PROGRESS':
    case 'NAME_REQUIRED':
    case 'UNSUPPORTED_TYPE':
      return null;
  }
};
