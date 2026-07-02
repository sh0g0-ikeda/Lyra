import type { QueryResultRow } from 'pg';
import type { DatabaseClient } from '../lib/db.js';

export interface WorkSummary {
  id: string;
  userId: string;
  organizationId: string | null;
}

export interface WorkReader {
  findByIdAndUserId(id: string, userId: string, organizationId?: string | null): Promise<WorkSummary | null>;
}

interface WorkRow extends QueryResultRow {
  id: string;
  user_id: string;
  organization_id: string | null;
}

export class PostgresWorkRepository implements WorkReader {
  public constructor(private readonly client: DatabaseClient) {}

  public async findByIdAndUserId(
    id: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<WorkSummary | null> {
    const result = await this.client.query<WorkRow>(
      `
      SELECT id, user_id, organization_id
      FROM works
      WHERE id = $1
        AND (
          ($3::uuid IS NULL AND user_id = $2 AND organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [id, userId, organizationId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      organizationId: row.organization_id,
    };
  }
}
