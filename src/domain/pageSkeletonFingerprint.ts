import { createHash } from 'node:crypto';
import type { EpisodePageSkeletonContext } from './types/storyAi.js';

/** Saved source only. The optional legacy graph digest never enters a prompt. */
export function fingerprintPageSkeletonContext(context: EpisodePageSkeletonContext): string {
  return createHash('sha256').update(JSON.stringify({
    ...context,
    entitiesInvolved: [...context.entitiesInvolved].sort(),
    entities: [...context.entities].sort((left, right) => left.id.localeCompare(right.id)),
  })).digest('hex');
}
