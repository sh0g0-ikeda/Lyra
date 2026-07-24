import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresStoryRepository } from '../../../src/repositories/StoryRepository.js';
import { decodeListCursor } from '../../../src/domain/pagination.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;
  public pageRows: Record<string, unknown>[] | null = null;
  public lockRow: Record<string, unknown> = {
    id: '33333333-3333-4333-8333-333333333333',
    page_skeleton_generated: false,
    existing_page_count: 0,
    rollback_safe_page_count: 0,
  };

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values = values;

    if (text.includes('ORDER BY works.updated_at DESC, works.id DESC')) {
      return {
        command: 'SELECT',
        rowCount: this.pageRows?.length ?? 0,
        oid: 0,
        fields: [],
        rows: (this.pageRows ?? []) as T[],
      };
    }

    if (text.includes('FOR UPDATE')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [this.lockRow] as unknown as T[],
      };
    }

    if (text.includes('RETURNING id')) {
      return {
        command: 'INSERT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ id: 'generated-id' }] as unknown as T[],
      };
    }

    return {
      command: 'UPDATE',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [workRow()] as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

class UniqueViolationClient implements DatabaseClient {
  public async query<T extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<T>> {
    throw {
      code: '23505',
      constraint: 'chapters_work_id_order_key',
    };
  }
}

class ExistingSkeletonClient implements DatabaseClient, TransactionRunner {
  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    if (text.includes('FOR UPDATE')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            page_skeleton_generated: true,
            existing_page_count: 0,
            rollback_safe_page_count: 0,
          },
        ] as unknown as T[],
      };
    }

    return {
      command: 'UPDATE',
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

class EpisodeUpdateCapturingClient implements DatabaseClient {
  public updateValues: readonly unknown[] | null = null;
  public updateQuery: string | null = null;

  public constructor(private readonly currentEpisodeRow: Record<string, unknown> = episodeRow()) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    if (text.includes('SELECT episodes.*')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [this.currentEpisodeRow] as unknown as T[],
      };
    }

    if (text.includes('UPDATE episodes')) {
      this.updateQuery = text;
      this.updateValues = values ?? [];
      return {
        command: 'UPDATE',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            ...this.currentEpisodeRow,
            purpose: this.updateValues[6] as string | null,
            story_input_mode: this.updateValues[8] as 'structured' | 'full',
            story_full_draft: this.updateValues[10] as string | null,
            introduction: this.updateValues[12] as string | null,
            middle: this.updateValues[14] as string | null,
            climax: this.updateValues[16] as string | null,
            ending_hook: this.updateValues[18] as string | null,
          },
        ] as unknown as T[],
      };
    }

    return {
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [],
    };
  }
}

class CrossChapterEpisodeMoveClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public inputs: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  public transactionCount = 0;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.inputs.push({ text, values });

    if (text.includes('FOR UPDATE OF works')) {
      return queryResult([{ id: '11111111-1111-4111-8111-111111111111' }] as unknown as T[]);
    }
    if (text.includes('AS chapter_order')) {
      return queryResult([
        {
          ...episodeRow(),
          work_id: '11111111-1111-4111-8111-111111111111',
          chapter_order: 1,
        },
      ] as unknown as T[]);
    }
    if (text.includes('episodes.chapter_id = $1')) {
      return queryResult([] as unknown as T[]);
    }
    if (text.includes('chapters.work_id = $1')) {
      return queryResult([
        {
          id: '44444444-4444-4444-8444-444444444444',
          work_id: '11111111-1111-4111-8111-111111111111',
          order: 2,
          title: 'Chapter 2',
          purpose: null,
          starting_state: null,
          ending_state: null,
          emotion_curve: null,
          entities_involved: [],
          key_beats: [],
          version: 1,
          edit_history: [],
          status: 'draft',
          created_at: new Date('2026-04-22T00:00:00.000Z'),
          updated_at: new Date('2026-04-22T00:00:00.000Z'),
        },
      ] as unknown as T[]);
    }
    if (text.includes('chapters.id = ANY')) {
      return queryResult([
        { id: '22222222-2222-4222-8222-222222222222' },
        { id: '44444444-4444-4444-8444-444444444444' },
      ] as unknown as T[]);
    }
    if (text.includes('episodes.chapter_id = ANY')) {
      return queryResult([
        episodeRow(),
        {
          ...episodeRow(),
          id: '66666666-6666-4666-8666-666666666666',
          order: 2,
        },
        {
          ...episodeRow(),
          id: '55555555-5555-4555-8555-555555555555',
          chapter_id: '44444444-4444-4444-8444-444444444444',
          order: 1,
        },
      ] as unknown as T[]);
    }
    if (text.includes('SET chapter_id = $2')) {
      return queryResult([
        {
          ...episodeRow(),
          chapter_id: '44444444-4444-4444-8444-444444444444',
          order: 1,
          version: 2,
        },
      ] as unknown as T[]);
    }

    return queryResult([] as unknown as T[]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }
}

describe('PostgresStoryRepository', () => {
  it('writes edit_history into update SQL', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await repository.updateWork('11111111-1111-4111-8111-111111111111', 'user-1', {
      title: 'Lyra Revised',
      expectedUpdatedAt: '2026-04-22T00:00:00.000Z',
    });

    expect(client.queries[0]).toContain('edit_history');
    expect(client.queries[0]).toContain('works.updated_at = $20::timestamptz');
    expect(client.values?.[19]).toBe('2026-04-22T00:00:00.000Z');
    expect(client.queries[0]).toContain('jsonb_build_object');
    expect(client.queries[0]).toContain('LIMIT 5');
  });

  it('requires active organization membership when listing organization works', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await repository.findWorksByUserId('user-1', '11111111-1111-4111-8111-111111111111');

    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain('organization_members.user_id = $1');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
    expect(client.values).toEqual(['user-1', '11111111-1111-4111-8111-111111111111']);
  });

  it('requires active organization membership when reading an organization work', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await repository.findWorkByIdAndUserId(
      '22222222-2222-4222-8222-222222222222',
      'user-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain('organization_members.user_id = $2');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
    expect(client.values).toEqual([
      '22222222-2222-4222-8222-222222222222',
      'user-1',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('requires active organization membership when updating an organization work', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await repository.updateWork(
      '22222222-2222-4222-8222-222222222222',
      'user-1',
      { title: 'Enterprise Work', expectedUpdatedAt: '2026-04-22T00:00:00.000Z' },
      '11111111-1111-4111-8111-111111111111',
    );

    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain('organization_members.user_id = $2');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
    expect(client.values?.[0]).toBe('22222222-2222-4222-8222-222222222222');
    expect(client.values?.[1]).toBe('user-1');
    expect(client.values?.[18]).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('maps duplicate chapter order to VALIDATION_ERROR', async () => {
    const repository = new PostgresStoryRepository(new UniqueViolationClient());

    await expect(
      repository.createChapter('11111111-1111-4111-8111-111111111111', {
        order: 1,
        title: 'Chapter 1',
        purpose: null,
        startingState: null,
        endingState: null,
        emotionCurve: null,
        entitiesInvolved: [],
        keyBeats: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('uses user ownership checks and scene summaries in episode collaboration SQL', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await repository.findCollaborationTargetByIdAndUserId(
      'episode',
      '33333333-3333-4333-8333-333333333333',
      'user-1',
    );

    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.queries[0]).toContain('FROM episodes');
    expect(client.queries[0]).toContain('FROM scenes');
  });

  it('includes scene summaries in page skeleton context SQL', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await repository.findEpisodePageSkeletonContextByIdAndUserId(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
    );

    expect(client.queries[0]).toContain('scene_summaries');
    expect(client.queries[0]).toContain('FROM scenes');
  });

  it('creates pages, panels, and the episode flag inside one transaction', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client, client);

    await repository.createPageSkeleton(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      [
        {
          pageNumber: 1,
          purpose: 'Set the confrontation',
          suggestedPanelCount: 4,
          suggestedLayout: 'standard_4',
          panels: [
            {
              order: 1,
              panelRole: 'establish',
              suggestedSize: 'large',
              situationHint: 'Wide rooftop at night.',
              suggestedEntities: ['11111111-1111-4111-8111-111111111111'],
              suggestedDialogueHint: null,
            },
          ],
        },
      ],
    );

    expect(client.queries[0]).toContain('FOR UPDATE');
    expect(client.queries.some((query) => query.includes('INSERT INTO pages'))).toBe(true);
    expect(client.queries.some((query) => query.includes('INSERT INTO panels'))).toBe(true);
    expect(client.queries.some((query) => query.includes('INSERT INTO panel_frames'))).toBe(true);
    expect(client.queries.some((query) => query.includes('page_skeleton_generated = TRUE'))).toBe(true);
  });

  it('deletes existing pages first when overwriteExisting is enabled', async () => {
    const client = new QueryCapturingClient();
    client.lockRow = {
      id: '33333333-3333-4333-8333-333333333333',
      page_skeleton_generated: true,
      existing_page_count: 2,
    };
    const repository = new PostgresStoryRepository(client, client);

    const result = await repository.createPageSkeleton(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      [],
      { overwriteExisting: true },
    );

    expect(client.queries.some((query) => query.includes('DELETE FROM pages'))).toBe(true);
    expect(result).toEqual({
      pagesCreated: 0,
      panelsCreated: 0,
      replacedExisting: true,
    });
  });

  it('rolls back only the expected fresh page skeleton for the owning user', async () => {
    const client = new QueryCapturingClient();
    client.lockRow = {
      id: '33333333-3333-4333-8333-333333333333',
      page_skeleton_generated: true,
      existing_page_count: 2,
      rollback_safe_page_count: 2,
    };
    const repository = new PostgresStoryRepository(client, client);

    const rolledBack = await repository.rollbackFreshPageSkeleton(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      2,
    );

    expect(rolledBack).toBe(true);
    expect(client.queries[0]).toContain('works.user_id = $2');
    expect(client.queries[0]).toContain('FOR UPDATE');
    expect(client.queries[0]).toContain('rollback_safe_page_count');
    expect(client.queries.some((query) => query.includes('DELETE FROM pages'))).toBe(true);
    expect(client.queries.some((query) => query.includes("status = 'designing'"))).toBe(true);
    expect(client.queries.some((query) => query.includes('generated_image IS NULL'))).toBe(true);
    expect(client.queries.some((query) => query.includes('page_skeleton_generated = FALSE'))).toBe(true);
  });

  it('does not rollback when a generated or non-designing page is mixed in', async () => {
    const client = new QueryCapturingClient();
    client.lockRow = {
      id: '33333333-3333-4333-8333-333333333333',
      page_skeleton_generated: true,
      existing_page_count: 2,
      rollback_safe_page_count: 1,
    };
    const repository = new PostgresStoryRepository(client, client);

    const rolledBack = await repository.rollbackFreshPageSkeleton(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      2,
    );

    expect(rolledBack).toBe(false);
    expect(client.queries.some((query) => query.includes('DELETE FROM pages'))).toBe(false);
  });

  it('does not rollback a page skeleton when the expected page count differs', async () => {
    const client = new QueryCapturingClient();
    client.lockRow = {
      id: '33333333-3333-4333-8333-333333333333',
      page_skeleton_generated: true,
      existing_page_count: 3,
      rollback_safe_page_count: 3,
    };
    const repository = new PostgresStoryRepository(client, client);

    const rolledBack = await repository.rollbackFreshPageSkeleton(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      2,
    );

    expect(rolledBack).toBe(false);
    expect(client.queries.some((query) => query.includes('DELETE FROM pages'))).toBe(false);
  });

  it('rechecks existing skeletons inside the transaction', async () => {
    const repository = new PostgresStoryRepository(new ExistingSkeletonClient(), new ExistingSkeletonClient());

    await expect(
      repository.createPageSkeleton(
        '33333333-3333-4333-8333-333333333333',
        'user-1',
        [],
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('treats null episode story fields as explicit clears during partial updates', async () => {
    const client = new EpisodeUpdateCapturingClient();
    const repository = new PostgresStoryRepository(client);

    const episode = await repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      {
        expectedUpdatedAt: '2026-04-22T00:00:00.000Z',
        purpose: null,
        introduction: null,
        middle: null,
        climax: null,
        endingHook: null,
      },
    );

    expect(episode).toMatchObject({
      purpose: null,
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
    });
    expect(client.updateValues?.[6]).toBeNull();
    expect(client.updateValues?.[12]).toBeNull();
    expect(client.updateValues?.[14]).toBeNull();
    expect(client.updateValues?.[16]).toBeNull();
    expect(client.updateValues?.[18]).toBeNull();
  });

  it('treats null full story draft as an explicit clear during partial updates', async () => {
    const client = new EpisodeUpdateCapturingClient({
      ...episodeRow(),
      story_input_mode: 'full',
      story_full_draft: 'Stored full draft',
      introduction: 'Derived introduction',
      middle: 'Derived middle',
      climax: 'Derived climax',
      ending_hook: 'Derived ending',
    });
    const repository = new PostgresStoryRepository(client);

    const episode = await repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      {
        expectedUpdatedAt: '2026-04-22T00:00:00.000Z',
        storyFullDraft: null,
      },
    );

    expect(episode).toMatchObject({
      storyInputMode: 'full',
      storyFullDraft: null,
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
    });
    expect(client.updateValues?.[10]).toBeNull();
    expect(client.updateValues?.[12]).toBeNull();
    expect(client.updateValues?.[14]).toBeNull();
    expect(client.updateValues?.[16]).toBeNull();
    expect(client.updateValues?.[18]).toBeNull();
    expect(client.updateQuery).toContain('episodes.updated_at = $25::timestamptz');
    expect(client.updateValues?.[24]).toBe('2026-04-22T00:00:00.000Z');
  });

  it('lists a bounded work page with tenant scope, stable keyset ordering, and a cursor from the last returned row', async () => {
    const client = new QueryCapturingClient();
    client.pageRows = [
      workRow({ id: '11111111-1111-4111-8111-111111111111', updated_at: new Date('2026-04-24T00:00:00.000Z') }),
      workRow({ id: '22222222-2222-4222-8222-222222222222', updated_at: new Date('2026-04-24T00:00:00.000Z') }),
      workRow({ id: '33333333-3333-4333-8333-333333333333', updated_at: new Date('2026-04-23T00:00:00.000Z') }),
    ];
    const repository = new PostgresStoryRepository(client);

    const result = await repository.findWorksPageByUserId('user-1', {
      limit: 2,
      cursor: { sort: '2026-04-25T00:00:00.000Z', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }, '99999999-9999-4999-8999-999999999999');

    expect(result.items.map((work) => work.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(result.nextCursor).toBeTypeOf('string');
    expect(decodeListCursor(result.nextCursor ?? '', 'works')).toEqual({
      sort: '2026-04-24T00:00:00.000Z',
      id: '22222222-2222-4222-8222-222222222222',
    });
    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain('works.updated_at < $3::timestamptz');
    expect(client.queries[0]).toContain('works.updated_at = $3::timestamptz AND works.id < $4::uuid');
    expect(client.queries[0]).toContain('ORDER BY works.updated_at DESC, works.id DESC');
    expect(client.queries[0]).toContain('LIMIT $5');
    expect(client.queries[0]).not.toContain('OFFSET');
    expect(client.queries[0].indexOf("organization_members.status = 'active'")).toBeLessThan(
      client.queries[0].indexOf('works.updated_at < $3::timestamptz'),
    );
    expect(client.values).toEqual([
      'user-1',
      '99999999-9999-4999-8999-999999999999',
      '2026-04-25T00:00:00.000Z',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      3,
    ]);
  });

  it('locks the work and both chapter episode sets before moving a boundary episode', async () => {
    const client = new CrossChapterEpisodeMoveClient();
    const repository = new PostgresStoryRepository(client);

    const moved = await repository.moveEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      'down',
      '77777777-7777-4777-8777-777777777777',
      true,
    );

    expect(moved).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      chapterId: '44444444-4444-4444-8444-444444444444',
      order: 1,
    });
    expect(client.transactionCount).toBe(1);
    expect(client.queries[0]).toContain('FOR UPDATE OF works');
    expect(client.queries[0]).toContain('organization_members.status = \'active\'');
    expect(client.queries.some((query) => query.includes('chapters.id = ANY'))).toBe(true);
    expect(client.queries.some((query) => query.includes('episodes.chapter_id = ANY'))).toBe(true);
    expect(client.queries.some((query) => query.includes('SET chapter_id = $2'))).toBe(true);
    expect(client.queries.some((query) => query.includes('DELETE FROM episodes'))).toBe(false);
    expect(client.queries.some((query) => query.includes('INSERT INTO episodes'))).toBe(false);
    expect(
      client.inputs.some(
        (input) =>
          input.text.includes('SET "order" = $2') &&
          input.values?.[0] === '66666666-6666-4666-8666-666666666666' &&
          input.values?.[1] === 1,
      ),
    ).toBe(true);
    expect(
      client.inputs.some(
        (input) =>
          input.text.includes('SET "order" = $2') &&
          input.values?.[0] === '55555555-5555-4555-8555-555555555555' &&
          input.values?.[1] === 2,
      ),
    ).toBe(true);
  });
});

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function workRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    title: 'Lyra',
    genre: null,
    world_setting: null,
    theme: null,
    main_entity_ids: [],
    starting_point: null,
    ending_point: null,
    overall_flow: null,
    version: 2,
    edit_history: [],
    status: 'draft',
    created_at: new Date('2026-04-22T00:00:00.000Z'),
    updated_at: new Date('2026-04-22T00:00:00.000Z'),
    ...overrides,
  };
}

function episodeRow(): Record<string, unknown> {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    chapter_id: '22222222-2222-4222-8222-222222222222',
    order: 1,
    title: 'Episode',
    purpose: 'Stored purpose',
    story_input_mode: 'structured',
    story_full_draft: null,
    introduction: 'Stored introduction',
    middle: 'Stored middle',
    climax: 'Stored climax',
    ending_hook: 'Stored ending',
    estimated_pages: 8,
    entities_involved: [],
    page_skeleton_generated: false,
    version: 1,
    edit_history: [],
    status: 'draft',
    created_at: new Date('2026-04-22T00:00:00.000Z'),
    updated_at: new Date('2026-04-22T00:00:00.000Z'),
  };
}
