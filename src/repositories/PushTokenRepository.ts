import type { QueryResultRow } from 'pg';
import { ConfigurationError } from '../domain/errors/index.js';
import type {
  PushPlatform,
  PushTokenRegistration,
} from '../domain/pushToken.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface UpsertPushTokenInput {
  userId: string;
  installationId: string;
  platform: PushPlatform;
  locale: 'ja' | 'en';
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
  platform: PushPlatform;
  locale: 'ja' | 'en';
  created_at: Date;
  updated_at: Date;
}

export class PostgresPushTokenRepository implements PushTokenRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  public async upsertForUser(input: UpsertPushTokenInput): Promise<PushTokenRegistration> {
    return this.transactionRunner.transaction(async (transaction) => {
      await transaction.query(
        `
        SELECT
          pg_advisory_xact_lock(hashtextextended($1, 0)),
          pg_advisory_xact_lock(hashtextextended($2, 0))
        `,
        [
          `push-installation:${input.installationId}`,
          `push-token:${input.tokenHash}`,
        ],
      );

      await transaction.query(
        `
        DELETE FROM mobile_push_tokens
        WHERE installation_id = $1::uuid
          AND (
            user_id <> $2::uuid
            OR token_hash <> $3
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
          user_id = EXCLUDED.user_id,
          installation_id = EXCLUDED.installation_id,
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
    const result = await this.client.query(
      `
      DELETE FROM mobile_push_tokens
      WHERE user_id = $1::uuid
        AND installation_id = $2::uuid
      `,
      [userId, installationId],
    );
    return (result.rowCount ?? 0) > 0;
  }
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
