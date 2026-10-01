import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { computeStateReferenceFingerprint } from '../../../src/domain/state/StateReferenceFingerprint.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEntityRepository } from '../../../src/repositories/EntityRepository.js';

class QueryCapturingClient implements DatabaseClient, TransactionRunner {
  public queries: string[] = [];
  public valuesList: Array<readonly unknown[] | undefined> = [];
  public rows: QueryResultRow[] = [row()];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);

    return {
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: this.rows as T[],
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

    await repository.update('entity-1', 'user-1', { name: 'Updated' });

    expect(client.queries[0]).toContain('UPDATE entities');
    expect(client.queries[0]).toContain('organization_id IS NULL');
    expect(client.valuesList[0]?.[12]).toBeNull();
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

  it('状態別参照はentity・work・active organization membershipで絞る', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresEntityRepository(client);

    await repository.findResolvedReferenceImagesByAssignmentsAndUserId?.(
      [{ entityId: 'entity-1', stateId: 'state-1' }],
      'work-1',
      'user-1',
      '99999999-9999-4999-8999-999999999999',
    );

    expect(client.queries[0]).toContain('WHEN requested.state_id ~*');
    expect(client.queries[0]).toContain('THEN requested.state_id::uuid');
    expect(client.queries[0]).toContain('entity_states.entity_id = entities.id');
    expect(client.queries[0]).toContain('entities.work_id = $2');
    expect(client.queries[0]).toContain("organization_members.status = 'active'");
    expect(client.valuesList[0]).toEqual([
      JSON.stringify([{ entity_id: 'entity-1', state_id: 'state-1' }]),
      'work-1',
      'user-1',
      '99999999-9999-4999-8999-999999999999',
    ]);
  });

  it('旧ページのUUIDでないstate IDの場合はSQL変換せず既定画像を維持する', async () => {
    const client = new QueryCapturingClient();
    client.rows = [{
      entity_id: 'entity-1', owner_user_id: 'user-1', requested_state_id: 'legacy-invalid-id',
      resolved_state_id: null, state_name: null, state_description: null,
      state_reference_image: null,
      reference_images: [{
        ref_id: 'base-ref', s3_key: 'saved/user-1/entities/entity-1/base-ref.png',
        cdn_url: 'https://img.lyra.test/base.png', source: 'generated',
      }],
      primary_ref_id: 'base-ref',
    }];
    const repository = new PostgresEntityRepository(client);

    const result = await repository.findResolvedReferenceImagesByAssignmentsAndUserId?.(
      [{ entityId: 'entity-1', stateId: 'legacy-invalid-id' }], 'work-1', 'user-1',
    );

    expect(client.queries[0]).toContain('state_id text');
    expect(result?.[0]).toMatchObject({
      stateId: 'legacy-invalid-id', stateExists: true,
      refId: 'base-ref', s3Key: 'saved/user-1/entities/entity-1/base-ref.png',
    });
  });

  it('状態descriptorが完全でbaseとfingerprintが一致する場合だけ状態画像を返す', async () => {
    const client = new QueryCapturingClient();
    client.rows = [{
      entity_id: 'entity-1', owner_user_id: 'user-1', requested_state_id: 'state-1',
      resolved_state_id: 'state-1', state_name: '外傷', state_description: '左頬に傷',
      state_reference_image: {
        ref_id: 'state-ref-1', s3_key: 'saved/user-1/entities/entity-1/state-ref-1.png',
        storage_owner_user_id: 'user-1', image_model: 'gpt-image-2', base_ref_id: 'base-ref',
        created_at: '2026-09-30T00:00:00.000Z',
        input_fingerprint: computeStateReferenceFingerprint({
          entityId: 'entity-1', stateId: 'state-1', name: '外傷', description: '左頬に傷', baseRefId: 'base-ref',
        }),
      },
      reference_images: [], primary_ref_id: 'base-ref',
    }];
    const repository = new PostgresEntityRepository(client);

    const result = await repository.findResolvedReferenceImagesByAssignmentsAndUserId?.(
      [{ entityId: 'entity-1', stateId: 'state-1' }], 'work-1', 'user-1',
    );

    expect(result?.[0]).toMatchObject({
      stateExists: true,
      refId: 'state-ref-1',
      s3Key: 'saved/user-1/entities/entity-1/state-ref-1.png',
      ownerUserId: 'user-1',
    });
  });

  it('状態descriptorが欠落またはstaleなら状態画像を返さない', async () => {
    const client = new QueryCapturingClient();
    client.rows = [{
      entity_id: 'entity-1', owner_user_id: 'user-1', requested_state_id: 'state-1',
      resolved_state_id: 'state-1', state_name: '外傷', state_description: '左頬に傷',
      state_reference_image: {
        ref_id: 'state-ref-1', s3_key: 'saved/user-1/entities/entity-1/state-ref-1.png',
        storage_owner_user_id: 'user-1', image_model: 'gpt-image-2', base_ref_id: 'old-ref',
        created_at: '2026-09-30T00:00:00.000Z', input_fingerprint: 'stale',
      },
      reference_images: [], primary_ref_id: 'base-ref',
    }];
    const repository = new PostgresEntityRepository(client);

    const result = await repository.findResolvedReferenceImagesByAssignmentsAndUserId?.(
      [{ entityId: 'entity-1', stateId: 'state-1' }], 'work-1', 'user-1',
    );

    expect(result?.[0]).toMatchObject({ stateExists: true, refId: null, s3Key: null });
  });
});

function row(): Record<string, unknown> {
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
  };
}
