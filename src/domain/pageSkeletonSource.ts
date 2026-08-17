import { createHash } from 'node:crypto';
import type {
  EpisodePageSkeletonContext,
  PageSkeletonPageDraft,
} from './types/storyAi.js';

export interface PreparedPageSkeleton {
  context: EpisodePageSkeletonContext;
  pages: PageSkeletonPageDraft[];
  sourceFingerprint: string;
}

export function fingerprintPageSkeletonSource(
  context: EpisodePageSkeletonContext,
): string {
  return createHash('sha256').update(stableStringify(context)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
