import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import type { EpisodePagePlanApplyResult } from '../../../src/domain/types/page.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
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

class AttemptCapturingClient extends ProfileCapturingClient {
  public override async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    if (text.includes('generation_jobs')) {
      this.queries.push(text);
      this.values.push(values);
      const rows = [attemptJobRow()];
      return { command: text.includes('UPDATE') ? 'UPDATE' : 'SELECT', rowCount: 1, oid: 0, fields: [], rows: rows as unknown as T[] };
    }
    return super.query(text, values);
  }
}

class OrganizationAttemptCapturingClient extends ProfileCapturingClient {
  public constructor(private readonly membershipRole: unknown = 'editor') {
    super();
  }

  public override async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);
    const rows = text.includes('generation_jobs')
      ? [attemptJobRow('organization-1')]
      : text.includes('FROM users')
        ? [{ id: 'user-1' }]
        : text.includes('FROM organizations')
          ? [{ id: 'organization-1' }]
          : text.includes('FROM organization_members') && text.includes('FOR SHARE')
            ? [{ organization_id: 'organization-1', user_id: 'user-1', status: 'active', role: this.membershipRole }]
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
                : [];
    return {
      command: text.includes('UPDATE') ? 'UPDATE' : 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
  }
}

class GraphErrorClient extends AttemptCapturingClient {
  public readonly graphError: Error & { code: string };

  public constructor(code: string) {
    super();
    this.graphError = Object.assign(new Error(`postgres ${code}`), { code });
  }

  public override async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    if (text.includes('FOR UPDATE OF works, chapters, episodes')) throw this.graphError;
    return super.query<T>(text, values);
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
      async (_context, resources) => {
        await resources.pageRepository.updatePageSettings(
          'page-1',
          'user-1',
          { dialogueMode: 'mixed' },
        );
        return resources.completeStoryAutofillJob?.('job-1', 'user-1', completedPlan);
      },
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

  it('legacy queued attemptはactual job読取後にusers・request・registry・job・graph順で同一TX確定する', async () => {
    const client = new AttemptCapturingClient();
    const repository = new PostgresEpisodePlanPersistenceRepository(client, 'legacy_2debe_v1');
    const job = attemptJob();

    await expect(repository.withLockedEpisodePlan(
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null, storyAutofillAttempt: job },
      async (_context, resources) => {
        expect(resources.storyAutofillCommitStarted).toBe(true);
        return resources.updateStoryAutofillProgress?.({
          stage: 'applying', message: 'saving', currentChunk: null, totalChunks: null,
        });
      },
    )).resolves.toBe(true);

    const classify = client.queries.map((query) => {
      if (query.includes('FROM generation_jobs') && query.includes('FOR UPDATE')) return 'job-lock';
      if (query.includes('FROM generation_jobs')) return 'job-read';
      if (query.includes('FROM users')) return 'user';
      if (query.includes('account_deletion_requests')) return 'request';
      if (query.includes('pg_advisory_xact_lock')) return 'registry';
      if (query.includes('SET commit_started_at')) return 'commit-cas';
      if (query.includes('FOR UPDATE OF works')) return 'graph';
      return 'other';
    });
    expect(classify.indexOf('user')).toBeGreaterThan(classify.indexOf('job-read'));
    expect(classify.indexOf('request')).toBeGreaterThan(classify.indexOf('user'));
    expect(classify.indexOf('registry')).toBeGreaterThan(classify.indexOf('request'));
    expect(classify.indexOf('job-lock')).toBeGreaterThan(classify.indexOf('registry'));
    expect(classify.indexOf('commit-cas')).toBeGreaterThan(classify.indexOf('job-lock'));
    expect(classify.indexOf('graph')).toBeGreaterThan(classify.indexOf('commit-cas'));
    expect(client.transactionCount).toBe(1);
  });

  it('legacy org attemptはusers・organization・registry・job・membership・NOWAIT graph順で確定する', async () => {
    const client = new OrganizationAttemptCapturingClient();
    const repository = new PostgresEpisodePlanPersistenceRepository(client, 'legacy_2debe_v1');
    const job = attemptJob('organization-1');

    await expect(repository.withLockedEpisodePlan(
      { episodeId: 'episode-1', userId: 'user-1', organizationId: 'organization-1', storyAutofillAttempt: job },
      async () => true,
    )).resolves.toBe(true);

    const classify = client.queries.map((query) => {
      if (query.includes('FROM generation_jobs') && query.includes('FOR UPDATE')) return 'job-lock';
      if (query.includes('FROM generation_jobs')) return 'job-read';
      if (query.includes('FROM users')) return 'user';
      if (query.includes('FROM organizations')) return 'organization';
      if (query.includes('pg_advisory_xact_lock')) return 'registry';
      if (query.includes('SET commit_started_at')) return 'commit-cas';
      if (query.includes('FROM organization_members') && query.includes('FOR SHARE')) return 'membership';
      if (query.includes('FOR UPDATE OF works')) return 'graph';
      return 'other';
    });
    expect(classify.indexOf('user')).toBeGreaterThan(classify.indexOf('job-read'));
    expect(classify.indexOf('organization')).toBeGreaterThan(classify.indexOf('user'));
    expect(classify.indexOf('registry')).toBeGreaterThan(classify.indexOf('organization'));
    expect(classify.indexOf('job-lock')).toBeGreaterThan(classify.indexOf('registry'));
    expect(classify.indexOf('commit-cas')).toBeGreaterThan(classify.indexOf('job-lock'));
    expect(classify.indexOf('membership')).toBeGreaterThan(classify.indexOf('commit-cas'));
    expect(classify.indexOf('graph')).toBeGreaterThan(classify.indexOf('membership'));
    const graphLocks = client.queries
      .slice(classify.indexOf('graph'))
      .filter((query) => query.includes('FOR UPDATE'))
      .slice(0, 8);
    expect(graphLocks).toHaveLength(8);
    expect(graphLocks.every((query) => query.includes('NOWAIT'))).toBe(true);
  });

  it.each(['owner', 'admin', 'editor'] as const)(
    'legacy org attemptはactive %sのedit_workを確定時に許可する', async (role) => {
      const client = new OrganizationAttemptCapturingClient(role);
      const repository = new PostgresEpisodePlanPersistenceRepository(client, 'legacy_2debe_v1');

      await expect(repository.withLockedEpisodePlan(
        {
          episodeId: 'episode-1', userId: 'user-1', organizationId: 'organization-1',
          storyAutofillAttempt: attemptJob('organization-1'),
        },
        async () => true,
      )).resolves.toBe(true);
    },
  );

  it.each(['viewer', 'billing', 'unexpected'] as const)(
    'legacy org attemptはactive %sのedit_work欠如をfail closedにする', async (role) => {
      const client = new OrganizationAttemptCapturingClient(role);
      const repository = new PostgresEpisodePlanPersistenceRepository(client, 'legacy_2debe_v1');

      await expect(repository.withLockedEpisodePlan(
        {
          episodeId: 'episode-1', userId: 'user-1', organizationId: 'organization-1',
          storyAutofillAttempt: attemptJob('organization-1'),
        },
        async () => true,
      )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it('legacy attemptのgraph NOWAIT競合55P03だけをstable conflictへ変換する', async () => {
    const client = new GraphErrorClient('55P03');
    const repository = new PostgresEpisodePlanPersistenceRepository(client, 'legacy_2debe_v1');

    await expect(repository.withLockedEpisodePlan(
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null, storyAutofillAttempt: attemptJob() },
      async () => undefined,
    )).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('legacy attemptのgraph error 40P01は変換せず再throwする', async () => {
    const client = new GraphErrorClient('40P01');
    const repository = new PostgresEpisodePlanPersistenceRepository(client, 'legacy_2debe_v1');

    await expect(repository.withLockedEpisodePlan(
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null, storyAutofillAttempt: attemptJob() },
      async () => undefined,
    )).rejects.toBe(client.graphError);
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
    expect(queries).not.toContain('NOWAIT');
  });
});

function attemptJob(organizationId: string | null = null): GenerationJob {
  return {
    id: 'job-1', userId: 'user-1', organizationId,
    jobType: 'episode_story_autofill', status: 'processing', generationMode: null,
    creditCost: 0, params: { episode_id: 'episode-1', language: 'ja' }, result: null,
    sqsMessageId: null, openaiRequestId: null, errorMessage: null, retryCount: 0,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    startedAt: new Date('2026-10-01T00:00:01.123Z'), completedAt: null, expiresAt: null,
    cancelRequestedAt: null, cancelRequestedBy: null, cancelledAt: null, commitStartedAt: null,
  };
}

function attemptJobRow(organizationId: string | null = null): QueryResultRow {
  const job = attemptJob(organizationId);
  return {
    id: job.id, user_id: job.userId, organization_id: organizationId, job_type: job.jobType,
    status: 'processing', generation_mode: null, credit_cost: 0, params: job.params, result: null,
    sqs_message_id: null, openai_request_id: null, error_message: null, retry_count: 0,
    created_at: job.createdAt, started_at: job.startedAt, completed_at: null, expires_at: null,
    cancel_requested_at: null, cancel_requested_by: null, cancelled_at: null, commit_started_at: null,
  };
}
