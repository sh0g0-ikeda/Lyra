import type { QueryResultRow } from 'pg';
import type { AuthenticatedUser } from '../domain/types/user.js';
import type { DatabaseClient } from '../lib/db.js';

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
  linkSupabaseIdByEmail(email: string, supabaseId: string): Promise<AuthenticatedUser>;
}

export class PostgresUserRepository implements UserRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async findBySupabaseId(supabaseId: string): Promise<AuthenticatedUser | null> {
    const result = await this.client.query<UserRow>(
      `
      SELECT id, supabase_id, email, display_name, plan_code
      FROM users
      WHERE supabase_id = $1
        AND account_deletion_started_at IS NULL
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
        AND account_deletion_started_at IS NULL
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
      RETURNING id, supabase_id, email, display_name, plan_code
      `,
      [supabaseId, email],
    );

    return mapUserRow(result.rows[0]);
  }

  public async updateEmail(supabaseId: string, email: string): Promise<AuthenticatedUser> {
    const result = await this.client.query<UserRow>(
      `
      UPDATE users
      SET email = $2,
          updated_at = NOW()
      WHERE supabase_id = $1
        AND account_deletion_started_at IS NULL
      RETURNING id, supabase_id, email, display_name, plan_code
      `,
      [supabaseId, email],
    );

    return mapUserRow(result.rows[0]);
  }

  public async linkSupabaseIdByEmail(email: string, supabaseId: string): Promise<AuthenticatedUser> {
    const result = await this.client.query<UserRow>(
      `
      UPDATE users
      SET supabase_id = $2,
          email = $1,
          updated_at = NOW()
      WHERE lower(email) = lower($1)
        AND account_deletion_started_at IS NULL
      RETURNING id, supabase_id, email, display_name, plan_code
      `,
      [email, supabaseId],
    );

    return mapUserRow(result.rows[0]);
  }
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
