import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresEpisodeStoryAutofillExecutionRepository } from '../../../src/repositories/EpisodeStoryAutofillExecutionRepository.js';

describe('PostgresEpisodeStoryAutofillExecutionRepository terminal settlement', () => {
  it.each(['completed', 'failed'] as const)(
    '%s更新とoutbox snapshotを同じtransactionで行う',
    async (terminalStatus) => {
      const database = new TerminalSettlementDatabase(terminalStatus);
      const repository = new PostgresEpisodeStoryAutofillExecutionRepository(database);

      const settled = terminalStatus === 'completed'
        ? await repository.completeEpisodeStoryAutofill({
            jobId: 'job-1',
            userId: 'user-1',
            result: {
              updatedPageCount: 1,
              updatedPanelCount: 4,
              updatedAssignmentCount: 2,
              filledFieldCount: 8,
              compilerUsed: true,
              compilerProvider: 'openai',
              compilerModel: 'gpt-5.4-mini',
              compilerPromptVersion: 'story-plan-v1',
              compilerError: null,
            },
          })
        : await repository.failEpisodeStoryAutofill({
            jobId: 'job-1',
            userId: 'user-1',
            errorMessage: 'compiler unavailable',
          });

      expect(settled).toBe(true);
      expect(database.transactionCount).toBe(1);
      expect(database.queries[0]).toContain('pg_advisory_xact_lock');
      expect(database.queries[1]).toContain(`status = '${terminalStatus}'`);
      expect(database.queries[1]).toContain('cancel_requested_at IS NULL');
      expect(database.queries[1]).toContain('cancelled_at IS NULL');
      expect(database.queries.some((sql) =>
        sql.includes('INSERT INTO mobile_push_notification_outbox')
      )).toBe(true);
      expect(database.queries.some((sql) =>
        sql.includes('INSERT INTO mobile_push_notification_deliveries')
      )).toBe(true);
    },
  );
});

class TerminalSettlementDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];
  public transactionCount = 0;

  public constructor(private readonly terminalStatus: 'completed' | 'failed') {}

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    const rows = text.includes('UPDATE generation_jobs')
      ? [jobRow(this.terminalStatus)]
      : text.includes('INSERT INTO mobile_push_notification_outbox')
        ? [{ id: 'outbox-1', terminal_status: this.terminalStatus }]
        : [];
    return {
      command: 'UPDATE',
      rowCount: text.includes('INSERT INTO mobile_push_notification_deliveries') ? 1 : rows.length,
      oid: 0,
      fields: [],
      rows: rows as T[],
    };
  }
}

function jobRow(status: 'completed' | 'failed'): QueryResultRow {
  return {
    id: 'job-1',
    user_id: 'user-1',
    organization_id: null,
    job_type: 'episode_story_autofill',
    status,
    generation_mode: null,
    credit_cost: 0,
    params: { episode_id: 'episode-1' },
    result: {},
    sqs_message_id: null,
    openai_request_id: null,
    error_message: null,
    retry_count: 0,
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    started_at: new Date('2026-07-31T00:00:01.000Z'),
    completed_at: new Date('2026-07-31T00:00:02.000Z'),
    expires_at: null,
    cancel_requested_at: null,
    cancel_requested_by: null,
    cancelled_at: null,
    commit_started_at: new Date('2026-07-31T00:00:01.500Z'),
  };
}
