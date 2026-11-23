import { ConfigurationError, ValidationError } from '../../domain/errors/index.js';
import { generationFailureDiagnostic } from './GenerationFailureDiagnostic.js';

const IMAGE_PROVIDER_MAX_ATTEMPTS = 2;

export type ImageProviderAttemptResult<T> =
  | { status: 'generated'; value: T }
  | { status: 'cancelled' };

interface ImageProviderAttemptInput<T> {
  jobId: string;
  stage: 'page_render' | 'entity_render' | (() => string);
  attempt: (checkpoint: () => Promise<void>) => Promise<T>;
  validate: (value: T) => void;
  finalizeCancellation: () => Promise<boolean>;
  retryable?: (error: unknown) => boolean | undefined;
}

class ImageAttemptCancelled extends Error {}

// A worker claim owns the complete two-attempt image budget. The provider client
// is configured with maxRetries=1. A page's pre-render audit shares this budget;
// storage and commit remain outside this
// loop so a known image success is never rendered again after a later failure.
export async function runImageProviderAttempts<T>(
  input: ImageProviderAttemptInput<T>,
): Promise<ImageProviderAttemptResult<T>> {
  const checkpoint = async (): Promise<void> => {
    if (await input.finalizeCancellation()) throw new ImageAttemptCancelled();
  };
  for (let attempt = 1; attempt <= IMAGE_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    if (await input.finalizeCancellation()) return { status: 'cancelled' };
    try {
      const value = await input.attempt(checkpoint);
      input.validate(value);
      if (await input.finalizeCancellation()) return { status: 'cancelled' };
      return { status: 'generated', value };
    } catch (error) {
      if (error instanceof ImageAttemptCancelled) return { status: 'cancelled' };
      if (await input.finalizeCancellation()) return { status: 'cancelled' };
      const diagnostic = safeImageAttemptDiagnostic(error);
      console.warn('image_provider_attempt_failed', {
        jobId: input.jobId,
        stage: typeof input.stage === 'function' ? input.stage() : input.stage,
        attempt,
        maxAttempts: IMAGE_PROVIDER_MAX_ATTEMPTS,
        ...diagnostic,
        ...generationFailureDiagnostic(error),
      });
      const retryable = input.retryable?.(error) ?? !isPermanentImageAttemptError(error);
      if (attempt >= IMAGE_PROVIDER_MAX_ATTEMPTS || !retryable) throw error;
      console.warn('image_provider_attempt_retrying', {
        jobId: input.jobId,
        stage: typeof input.stage === 'function' ? input.stage() : input.stage,
        attempt: attempt + 1,
        maxAttempts: IMAGE_PROVIDER_MAX_ATTEMPTS,
        ...diagnostic,
        ...generationFailureDiagnostic(error),
      });
    }
  }
  throw new ConfigurationError('Image provider attempts exhausted');
}

function isPermanentImageAttemptError(error: unknown): boolean {
  if (error instanceof ValidationError) return true;
  if (!(error instanceof ConfigurationError)) return false;
  const message = error.message.toLowerCase();
  return message.includes('received an invalid image input')
    || message.includes('received an unsupported image input type')
    || message.includes('received an empty image input')
    || message.includes('received an input image that is too large')
    || message.includes('insufficient quota')
    || message.includes('billing')
    || message.includes('invalid api key')
    || message.includes('unauthorized')
    || message.includes('permission');
}

function safeImageAttemptDiagnostic(error: unknown): {
  errorCode: string;
  errorType: string;
  safeReason: string;
} {
  if (error instanceof ValidationError) {
    return { errorCode: 'INPUT_INVALID', errorType: 'validation', safeReason: 'image input validation failed' };
  }
  if (error instanceof ConfigurationError) {
    const timeout = error.message.toLowerCase().includes('timed out');
    return timeout
      ? { errorCode: 'PROVIDER_TIMEOUT', errorType: 'timeout', safeReason: 'image provider timed out' }
      : { errorCode: 'PROVIDER_RESPONSE_INVALID', errorType: 'configuration', safeReason: 'image provider response was unusable' };
  }
  return { errorCode: 'PROVIDER_REQUEST_FAILED', errorType: 'provider', safeReason: 'image provider request failed' };
}
