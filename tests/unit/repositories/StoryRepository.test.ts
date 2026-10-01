import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { computeStateReferenceFingerprint } from '../../../src/domain/state/StateReferenceFingerprint.js';
import { PostgresStoryRepository } from '../../../src/repositories/StoryRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public values: readonly unknown[] | undefined;
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

class EpisodeUpdateCapturingClient implements DatabaseClient, TransactionRunner {
  public updateValues: readonly unknown[] | null = null;
  public queries: string[] = [];
  public updateRowPresent = true;

  public constructor(private readonly currentEpisodeRow: Record<string, unknown> = episodeRow()) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    if (text.includes('SELECT episodes.*')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{
          ...this.currentEpisodeRow,
          ...(text.includes('FOR UPDATE OF episodes')
            ? { work_id: '11111111-1111-4111-8111-111111111111' }
            : {}),
        }] as unknown as T[],
      };
    }

    if (text.includes('UPDATE episodes')) {
      this.updateValues = values ?? [];
      if (!this.updateRowPresent) {
        return {
          command: 'UPDATE', rowCount: 0, oid: 0, fields: [], rows: [],
        };
      }
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

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

class StartingStateLockClient implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public readonly queryValues: Array<readonly unknown[] | undefined> = [];

  public constructor(
    private readonly referenceSet: Record<string, unknown>,
    private readonly entityState: Record<string, unknown>,
    private readonly episodeExists = true,
  ) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.queryValues.push(values);
    if (text.includes('FOR UPDATE OF episodes')) {
      if (!this.episodeExists) {
        return resultRows([]);
      }
      return resultRows([{
        ...episodeRow(),
        work_id: '11111111-1111-4111-8111-111111111111',
      }]);
    }
    if (text.includes('FOR UPDATE OF reference_sets')) {
      return resultRows([this.referenceSet]);
    }
    if (text.includes('FOR UPDATE OF entity_states')) {
      return resultRows([this.entityState]);
    }
    if (text.includes('UPDATE episodes')) {
      return resultRows([episodeRow()], 'UPDATE');
    }
    return resultRows([]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

class CrossChapterEpisodeMoveClient implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public readonly queryValues: Array<readonly unknown[] | undefined> = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.queryValues.push(values);

    if (text.includes('INNER JOIN chapters') && text.includes('FOR UPDATE OF episodes')) {
      return resultRows([
        {
          ...episodeRow(),
          work_id: '11111111-1111-4111-8111-111111111111',
          chapter_order: 1,
        },
      ]);
    }
    if (text.includes('WHERE episodes.chapter_id') && text.includes('LIMIT 1')) {
      return resultRows([]);
    }
    if (text.includes('FROM chapters') && text.includes('chapters.work_id')) {
      return resultRows([
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
      ]);
    }
    if (text.includes('chapter_id = ANY')) {
      return resultRows([
        episodeRow(),
        {
          id: '55555555-5555-4555-8555-555555555555',
          chapter_id: '44444444-4444-4444-8444-444444444444',
          order: 1,
        },
      ]);
    }
    if (text.includes('MAX("order")') && text.includes('FROM episodes')) {
      return resultRows([{ maximum_order: 1, temporary_order: 100001 }]);
    }
    if (text.includes('SET chapter_id = $2')) {
      return resultRows([
        {
          ...episodeRow(),
          chapter_id: '44444444-4444-4444-8444-444444444444',
          order: 1,
          version: 2,
        },
      ], 'UPDATE');
    }

    return resultRows([], text.trimStart().startsWith('SELECT') ? 'SELECT' : 'UPDATE');
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
      { title: 'Enterprise Work' },
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

  it('開始状態の省略は保存済み値を保持し、明示空配列はclearとして保存する', async () => {
    const client = new EpisodeUpdateCapturingClient({
      ...episodeRow(),
      starting_entity_states: [{
        entity_id: '44444444-4444-4444-8444-444444444444',
        state_id: '55555555-5555-4555-8555-555555555555',
      }],
    });
    const repository = new PostgresStoryRepository(client, client);

    const unchanged = await repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      { title: 'Updated' },
    );
    expect(unchanged?.startingEntityStates).toEqual([{
      entityId: '44444444-4444-4444-8444-444444444444',
      stateId: '55555555-5555-4555-8555-555555555555',
    }]);
    expect(client.updateValues?.[23]).toBe(false);

    await repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      { startingEntityStates: [] },
    );
    expect(client.updateValues?.[23]).toBe(true);
    expect(client.updateValues?.[24]).toBe('[]');
  });

  it('開始状態の早期検証はcurrent primary imageと完全なdescriptorを確認する', async () => {
    const client = new EpisodeUpdateCapturingClient();
    const repository = new PostgresStoryRepository(client);

    await expect(repository.validateEpisodeStartingEntityStates(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      [{
        entityId: '44444444-4444-4444-8444-444444444444',
        stateId: '55555555-5555-4555-8555-555555555555',
      }],
    )).resolves.toBe(false);

    const sql = client.queries.at(-1) ?? '';
    expect(sql).toContain('reference_sets.primary_ref_id');
    expect(sql).toContain("primary_image.value->>'s3_key'");
    expect(sql).toContain('input_fingerprint');
    expect(sql).toContain("NULLIF(BTRIM(entity_states.name), '')");
  });

  it('開始状態指定の更新はepisode、reference set、entity stateの順にlockしてから保存する', async () => {
    const client = new StartingStateLockClient(validStartingStateReferenceSet(), validStartingEntityState());
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      { startingEntityStates: [startingEntityStateAssignment()] },
    )).resolves.toMatchObject({ id: '33333333-3333-4333-8333-333333333333' });

    const episodeLock = client.queries.findIndex((query) => query.includes('FOR UPDATE OF episodes'));
    const referenceSetLock = client.queries.findIndex((query) => query.includes('FOR UPDATE OF reference_sets'));
    const entityStateLock = client.queries.findIndex((query) => query.includes('FOR UPDATE OF entity_states'));
    const update = client.queries.findIndex((query) => query.includes('UPDATE episodes'));
    expect(episodeLock).toBeGreaterThanOrEqual(0);
    expect(referenceSetLock).toBeGreaterThan(episodeLock);
    expect(entityStateLock).toBeGreaterThan(referenceSetLock);
    expect(update).toBeGreaterThan(entityStateLock);
    expect(client.queries[update]).not.toContain('digest(');
  });

  it.each([
    ['current primaryが消えた', { primary_ref_id: 'missing-ref' }, validStartingEntityState()],
    ['base_ref_idが差し替わった', validStartingStateReferenceSet(), {
      ...validStartingEntityState(),
      reference_image: { ...validStartingEntityState().reference_image as Record<string, unknown>, base_ref_id: 'other-ref' },
    }],
    ['nameが差し替わった', validStartingStateReferenceSet(), {
      ...validStartingEntityState(), name: '別の名前',
    }],
    ['descriptionが差し替わった', validStartingStateReferenceSet(), {
      ...validStartingEntityState(), description: '別の説明',
    }],
    ['descriptorに非文字列がある', validStartingStateReferenceSet(), {
      ...validStartingEntityState(),
      reference_image: { ...validStartingEntityState().reference_image as Record<string, unknown>, s3_key: 1 },
    }],
  ])('開始状態の%sをtransaction内再検証でconflictにする', async (_caseName, referenceSet, entityState) => {
    const client = new StartingStateLockClient(referenceSet, entityState);
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      { startingEntityStates: [startingEntityStateAssignment()] },
    )).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('base imageの並行差し替えはtransaction内再検証でconflictにする', async () => {
    const replacedPrimary = validStartingStateReferenceSet({
      primary_ref_id: 'replacement-ref',
      reference_images: [{
        ref_id: 'replacement-ref', s3_key: 'replacement.png', cdn_url: 'https://cdn.example/replacement.png',
      }],
    });
    const client = new StartingStateLockClient(replacedPrimary, validStartingEntityState());
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      { startingEntityStates: [startingEntityStateAssignment()] },
    )).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('開始状態指定で未認可または不存在のepisodeは409ではなくnullを返す', async () => {
    const client = new StartingStateLockClient(
      validStartingStateReferenceSet(),
      validStartingEntityState(),
      false,
    );
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      { startingEntityStates: [startingEntityStateAssignment()] },
    )).resolves.toBeNull();
    expect(client.queries.some((query) => query.includes('FOR UPDATE OF reference_sets'))).toBe(false);
  });

  it('開始状態の再検証で0件更新ならnot foundではなくconflictにする', async () => {
    const client = new EpisodeUpdateCapturingClient();
    client.updateRowPresent = false;
    const repository = new PostgresStoryRepository(client, client);

    await expect(repository.updateEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      { startingEntityStates: [] },
    )).rejects.toMatchObject({ code: 'CONFLICT' });
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
  });

  it('章境界移動では同一作品の隣接章を解決して話IDを維持する', async () => {
    const client = new CrossChapterEpisodeMoveClient();
    const repository = new PostgresStoryRepository(client, client);

    const moved = await repository.moveEpisode(
      '33333333-3333-4333-8333-333333333333',
      'user-1',
      'down',
      null,
      true,
    );

    expect(moved).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      chapterId: '44444444-4444-4444-8444-444444444444',
      order: 1,
    });
    expect(client.queries.some((query) => query.includes('chapters.work_id = $1'))).toBe(true);
    expect(client.queries.some((query) => query.includes('SET chapter_id = $2'))).toBe(true);
    expect(client.queryValues).toContainEqual([
      '55555555-5555-4555-8555-555555555555',
      2,
    ]);
  });
});

function resultRows<T extends QueryResultRow = QueryResultRow>(
  rows: QueryResultRow[],
  command: 'SELECT' | 'UPDATE' = 'SELECT',
): QueryResult<T> {
  return {
    command,
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as T[],
  };
}

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

function startingEntityStateAssignment(): { entityId: string; stateId: string } {
  return {
    entityId: '44444444-4444-4444-8444-444444444444',
    stateId: '55555555-5555-4555-8555-555555555555',
  };
}

function validStartingStateReferenceSet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entity_id: startingEntityStateAssignment().entityId,
    primary_ref_id: 'base-ref',
    reference_images: [{
      ref_id: 'base-ref',
      s3_key: 'entities/user-1/base.png',
      cdn_url: 'https://cdn.example/base.png',
    }],
    ...overrides,
  };
}

function validStartingEntityState(): Record<string, unknown> {
  const assignment = startingEntityStateAssignment();
  const name = '負傷';
  const description = '頬に傷がある';
  return {
    id: assignment.stateId,
    entity_id: assignment.entityId,
    name,
    description,
    reference_image: {
      ref_id: 'state-ref',
      s3_key: 'entities/user-1/state.png',
      storage_owner_user_id: 'user-1',
      image_model: 'gpt-image-1',
      base_ref_id: 'base-ref',
      created_at: '2026-09-30T00:00:00.000Z',
      input_fingerprint: computeStateReferenceFingerprint({
        entityId: assignment.entityId,
        stateId: assignment.stateId,
        name,
        description,
        baseRefId: 'base-ref',
      }),
    },
  };
}
