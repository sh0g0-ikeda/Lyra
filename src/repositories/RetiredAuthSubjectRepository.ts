import { createAccountDeletionIdentityKey } from '../domain/accountDeletion.js';
import {
  ConfigurationError,
  ConflictError,
  UnauthorizedError,
} from '../domain/errors/index.js';
import type { DatabaseClient } from '../lib/db.js';
import { PostgresAccountDeletionRepository } from './AccountDeletionRepository.js';
import { bindTransaction } from './TransactionBoundDatabase.js';

interface RetiredAuthSubjectRow {
  destination_user_id: string;
}

export async function assertAuthSubjectCanProvision(
  client: DatabaseClient,
  subject: string,
  identityKeySecret?: string,
): Promise<void> {
  if (identityKeySecret === undefined) return;

  const normalizedSubject = subject.trim();
  const subjectKey = createAccountDeletionIdentityKey(identityKeySecret, normalizedSubject);
  await lockAuthSubject(client, normalizedSubject);
  const retired = await client.query<RetiredAuthSubjectRow>(
    `
    SELECT destination_user_id
    FROM retired_auth_subjects
    WHERE subject_key = $1
    `,
    [subjectKey],
  );
  if (retired.rows[0] !== undefined) {
    throw new UnauthorizedError('Authentication subject is no longer eligible for provisioning');
  }
}

export async function retireUnownedAuthSubject(
  client: DatabaseClient,
  subject: string,
  destinationUserId: string,
  identityKeySecret?: string,
): Promise<void> {
  if (identityKeySecret === undefined) {
    throw new ConfigurationError('Retired authentication subject identity key is required');
  }

  const normalizedSubject = subject.trim();
  const subjectKey = createAccountDeletionIdentityKey(identityKeySecret, normalizedSubject);
  await lockAuthSubject(client, normalizedSubject);

  const localUser = await client.query(
    `
    SELECT 1
    FROM users
    WHERE supabase_id = $1
    LIMIT 1
    `,
    [normalizedSubject],
  );
  if ((localUser.rowCount ?? 0) > 0) {
    throw new ConflictError('Authentication subject already belongs to a Lyra user');
  }

  const transaction = bindTransaction(client);
  const hasDeletionTombstone = await new PostgresAccountDeletionRepository(
    transaction,
    transaction,
  ).hasBlockedIdentity({
    identityId: normalizedSubject,
    identityKey: subjectKey,
  });
  if (hasDeletionTombstone) {
    throw new ConflictError('Authentication subject is blocked by account deletion');
  }

  const existing = await client.query<RetiredAuthSubjectRow>(
    `
    SELECT destination_user_id
    FROM retired_auth_subjects
    WHERE subject_key = $1
    `,
    [subjectKey],
  );
  const existingDestinationUserId = existing.rows[0]?.destination_user_id;
  if (existingDestinationUserId !== undefined) {
    if (existingDestinationUserId !== destinationUserId) {
      throw new ConflictError('Authentication subject is retired to another Lyra user');
    }
    return;
  }

  await client.query(
    `
    INSERT INTO retired_auth_subjects(subject_key, destination_user_id)
    VALUES($1, $2)
    `,
    [subjectKey, destinationUserId],
  );
}

async function lockAuthSubject(client: DatabaseClient, normalizedSubject: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
      hashtextextended('lyra-auth-subject:' || $1, 0)
    )`,
    [normalizedSubject],
  );
}
