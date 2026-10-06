import type { QueryResultRow } from 'pg';
import type {
  MobilePushLocale,
  MobilePushPlatform,
} from '../domain/constants/mobilePush.js';
import { MOBILE_PUSH_TOKEN_REGISTRY_LOCK_KEY } from '../domain/constants/mobilePush.js';
import { ConfigurationError, ConflictError } from '../domain/errors/index.js';
import type { PushTokenRegistration } from '../domain/types/mobilePush.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface UpsertPushTokenInput {
  userId: string;
  installationId: string;
  platform: MobilePushPlatform;
  locale: MobilePushLocale;
  tokenHash: string;
  tokenCiphertext: string;
  encryptionKeyId: string;
}

export interface PushTokenRepository {
  upsertForUser(input: UpsertPushTokenInput): Promise<PushTokenRegistration>;
  deleteForUser(userId: string, installationId: string): Promise<boolean>;
}

interface PushTokenRegistrationRow extends QueryResultRow {
  user_id: string;
  installation_id: string;
  platform: MobilePushPlatform;
  locale: MobilePushLocale;
  created_at: Date;
  updated_at: Date;
}

export class PostgresPushTokenRepository implements PushTokenRepository {
  public constructor(private readonly transactionRunner: TransactionRunner) {}

  public async upsertForUser(input: UpsertPushTokenInput): Promise<PushTokenRegistration> {
    return this.transactionRunner.transaction(async (transaction) => {
      // Same user -> token-registry lock order as account deletion. A trigger
      // alone can observe an older MVCC row and admit a late registration.
      const active = await transaction.query(`SELECT id FROM users WHERE id=$1::uuid
        AND account_deletion_started_at IS NULL AND account_deleted_at IS NULL FOR UPDATE`, [input.userId]);
      if (active.rows.length !== 1) throw new ConflictError('Account is unavailable for push registration');
      await lockPushTokenRegistry(transaction);

      await transaction.query(
        `
        DELETE FROM mobile_push_tokens
        WHERE (
            installation_id = $1::uuid
            OR token_hash = $3
          )
          AND (
            user_id IS DISTINCT FROM $2::uuid
            OR installation_id IS DISTINCT FROM $1::uuid
            OR token_hash IS DISTINCT FROM $3
          )
        `,
        [input.installationId, input.userId, input.tokenHash],
      );

      const result = await transaction.query<PushTokenRegistrationRow>(
        `
        INSERT INTO mobile_push_tokens (
          user_id,
          installation_id,
          platform,
          locale,
          token_hash,
          token_ciphertext,
          encryption_key_id
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
        ON CONFLICT (token_hash)
        DO UPDATE SET
          platform = EXCLUDED.platform,
          locale = EXCLUDED.locale,
          token_ciphertext = EXCLUDED.token_ciphertext,
          encryption_key_id = EXCLUDED.encryption_key_id,
          updated_at = NOW()
        RETURNING
          user_id,
          installation_id,
          platform,
          locale,
          created_at,
          updated_at
        `,
        [
          input.userId,
          input.installationId,
          input.platform,
          input.locale,
          input.tokenHash,
          input.tokenCiphertext,
          input.encryptionKeyId,
        ],
      );

      const row = result.rows[0];
      if (row === undefined) {
        throw new ConfigurationError('Push token registration was not persisted');
      }
      return mapPushTokenRegistration(row);
    });
  }

  public async deleteForUser(userId: string, installationId: string): Promise<boolean> {
    return this.transactionRunner.transaction(async (transaction) => {
      await lockPushTokenRegistry(transaction);
      const result = await transaction.query(
        `
        DELETE FROM mobile_push_tokens
        WHERE user_id = $1::uuid
          AND installation_id = $2::uuid
        `,
        [userId, installationId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }
}

async function lockPushTokenRegistry(client: DatabaseClient): Promise<void> {
  await client.query(
    `
    SELECT pg_advisory_xact_lock(
      hashtextextended($1, 0)
    )
    `,
    [MOBILE_PUSH_TOKEN_REGISTRY_LOCK_KEY],
  );
}

function mapPushTokenRegistration(row: PushTokenRegistrationRow): PushTokenRegistration {
  return {
    userId: row.user_id,
    installationId: row.installation_id,
    platform: row.platform,
    locale: row.locale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
