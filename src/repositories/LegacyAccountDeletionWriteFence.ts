import { ForbiddenError } from '../domain/errors/index.js';
import type { DatabaseClient } from '../lib/db.js';

export class LegacyAccountDeletionWriteBlockedError extends ForbiddenError {
  public constructor() {
    super('Account deletion is in progress');
  }
}

/** Serialize a legacy personal write with account-deletion claim/anonymization. */
export async function assertLegacyPersonalWriteAllowed(
  client: DatabaseClient,
  input: { userId: string; organizationId: string | null },
): Promise<void> {
  if (input.organizationId !== null) return;
  const user = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE id = $1::uuid FOR UPDATE',
    [input.userId],
  );
  if (user.rows[0] === undefined) throw new LegacyAccountDeletionWriteBlockedError();
  const request = await client.query<{ status: string }>(
    'SELECT status FROM account_deletion_requests WHERE user_id = $1::uuid FOR UPDATE',
    [input.userId],
  );
  const status = request.rows[0]?.status;
  if (status === 'processing' || status === 'pending_external_action' || status === 'completed') {
    throw new LegacyAccountDeletionWriteBlockedError();
  }
}
