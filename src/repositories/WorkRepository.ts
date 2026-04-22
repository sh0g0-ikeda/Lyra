import type { QueryResultRow } from 'pg';
import type { DatabaseClient } from '../lib/db.js';

export interface WorkSummary {
  id: string;
  userId: string;
}

export interface WorkReader {
  findByIdAndUserId(id: string, userId: string): Promise<WorkSummary | null>;
}

interface WorkRow extends QueryResultRow {
  id: string;
  user_id: string;
}

export class PostgresWorkRepository implements WorkReader {
  public constructor(private readonly client: DatabaseClient) {}

  public async findByIdAndUserId(id: string, userId: string): Promise<WorkSummary | null> {
    const result = await this.client.query<WorkRow>(
      `
      SELECT id, user_id
      FROM works
      WHERE id = $1
        AND user_id = $2
      `,
      [id, userId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
    };
  }
}
