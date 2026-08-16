import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEntityRepository } from '../../../src/repositories/EntityRepository.js';
import { decodeListCursor } from '../../../src/domain/pagination.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public valuesList: Array<readonly unknown[] | undefined> = [];
  public pageRows: Record<string, unknown>[] | null = null;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);

    if (text.includes('ORDER BY entities.created_at DESC, entities.id DESC')) {
      return {
        command: 'SELECT',
        rowCount: this.pageRows?.length ?? 0,
        oid: 0,
        fields: [],
        rows: (this.pageRows ?? []) as T[],
      };
    }

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [row()] as unknown as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresEntityRepository', () => {
  it('create は prompt_supplement を保存する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityRepository(client);

    await repository.create({
      workId: 'work-1',
      userId: 'user-1',
      entityType: 'character',
      name: 'Mizuki',
      freeDescription: null,
      promptSupplement: 'anime heroine',
      structuredFields: { art_style: 'anime' },
      speechProfile: {},
    });

    expect(client.queries[0]).toContain('prompt_supplement');
    expect(client.valuesList[0]?.[5]).toBe('anime heroine');
  });

  it('reference context は user_id で絞る', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityRepository(client);

    const result = await repository.findReferenceContextByIdAndUserId('entity-1', 'user-1');

    expect(client.queries[0]).toContain('entities.user_id = $2');
    expect(client.valuesList[0]).toEqual(['entity-1', 'user-1', null]);
    expect(result).toMatchObject({
      entityId: 'entity-1',
      userId: 'user-1',
      referenceSet: {
        primaryRefId: 'ref-1',
      },
    });
  });

  it('saveConfirmedReferences は reference_sets と entities を更新する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityRepository(client);

    await repository.saveConfirmedReferences({
      entityId: 'entity-1',
      userId: 'user-1',
      primaryRefId: 'ref-2',
      promptSupplement: 'anime heroine',
      images: [
        {
          refId: 'ref-2',
          s3Key: 'saved/user-1/entities/entity-1/ref-2.png',
          cdnUrl: 'https://cdn.lyra.test/saved/user-1/entities/entity-1/ref-2.png',
          source: 'generated',
          createdAt: '2026-04-25T00:00:00.000Z',
        },
      ],
    });

    expect(client.queries[0]).toContain('FOR UPDATE OF reference_sets');
    expect(client.queries[1]).toContain('UPDATE reference_sets');
    expect(client.queries[2]).toContain('UPDATE entities');
    expect(client.queries[2]).toContain('organization_id IS NULL');
    expect(client.valuesList[1]?.[3]).toBe('ref-2');
    expect(client.valuesList[2]?.[3]).toBe('anime heroine');
  });

  it('deleteReferenceImage は個人スコープで法人Workspace内キャラを更新しない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityRepository(client);

    await repository.deleteReferenceImage({
      entityId: 'entity-1',
      userId: 'user-1',
      refId: 'ref-1',
    });

    expect(client.queries[2]).toContain('UPDATE entities');
    expect(client.queries[2]).toContain('organization_id IS NULL');
    expect(client.valuesList[2]).toEqual(['entity-1', 'user-1', 'draft', null]);
  });

  it('update は個人スコープで法人Workspace内キャラを更新しない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityRepository(client);

    await repository.update('entity-1', 'user-1', {
      name: 'Updated',
      expectedUpdatedAt: '2026-04-25T00:00:00.000Z',
    });

    expect(client.queries[0]).toContain('UPDATE entities');
    expect(client.queries[0]).toContain(
      "date_trunc('milliseconds', entities.updated_at) = $14::timestamptz",
    );
    expect(client.queries[0]).toContain('organization_id IS NULL');
    expect(client.valuesList[0]?.[12]).toBeNull();
    expect(client.valuesList[0]?.[13]).toBe('2026-04-25T00:00:00.000Z');
  });

  it('delete は個人スコープで法人Workspace内キャラを削除しない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityRepository(client);

    await repository.delete('entity-1', 'user-1');

    expect(client.queries[0]).toContain('DELETE FROM entities');
    expect(client.queries[0]).toContain('organization_id IS NULL');
    expect(client.valuesList[0]).toEqual(['entity-1', 'user-1', null]);
  });

  it('countEntityStateUsageByReferenceId は user_id で絞る', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityRepository(client);

    await repository.countEntityStateUsageByReferenceId('entity-1', 'user-1', 'ref-1');

    expect(client.queries[0]).toContain('entities.user_id = $2');
    expect(client.valuesList[0]).toEqual(['entity-1', 'user-1', 'ref-1', null]);
  });
  it('lists a bounded entity page with tenant scope and a created_at keyset cursor', async () => {
    const client = new QueryCapturingClient();
    client.pageRows = [
      row({ id: '11111111-1111-4111-8111-111111111111', created_at: new Date('2026-04-24T00:00:00.000Z') }),
      row({ id: '22222222-2222-4222-8222-222222222222', created_at: new Date('2026-04-24T00:00:00.000Z') }),
      row({ id: '33333333-3333-4333-8333-333333333333', created_at: new Date('2026-04-23T00:00:00.000Z') }),
    ];
    const repository = new PostgresEntityRepository(client);

    const result = await repository.findEntitiesPageByWorkIdAndUserId('work-1', 'user-1', {
      limit: 2,
      cursor: { sort: '2026-04-25T00:00:00.000Z', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    }, '99999999-9999-4999-8999-999999999999');

    expect(result.items.map((entity) => entity.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(result.nextCursor).toBeTypeOf('string');
    expect(decodeListCursor(result.nextCursor ?? '', 'entities')).toEqual({
      sort: '2026-04-24T00:00:00.000Z',
      id: '22222222-2222-4222-8222-222222222222',
    });
    expect(client.queries[0]).toContain('FROM organization_members');
    expect(client.queries[0]).toContain('entities.created_at < $4::timestamptz');
    expect(client.queries[0]).toContain('entities.created_at = $4::timestamptz AND entities.id < $5::uuid');
    expect(client.queries[0]).toContain('ORDER BY entities.created_at DESC, entities.id DESC');
    expect(client.queries[0]).toContain('LIMIT $6');
    expect(client.queries[0]).not.toContain('OFFSET');
    expect(client.queries[0].indexOf("organization_members.status = 'active'")).toBeLessThan(
      client.queries[0].indexOf('entities.created_at < $4::timestamptz'),
    );
    expect(client.valuesList[0]).toEqual([
      'work-1',
      'user-1',
      '99999999-9999-4999-8999-999999999999',
      '2026-04-25T00:00:00.000Z',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      3,
    ]);
  });
});

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'entity-1',
    entity_id: 'entity-1',
    work_id: 'work-1',
    user_id: 'user-1',
    entity_type: 'character',
    name: 'Mizuki',
    free_description: null,
    prompt_supplement: 'anime heroine',
    structured_fields: { art_style: 'anime' },
    speech_profile: {},
    status: 'draft',
    reference_images: [
      {
        ref_id: 'ref-1',
        s3_key: 'saved/user-1/entities/entity-1/ref-1.png',
        cdn_url: 'https://cdn.lyra.test/saved/user-1/entities/entity-1/ref-1.png',
        source: 'upload',
        created_at: '2026-04-25T00:00:00.000Z',
      },
    ],
    primary_ref_id: 'ref-1',
    reference_set_status: 'partial',
    created_at: new Date('2026-04-25T00:00:00.000Z'),
    updated_at: new Date('2026-04-25T00:00:00.000Z'),
    count: 1,
    ...overrides,
  };
}
