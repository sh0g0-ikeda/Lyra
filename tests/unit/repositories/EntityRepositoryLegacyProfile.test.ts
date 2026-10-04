import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresEntityRepository } from '../../../src/repositories/EntityRepository.js';

class RecordingClient implements DatabaseClient {
  public readonly queries: string[] = [];
  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
  }
}

describe('PostgresEntityRepository legacy schema profile', () => {
  it('legacy profile は新 entity_states 画像列を参照せず、unknown state を画像へ解決しない', async () => {
    const client = new RecordingClient();
    const repository = new PostgresEntityRepository(client, 'legacy_2debe_v1');
    await repository.findResolvedReferenceImagesByAssignmentsAndUserId?.(
      [{ entityId: '11111111-1111-4111-8111-111111111111', stateId: 'unknown' }],
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    );
    const query = client.queries[0] ?? '';
    expect(query).not.toContain('entity_states.name');
    expect(query).not.toContain('entity_states.description');
    expect(query).not.toContain('entity_states.reference_image');
    expect(query).toContain('entity_states.id AS resolved_state_id');
  });
});
