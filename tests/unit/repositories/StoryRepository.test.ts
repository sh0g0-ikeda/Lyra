import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresStoryRepository } from '../../../src/repositories/StoryRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public lockRow: Record<string, unknown> = {
    id: '33333333-3333-4333-8333-333333333333',
    page_skeleton_generated: false,
    existing_page_count: 0,
    protected_page_count: 0,
  };

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);

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
            protected_page_count: 0,
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

describe('PostgresStoryRepository', () => {
  it('writes edit_history into update SQL', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await repository.updateWork('11111111-1111-4111-8111-111111111111', 'user-1', {
      title: 'Lyra Revised',
    });

    expect(client.queries[0]).toContain('edit_history');
    expect(client.queries[0]).toContain('jsonb_build_object');
    expect(client.queries[0]).toContain('LIMIT 5');
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
      protected_page_count: 0,
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
});

function workRow(): Record<string, unknown> {
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
  };
}
