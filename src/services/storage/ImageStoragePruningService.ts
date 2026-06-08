import { ValidationError } from '../../domain/errors/index.js';
import type { ImageStorageReferenceRepository } from '../../repositories/ImageStorageReferenceRepository.js';

export interface StoredImageObject {
  key: string;
  lastModified: Date | null;
}

export interface ImageStorageMaintenancePort {
  listObjects(prefix: string): Promise<StoredImageObject[]>;
  deleteObject(key: string): Promise<void>;
}

export interface PruneImageStorageInput {
  prefixes: string[];
  olderThanHours: number;
  protectRecentCandidateHours: number;
  maxDeletes: number;
  dryRun: boolean;
  now?: Date;
}

export interface PruneImageStorageResult {
  dryRun: boolean;
  scanned: number;
  protected: number;
  skippedRecent: number;
  deleteCandidates: string[];
  deleted: string[];
  truncated: boolean;
}

const ALLOWED_PRUNE_PREFIXES = ['tmp/', 'session/'] as const;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Removes only disposable image objects. Saved references and final page
 * assets are intentionally outside the allowed prefixes.
 */
export class ImageStoragePruningService {
  public constructor(
    private readonly storage: ImageStorageMaintenancePort,
    private readonly referenceRepository: ImageStorageReferenceRepository,
  ) {}

  public async prune(input: PruneImageStorageInput): Promise<PruneImageStorageResult> {
    validatePruneInput(input);

    const now = input.now ?? new Date();
    const cutoff = new Date(now.getTime() - input.olderThanHours * HOUR_MS);
    const protectedKeys = await this.referenceRepository.findProtectedImageS3Keys({
      protectRecentCandidateHours: input.protectRecentCandidateHours,
    });
    const scannedPrefixes = Array.from(new Set(input.prefixes));
    const deleteCandidateKeys = new Set<string>();
    const deleteCandidates: string[] = [];
    let scanned = 0;
    let protectedCount = 0;
    let skippedRecent = 0;

    for (const prefix of scannedPrefixes) {
      const objects = await this.storage.listObjects(prefix);
      for (const object of objects) {
        scanned += 1;

        if (protectedKeys.has(object.key)) {
          protectedCount += 1;
          continue;
        }

        if (object.lastModified === null || object.lastModified > cutoff) {
          skippedRecent += 1;
          continue;
        }

        if (!deleteCandidateKeys.has(object.key)) {
          deleteCandidateKeys.add(object.key);
          deleteCandidates.push(object.key);
        }
      }
    }

    const keysToDelete = deleteCandidates.slice(0, input.maxDeletes);
    const deleted: string[] = [];

    if (!input.dryRun) {
      for (const key of keysToDelete) {
        await this.storage.deleteObject(key);
        deleted.push(key);
      }
    }

    return {
      dryRun: input.dryRun,
      scanned,
      protected: protectedCount,
      skippedRecent,
      deleteCandidates,
      deleted,
      truncated: deleteCandidates.length > input.maxDeletes,
    };
  }
}

function validatePruneInput(input: PruneImageStorageInput): void {
  if (input.prefixes.length === 0) {
    throw new ValidationError('At least one image prefix is required');
  }

  for (const prefix of new Set(input.prefixes)) {
    if (!isAllowedPrunePrefix(prefix)) {
      throw new ValidationError('Image pruning is limited to tmp/ and session/ prefixes');
    }
  }

  if (!Number.isInteger(input.olderThanHours) || input.olderThanHours <= 0) {
    throw new ValidationError('olderThanHours must be a positive integer');
  }

  if (!Number.isInteger(input.protectRecentCandidateHours) || input.protectRecentCandidateHours <= 0) {
    throw new ValidationError('protectRecentCandidateHours must be a positive integer');
  }

  if (!Number.isInteger(input.maxDeletes) || input.maxDeletes <= 0) {
    throw new ValidationError('maxDeletes must be a positive integer');
  }
}

function isAllowedPrunePrefix(prefix: string): boolean {
  if (prefix.includes('..') || prefix.includes('//') || prefix.startsWith('/')) {
    return false;
  }

  return ALLOWED_PRUNE_PREFIXES.some((allowedPrefix) => (
    prefix === allowedPrefix || (
      prefix.startsWith(allowedPrefix) &&
      prefix.length > allowedPrefix.length
    )
  ));
}
