import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';

class RecordingClient implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public transactionCount = 0;

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    this.queries.push(text);
    const rows = text.includes('FROM users') ? [{ id: 'user-1' }] : [];
    return {
      command: text.includes('UPDATE pages') ? 'UPDATE' : 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
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

  it('legacy personal page更新はusersからrequestの順に同じtransactionで検査する', async () => {
    const client = new RecordingClient();
    const repository = new PostgresPageRepository(client, 'legacy_2debe_v1');

    await repository.updatePageSettings('page-1', 'user-1', { dialogueMode: 'mixed' });

    expect(client.transactionCount).toBe(1);
    expect(client.queries[0]).toContain('FROM users');
    expect(client.queries[1]).toContain('account_deletion_requests');
    expect(client.queries[2]).toContain('UPDATE pages');
    expect(client.queries[3]).toContain('SELECT pages.id');
  });

  it('canonicalとlegacy organization page更新は退会queryと追加transactionを発行しない', async () => {
    for (const [mode, organizationId] of [
      ['canonical', null],
      ['legacy_2debe_v1', '11111111-1111-4111-8111-111111111111'],
    ] as const) {
      const client = new RecordingClient();
      const repository = new PostgresPageRepository(client, mode);

      await repository.updatePageSettings('page-1', 'user-1', { dialogueMode: 'mixed' }, organizationId);

      expect(client.transactionCount).toBe(0);
      expect(client.queries).toHaveLength(2);
      expect(client.queries.join('\n')).not.toContain('account_deletion_requests');
    }
  });
});
