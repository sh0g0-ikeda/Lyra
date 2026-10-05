import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  LegacyAccountDeletionExternalCallContext,
  LegacyAccountDeletionExternalEffectState,
} from './LegacyAccountDeletionTypes.js';

export interface LegacyAccountAssetTag {
  Key: string;
  Value: string;
}

export interface LegacyAccountAssetLifecycleClient {
  getObjectTags(input: {
    bucketName: string;
    key: string;
    signal: AbortSignal;
  }): Promise<readonly LegacyAccountAssetTag[]>;
  putObjectTags(input: {
    bucketName: string;
    key: string;
    tags: readonly LegacyAccountAssetTag[];
    signal: AbortSignal;
  }): Promise<void>;
}

export interface LegacyAccountAssetLifecyclePort {
  scheduleDeletion(key: string, context: LegacyAccountDeletionExternalCallContext): Promise<void>;
  reconcileDeletionSchedule(
    key: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<LegacyAccountDeletionExternalEffectState>;
}

export class LegacyAccountAssetLifecycle implements LegacyAccountAssetLifecyclePort {
  private readonly bucketName: string;
  private readonly timeoutMs: number;

  public constructor(
    private readonly client: LegacyAccountAssetLifecycleClient,
    options: { bucketName: string; timeoutMs?: number },
  ) {
    this.bucketName = options.bucketName.trim();
    if (this.bucketName.length === 0) {
      throw new ConfigurationError('S3 image bucket name is required');
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 600_000) {
      throw new ConfigurationError('S3 account asset lifecycle timeout is invalid');
    }
  }

  public async scheduleDeletion(
    key: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<void> {
    assertAccountAssetKey(key);
    try {
      const tags = await this.client.getObjectTags({
        bucketName: this.bucketName,
        key,
        signal: this.buildSignal(context),
      });
      if (tags.some((tag) => tag.Key === DELETION_TAG.Key && tag.Value === DELETION_TAG.Value)) return;
      const retained = tags.filter((tag) => tag.Key !== DELETION_TAG.Key);
      if (retained.length >= MAX_S3_OBJECT_TAGS) {
        throw new ConfigurationError('S3 account asset has no free lifecycle tag slot');
      }
      await this.client.putObjectTags({
        bucketName: this.bucketName,
        key,
        tags: [...retained, DELETION_TAG],
        signal: this.buildSignal(context),
      });
    } catch (error: unknown) {
      if (isMissingObject(error)) return;
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError('Failed to schedule account asset deletion');
    }
  }

  public async reconcileDeletionSchedule(
    key: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<LegacyAccountDeletionExternalEffectState> {
    assertAccountAssetKey(key);
    try {
      const tags = await this.client.getObjectTags({
        bucketName: this.bucketName,
        key,
        signal: this.buildSignal(context),
      });
      return tags.some((tag) => tag.Key === DELETION_TAG.Key && tag.Value === DELETION_TAG.Value)
        ? 'applied'
        : 'unknown';
    } catch (error: unknown) {
      if (isMissingObject(error)) return 'applied';
      throw new ConfigurationError('Failed to reconcile account asset deletion');
    }
  }

  private buildSignal(context: LegacyAccountDeletionExternalCallContext): AbortSignal {
    const deadlineRemainingMs = Math.max(1, context.deadlineAt - Date.now());
    return AbortSignal.any([
      context.signal,
      AbortSignal.timeout(Math.min(this.timeoutMs, deadlineRemainingMs)),
    ]);
  }
}

const MAX_S3_OBJECT_TAGS = 10;
const MAX_S3_OBJECT_KEY_BYTES = 1_024;
const IMAGE_OBJECT_KEY_EXTENSION_PATTERN = /\.(?:jpe?g|png|webp)$/iu;
const DELETION_TAG: LegacyAccountAssetTag = { Key: 'lyra-deletion-state', Value: 'pending' };

// Only server-generated personal import keys join the existing saved-key reservation contract.
// The token inventory supplies scope/expiry; a pending tag does not prove physical deletion.
const TEMPORARY_IMPORT_KEY_PATTERN = /^tmp\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/entities\/imports\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpeg|png|webp)$/u;

function assertAccountAssetKey(key: string): void {
  if (
    key.trim().length === 0
    || Buffer.byteLength(key, 'utf8') > MAX_S3_OBJECT_KEY_BYTES
    || (!key.startsWith('saved/') && !TEMPORARY_IMPORT_KEY_PATTERN.test(key))
    || !IMAGE_OBJECT_KEY_EXTENSION_PATTERN.test(key)
    || key.startsWith('/')
    || key.includes('\\')
    || key.includes('//')
    || /[\u0000-\u001F\u007F]/u.test(key)
    || key.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new ConfigurationError('S3 account asset key is invalid');
  }
}

function isMissingObject(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    && (error.name === 'NoSuchKey' || error.name === 'NotFound');
}
