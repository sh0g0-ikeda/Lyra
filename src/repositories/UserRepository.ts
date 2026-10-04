import type { QueryResultRow } from 'pg';
import type { AuthenticatedUser } from '../domain/types/user.js';
import type { DatabaseClient } from '../lib/db.js';
import {
  CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  type RepositorySchemaProfile,
} from './RepositorySchemaProfile.js';

interface UserRow extends QueryResultRow {
  id: string;
  supabase_id: string;
  email: string;
  display_name: string | null;
  plan_code: string;
}

export interface UserRepository {
  findBySupabaseId(supabaseId: string): Promise<AuthenticatedUser | null>;
  findByEmail(email: string): Promise<AuthenticatedUser | null>;
  insertSupabaseUser(supabaseId: string, email: string): Promise<AuthenticatedUser>;
  updateEmail(supabaseId: string, email: string): Promise<AuthenticatedUser>;
}

export class PostgresUserRepository implements UserRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly schemaProfile: RepositorySchemaProfile = CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  ) {}

  public async findBySupabaseId(supabaseId: string): Promise<AuthenticatedUser | null> {
    const result = await this.client.query<UserRow>(
      `
      SELECT id, supabase_id, email, display_name, plan_code
      FROM users
      WHERE supabase_id = $1
        AND ${activeAccountSql(this.schemaProfile)}
      `,
      [supabaseId],
    );

    return result.rows[0] === undefined ? null : mapUserRow(result.rows[0]);
  }

  public async findByEmail(email: string): Promise<AuthenticatedUser | null> {
    const result = await this.client.query<UserRow>(
      `
      SELECT id, supabase_id, email, display_name, plan_code
      FROM users
      WHERE lower(email) = lower($1)
        AND ${activeAccountSql(this.schemaProfile)}
      `,
      [email],
    );

    return result.rows[0] === undefined ? null : mapUserRow(result.rows[0]);
  }

  public async insertSupabaseUser(supabaseId: string, email: string): Promise<AuthenticatedUser> {
    const result = await this.client.query<UserRow>(
      `
      INSERT INTO users (supabase_id, email, plan_code)
      VALUES ($1, $2, 'free')
      ON CONFLICT DO NOTHING
      RETURNING id, supabase_id, email, display_name, plan_code
      `,
      [supabaseId, email],
    );

    if (result.rows[0] === undefined) throw Object.assign(new Error('Concurrent user provisioning conflict'), { code: '23505' });
    return mapUserRow(result.rows[0]);
  }

  public async updateEmail(supabaseId: string, email: string): Promise<AuthenticatedUser> {
    const result = await this.client.query<UserRow>(
      `
      UPDATE users
      SET email = $2,
          updated_at = NOW()
      WHERE supabase_id = $1
        AND ${activeAccountSql(this.schemaProfile)}
      RETURNING id, supabase_id, email, display_name, plan_code
      `,
      [supabaseId, email],
    );

    return mapUserRow(result.rows[0]);
  }

}

function activeAccountSql(profile: RepositorySchemaProfile): string {
  return profile === 'legacy_2debe_v1'
    ? `NOT EXISTS (
          SELECT 1 FROM account_deletion_requests deletion_request
          WHERE deletion_request.user_id = users.id
            AND deletion_request.status IN ('processing', 'pending_external_action', 'completed')
        )`
    : 'account_deletion_started_at IS NULL';
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505'
  );
}

function mapUserRow(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    supabaseId: row.supabase_id,
    email: row.email,
    displayName: row.display_name,
    planCode: row.plan_code,
  };
}
