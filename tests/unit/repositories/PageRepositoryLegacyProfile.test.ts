import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';

class RecordingClient implements DatabaseClient {
  public readonly queries: string[] = [];
  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    return { command: 'SELECT', rowCount: 0, oid: 0, fields: [], rows: [] };
  }
}

describe('PostgresPageRepository legacy schema profile', () => {
  it('legacy profile planning query は starting_entity_states を参照しない', async () => {
    const client = new RecordingClient();
    const repository = new PostgresPageRepository(client, 'legacy_2debe_v1');
    await repository.findEpisodePlanningContextByIdAndUserId('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    const query = client.queries.join('\n');
    expect(query).not.toContain('episodes.starting_entity_states');
    expect(query).not.toContain('entity_states.reference_image');
    expect(query).toContain("'[]'::jsonb AS starting_entity_states");
  });
});
