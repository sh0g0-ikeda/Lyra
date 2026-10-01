import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { computeStateReferenceFingerprint } from '../../../src/domain/state/StateReferenceFingerprint.js';
import type { ConfirmEntityStateReferenceInput } from '../../../src/domain/types/entityStateReference.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEntityStateReferenceRepository } from '../../../src/repositories/EntityStateReferenceRepository.js';

const userId = '00000000-0000-4000-8000-000000000001';
const entityId = '00000000-0000-4000-8000-000000000002';
const stateId = '00000000-0000-4000-8000-000000000003';
const jobId = '00000000-0000-4000-8000-000000000004';
const oldRevision = '2026-09-30T00:00:00.000Z';
const fingerprint = computeStateReferenceFingerprint({
  entityId,
  stateId,
  name: '外傷',
  description: '左頬に傷',
  baseRefId: 'base-ref-1',
});

describe('PostgresEntityStateReferenceRepository', () => {
  it('context読取は壊れたreference_imagesを空配列として扱う', async () => {
    const database = new ScriptedDatabase([]);
    const repository = new PostgresEntityStateReferenceRepository(database);

    await repository.findContextByIdAndUserId(entityId, stateId, userId, null);

    expect(database.sql[0]).toContain("WHEN jsonb_typeof(reference_sets.reference_images) = 'array'");
    expect(database.sql[0]).toContain("ELSE '[]'::jsonb");
  });

  it('confirmはreference_sets→entity_statesの順にlockしてbase行を更新しない', async () => {
    const input = buildConfirmInput();
    const validationRows: QueryResultRow[][] = [
      [{ account_deletion_started_at: null, account_deleted_at: null }],
      [{ primary_ref_id: 'base-ref-1', base_s3_key: 'saved/owner/entities/entity/base.png' }],
      [{ name: '外傷', description: '左頬に傷', reference_image: null, state_revision: oldRevision }],
      [{
        user_id: userId,
        organization_id: null,
        status: 'completed',
        params: {
          target: 'entity_state',
          entity_id: entityId,
          entity_state_id: stateId,
          base_primary_ref_id: 'base-ref-1',
          state_input_fingerprint: fingerprint,
          state_revision: oldRevision,
          image_model: 'gpt-image-2',
        },
        result: { candidates: [{ ref_id: input.descriptor.refId, s3_key: input.candidateS3Key }] },
      }],
    ];
    const database = new ScriptedDatabase([
      ...validationRows, [], ...validationRows, [{ id: jobId }],
      [{ state_revision: '2026-09-30T00:00:00.001Z' }],
    ]);
    const repository = new PostgresEntityStateReferenceRepository(database);

    const copy = vi.fn(async () => {});
    const result = await repository.confirmReference(input, copy);
    expect(copy).toHaveBeenCalledOnce();

    expect(database.sql[0]).toContain('FROM users');
    expect(database.sql[1]).toContain('FOR UPDATE OF reference_sets');
    expect(database.sql[2]).toContain('FOR UPDATE OF entity_states');
    expect(database.sql[3]).toContain('FROM generation_jobs');
    expect(database.sql[4]).toContain('state_reference_copies');
    expect(database.sql[9]).toContain('jsonb_agg');
    expect(database.sql[10]).toContain('UPDATE entity_states');
    expect(database.sql.join('\n')).not.toContain('UPDATE reference_sets');
    expect(result.referenceImage.refId).toBe(`${jobId}-1`);
  });

  it('同じdescriptorのconfirm再試行はrevisionが進んでいても冪等でupdateしない', async () => {
    const input = buildConfirmInput();
    const persistedDescriptor = {
      ref_id: input.descriptor.refId,
      s3_key: input.descriptor.s3Key,
      storage_owner_user_id: input.descriptor.storageOwnerUserId,
      image_model: input.descriptor.imageModel,
      base_ref_id: input.descriptor.baseRefId,
      created_at: input.descriptor.createdAt,
      input_fingerprint: input.descriptor.inputFingerprint,
    };
    const database = new ScriptedDatabase([
      [{ account_deletion_started_at: null, account_deleted_at: null }],
      [{ primary_ref_id: 'base-ref-1', base_s3_key: 'saved/owner/entities/entity/base.png' }],
      [{
        name: '外傷',
        description: '左頬に傷',
        reference_image: persistedDescriptor,
        state_revision: '2026-09-30T00:00:00.001Z',
      }],
      [{
        user_id: userId,
        organization_id: null,
        status: 'completed',
        params: {
          target: 'entity_state',
          entity_id: entityId,
          entity_state_id: stateId,
          base_primary_ref_id: 'base-ref-1',
          state_input_fingerprint: fingerprint,
          state_revision: oldRevision,
          image_model: 'gpt-image-2',
        },
        result: { candidates: [{ ref_id: input.descriptor.refId, s3_key: input.candidateS3Key }] },
      }],
    ]);
    const repository = new PostgresEntityStateReferenceRepository(database);

    await expect(repository.confirmReference(input, async () => {})).resolves.toMatchObject({
      stateRevision: '2026-09-30T00:00:00.001Z',
      referenceImage: input.descriptor,
    });
    expect(database.sql).toHaveLength(4);
  });

  it('jobのstate_revisionがconfirm期待値と異なる場合はstaleで更新しない', async () => {
    const input = buildConfirmInput();
    const database = new ScriptedDatabase([
      [{ account_deletion_started_at: null, account_deleted_at: null }],
      [{ primary_ref_id: 'base-ref-1', base_s3_key: 'saved/owner/entities/entity/base.png' }],
      [{ name: '外傷', description: '左頬に傷', reference_image: null, state_revision: oldRevision }],
      [{
        user_id: userId,
        organization_id: null,
        status: 'completed',
        params: {
          target: 'entity_state',
          entity_id: entityId,
          entity_state_id: stateId,
          base_primary_ref_id: 'base-ref-1',
          state_input_fingerprint: fingerprint,
          state_revision: '2026-09-29T00:00:00.000Z',
          image_model: 'gpt-image-2',
        },
        result: { candidates: [{ ref_id: input.descriptor.refId, s3_key: input.candidateS3Key }] },
      }],
    ]);
    const repository = new PostgresEntityStateReferenceRepository(database);

    await expect(repository.confirmReference(input, async () => {})).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(database.sql.join('\n')).not.toContain('UPDATE entity_states');
    expect(database.sql.join('\n')).not.toContain('UPDATE generation_jobs');
  });
});

class ScriptedDatabase implements DatabaseClient, TransactionRunner {
  public readonly sql: string[] = [];
  private queryIndex = 0;
  private history: unknown;

  public constructor(private readonly rowsByQuery: QueryResultRow[][]) {}

  public async query<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    this.sql.push(text);
    if (text.includes("SET result = jsonb_set(result, '{state_reference_copies}', $2::jsonb)")) {
      this.history = JSON.parse(String(values?.[1]));
    }
    const rows = (this.rowsByQuery[this.queryIndex] ?? []) as T[];
    this.queryIndex += 1;
    if (text.includes('SELECT user_id, organization_id, status, params, result') && this.history !== undefined) {
      for (const row of rows) Object.assign(row, { result: { ...(row.result as Record<string, unknown>), state_reference_copies: this.history } });
    }
    return { rows, rowCount: rows.length } as QueryResult<T>;
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

function buildConfirmInput(): ConfirmEntityStateReferenceInput {
  return {
    userId,
    organizationId: null,
    entityId,
    stateId,
    jobId,
    candidateS3Key: `session/${userId}/entities/${entityId}/${jobId}-1.png`,
    expectedStateRevision: oldRevision,
    descriptor: {
      refId: `${jobId}-1`,
      s3Key: `saved/${userId}/entities/${entityId}/states/${stateId}/${jobId}-1.png`,
      storageOwnerUserId: userId,
      imageModel: 'gpt-image-2',
      baseRefId: 'base-ref-1',
      createdAt: '2026-09-30T00:00:01.000Z',
      inputFingerprint: fingerprint,
    },
  };
}
