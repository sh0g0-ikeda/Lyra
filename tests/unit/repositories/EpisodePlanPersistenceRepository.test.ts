import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import type { EpisodePagePlanApplyResult } from '../../../src/domain/types/page.js';
import { PostgresEpisodePlanPersistenceRepository } from '../../../src/repositories/EpisodePlanPersistenceRepository.js';

class LockCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public transactionCount = 0;
  public values: Array<readonly unknown[] | undefined> = [];

  public constructor(private readonly authorizeEpisode: boolean) {}

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);
    const isAuthorizationLock = text.includes('FOR UPDATE OF works, chapters, episodes');
    const rows = isAuthorizationLock && this.authorizeEpisode
      ? [{ episode_id: 'episode-1' }]
      : [];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
  }
}

class ProfileCapturingClient extends LockCapturingClient {
  public constructor() {
    super(true);
  }

  public override async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);
    const rows = text.includes('FROM users')
      ? [{ id: 'user-1' }]
      : text.includes('account_deletion_requests')
        ? []
        : text.includes('FOR UPDATE OF works, chapters, episodes')
      ? [{ episode_id: 'episode-1' }]
      : text.includes('SELECT episodes.id AS episode_id')
        ? [{
          episode_id: 'episode-1', work_id: 'work-1', chapter_id: 'chapter-1',
          chapter_title: null, chapter_purpose: null, chapter_starting_state: null,
          chapter_ending_state: null, chapter_emotion_curve: null, chapter_key_beats: [],
          episode_title: null, episode_purpose: null, story_full_draft: null,
          introduction: null, middle: null, climax: null, ending_hook: null,
          estimated_pages: 1, starting_entity_states: [], state_library: [], scenes: [], entities: [],
        }]
        : text.includes('UPDATE generation_jobs')
          ? [{
            id: 'job-1', user_id: 'user-1', organization_id: null,
            cancel_requested_at: null, cancelled_at: null, retry_count: 0,
          }]
          : [];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
  }
}

const completedPlan: EpisodePagePlanApplyResult = {
  updatedPageCount: 0,
  updatedPanelCount: 0,
  updatedAssignmentCount: 0,
  filledFieldCount: 0,
  compilerUsed: false,
  compilerProvider: 'fallback',
  compilerModel: null,
  compilerPromptVersion: null,
  compilerError: null,
};

describe('PostgresEpisodePlanPersistenceRepository', () => {
  it('対象の話にアクセスできない場合はロックも保存も行わない', async () => {
    const client = new LockCapturingClient(false);
    const repository = new PostgresEpisodePlanPersistenceRepository(client);

    await expect(repository.withLockedEpisodePlan(
      {
        episodeId: 'episode-1',
        userId: 'user-1',
        organizationId: '11111111-1111-4111-8111-111111111111',
      },
      async () => undefined,
    )).rejects.toBeInstanceOf(NotFoundError);

    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
  });

  it('確定前に話からキャラ状態までを一定順序でロックする', async () => {
    const client = new LockCapturingClient(true);
    const repository = new PostgresEpisodePlanPersistenceRepository(client);

    await expect(repository.withLockedEpisodePlan(
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null },
      async () => undefined,
    )).rejects.toBeInstanceOf(NotFoundError);

    expect(client.queries.slice(0, 8).map((query) => {
      if (query.includes('FOR UPDATE OF works, chapters, episodes')) return 'episode';
      if (query.includes('FROM scenes')) return 'scenes';
      if (query.includes('FROM pages') && !query.includes('INNER JOIN')) return 'pages';
      if (query.includes('FROM panels')) return 'panels';
      if (query.includes('FROM panel_frames')) return 'frames';
      if (query.includes('FROM entities')) return 'entities';
      if (query.includes('FROM reference_sets')) return 'reference_sets';
      if (query.includes('FROM entity_states')) return 'entity_states';
      return 'unknown';
    })).toEqual([
      'episode',
      'scenes',
      'pages',
      'panels',
      'frames',
      'entities',
      'reference_sets',
      'entity_states',
    ]);
  });

  it('legacy profile の transaction は旧 planning query と旧 terminal notification 契約を使う', async () => {
    const client = new ProfileCapturingClient();
    const repository = new PostgresEpisodePlanPersistenceRepository(client, 'legacy_2debe_v1');

    await expect(repository.withLockedEpisodePlan(
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null },
      async (_context, resources) => resources.completeStoryAutofillJob?.('job-1', 'user-1', completedPlan),
    )).resolves.toBe(true);

    const queries = client.queries.join('\n');
    expect(client.transactionCount).toBe(1);
    expect(client.queries[0]).toContain('FROM users');
    expect(client.queries[1]).toContain('account_deletion_requests');
    expect(client.queries[2]).toContain('FOR UPDATE OF works, chapters, episodes');
    expect(queries).toContain("'[]'::jsonb AS starting_entity_states");
    expect(queries).not.toContain('episodes.starting_entity_states');
    expect(queries).not.toContain('INSERT INTO mobile_push_notification_outbox');
  });

  it('profile omitted transaction は canonical planning と terminal notification 契約を保つ', async () => {
    const client = new ProfileCapturingClient();
    const repository = new PostgresEpisodePlanPersistenceRepository(client);

    await expect(repository.withLockedEpisodePlan(
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null },
      async (_context, resources) => resources.completeStoryAutofillJob?.('job-1', 'user-1', completedPlan),
    )).resolves.toBe(true);

    const queries = client.queries.join('\n');
    expect(client.transactionCount).toBe(1);
    expect(queries).not.toContain('account_deletion_requests');
    expect(queries).toContain('episodes.starting_entity_states');
    expect(queries).toContain('INSERT INTO mobile_push_notification_outbox');
  });
});
