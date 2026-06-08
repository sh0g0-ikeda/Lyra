import { ValidationError } from '../../domain/errors/index.js';
import type { ImageStorageReferenceRepository } from '../../repositories/ImageStorageReferenceRepository.js';

export interface StoredImageObject {
  key: string;
  lastModified: Date | null;
}

export interface ListStoredImageObjectsOptions {
  maxObjects?: number;
}

export interface ListedStoredImageObjects {
  objects: StoredImageObject[];
  truncated: boolean;
}

export interface ImageStorageMaintenancePort {
  listObjects(prefix: string, options?: ListStoredImageObjectsOptions): Promise<ListedStoredImageObjects>;
  deleteObject(key: string): Promise<void>;
}

export interface PruneImageStorageInput {
  prefixes: string[];
  olderThanHours: number;
  protectRecentCandidateHours: number;
  maxDeletes: number;
  maxScanned?: number;
  dryRun: boolean;
  includeSavedUnreferenced?: boolean;
  now?: Date;
}

export interface PruneImageStorageResult {
  dryRun: boolean;
  scanned: number;
  protected: number;
  skippedRecent: number;
  scanTruncated: boolean;
  deleteCandidates: string[];
  deleted: string[];
  truncated: boolean;
}

const DISPOSABLE_PRUNE_PREFIXES = ['tmp/', 'session/'] as const;
const SAVED_PRUNE_PREFIXES = ['saved/'] as const;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Removes only old image objects that are not currently referenced by the DB.
 * Saved pruning is opt-in because those keys may represent durable user assets.
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
    let scanTruncated = false;

    for (const prefix of scannedPrefixes) {
      const remainingScanBudget =
        input.maxScanned === undefined ? undefined : Math.max(0, input.maxScanned - scanned);
      if (remainingScanBudget !== undefined && remainingScanBudget <= 0) {
        scanTruncated = true;
        break;
      }

      const listed = await this.storage.listObjects(prefix, {
        maxObjects: remainingScanBudget,
      });
      scanTruncated = scanTruncated || listed.truncated;

      for (const object of listed.objects) {
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

      if (scanTruncated) {
        break;
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
      scanTruncated,
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
    if (!isAllowedPrunePrefix(prefix, input.includeSavedUnreferenced === true)) {
      throw new ValidationError('Image pruning is limited to tmp/ and session/ prefixes unless saved pruning is enabled');
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

  if (
    input.maxScanned !== undefined &&
    (!Number.isInteger(input.maxScanned) || input.maxScanned <= 0)
  ) {
    throw new ValidationError('maxScanned must be a positive integer');
  }
}

function isAllowedPrunePrefix(prefix: string, includeSavedUnreferenced: boolean): boolean {
  if (prefix.includes('..') || prefix.includes('//') || prefix.startsWith('/')) {
    return false;
  }

  if (matchesAllowedPrefix(prefix, DISPOSABLE_PRUNE_PREFIXES)) {
    return true;
  }

  return includeSavedUnreferenced && matchesAllowedPrefix(prefix, SAVED_PRUNE_PREFIXES);
}

function matchesAllowedPrefix(prefix: string, allowedPrefixes: readonly string[]): boolean {
  return allowedPrefixes.some((allowedPrefix) => (
    prefix === allowedPrefix || (
      prefix.startsWith(allowedPrefix) &&
      prefix.length > allowedPrefix.length
    )
  ));
}
