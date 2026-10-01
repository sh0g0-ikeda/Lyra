import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';

export interface AuditedPoolIdentity {
  subject: string;
  email: string | null;
  enabled: boolean;
}

export interface IdentitySubjectAuditReport {
  active_users: number;
  pool_identities: number;
  stable_subject_matches: number;
  missing_subjects: number;
  duplicate_pool_subjects: number;
  malformed_pool_identities: number;
  email_differences: number;
  disabled_matched_identities: number;
  inspection_limit_reached: boolean;
  ready_for_subject_only_login: boolean;
}

const DEFAULT_MAX_USERS = 10_000;
const MAX_AUDIT_USERS = 100_000;

/** Read-only audit only. Email equality never produces a replacement-subject map. */
export async function auditIdentitySubjects(
  database: DatabaseClient & TransactionRunner,
  readIdentities: () => Promise<{ identities: AuditedPoolIdentity[]; limitReached: boolean }>,
  maxUsers = DEFAULT_MAX_USERS,
): Promise<IdentitySubjectAuditReport> {
  if (!Number.isSafeInteger(maxUsers) || maxUsers < 1 || maxUsers > MAX_AUDIT_USERS) {
    throw new Error('Invalid audit bound');
  }
  return database.transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await client.query("SET LOCAL lock_timeout='1s'");
    await client.query("SET LOCAL statement_timeout='5s'");
    const users = await client.query<{ supabase_id: string; email: string }>(`
      SELECT u.supabase_id,u.email FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM account_deletion_requests r WHERE r.user_id=u.id
          AND r.status IN ('processing','pending_external_action','completed')
      ) ORDER BY u.id LIMIT $1`, [maxUsers + 1]);
    const limited = users.rows.length > maxUsers;
    const report: IdentitySubjectAuditReport = {
      active_users: users.rows.length,
      pool_identities: 0,
      stable_subject_matches: 0,
      missing_subjects: 0,
      duplicate_pool_subjects: 0,
      malformed_pool_identities: 0,
      email_differences: 0,
      disabled_matched_identities: 0,
      inspection_limit_reached: limited,
      ready_for_subject_only_login: false,
    };
    if (limited) return report;

    const pool = await readIdentities();
    report.pool_identities = pool.identities.length;
    report.inspection_limit_reached = pool.limitReached;
    const identities = new Map<string, AuditedPoolIdentity>();
    for (const identity of pool.identities) {
      if (!identity.subject.trim()) {
        report.malformed_pool_identities++;
        continue;
      }
      if (identities.has(identity.subject)) report.duplicate_pool_subjects++;
      else identities.set(identity.subject, identity);
    }
    for (const user of users.rows) {
      const identity = identities.get(user.supabase_id);
      if (!identity) {
        report.missing_subjects++;
        continue;
      }
      report.stable_subject_matches++;
      if (!identity.enabled) report.disabled_matched_identities++;
      if (identity.email === null || identity.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
        report.email_differences++;
      }
    }
    report.ready_for_subject_only_login = !report.inspection_limit_reached
      && report.missing_subjects === 0
      && report.duplicate_pool_subjects === 0
      && report.malformed_pool_identities === 0;
    return report;
  });
}
