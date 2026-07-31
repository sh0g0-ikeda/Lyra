import type { DatabaseClient } from '../lib/db.js';

const STORY_EPISODE_ADMISSION_LOCK_NAMESPACE = 93_017;

export function storyEpisodeAdmissionLockKey(episodeId: string): string {
  return `story:episode:${episodeId}`;
}

export async function lockStoryEpisodeAdmission(
  client: DatabaseClient,
  episodeId: string,
): Promise<void> {
  await client.query(
    'SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)',
    [STORY_EPISODE_ADMISSION_LOCK_NAMESPACE, storyEpisodeAdmissionLockKey(episodeId)],
  );
}

export async function lockStoryEpisodeAdmissions(
  client: DatabaseClient,
  episodeIds: readonly string[],
): Promise<void> {
  const lockKeys = [...new Set(episodeIds)]
    .sort()
    .map(storyEpisodeAdmissionLockKey);
  if (lockKeys.length === 0) {
    return;
  }
  await client.query(
    `
    WITH ordered_locks AS MATERIALIZED (
      SELECT lock_key
      FROM unnest($2::text[]) AS requested(lock_key)
      ORDER BY lock_key ASC
    )
    SELECT pg_advisory_xact_lock($1::int, hashtext(lock_key)::int)
    FROM ordered_locks
    ORDER BY lock_key ASC
    `,
    [STORY_EPISODE_ADMISSION_LOCK_NAMESPACE, lockKeys],
  );
}
