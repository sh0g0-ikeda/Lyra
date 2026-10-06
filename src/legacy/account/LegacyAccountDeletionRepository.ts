import type { QueryResultRow } from 'pg';
import { ConflictError } from '../../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { LegacyExportDeletionBlocker } from '../export/LegacyExportDeletionBlocker.js';
import type {
  LegacyAccountDeletionClaimInput,
  LegacyAccountDeletionClaimResult,
  LegacyAccountDeletionFlight,
  LegacyAccountDeletionRepositoryPort,
  LegacyAccountDeletionRequestRecord,
  LegacyAccountDeletionStatus,
  LegacyAccountDeletionStoreSubscription,
} from './LegacyAccountDeletionTypes.js';

interface RequestRow extends QueryResultRow {
  user_id: string;
  identity_id: string;
  status: LegacyAccountDeletionStatus;
  processing_token: string | null;
  cancelled_subscription_ids: string[];
  scheduled_asset_keys: string[];
  data_anonymized_at: Date | null;
  identity_disabled_at: Date | null;
  identity_deleted_at: Date | null;
}
interface OrganizationRow extends QueryResultRow { id: string; name: string }
interface SubscriptionRow extends QueryResultRow { stripe_subscription_id: string }
interface StoreSubscriptionRow extends QueryResultRow {
  store: 'apple' | 'google';
  expires_at: Date | null;
  auto_renew_enabled: boolean | null;
}
interface ImageKeyRow extends QueryResultRow { s3_key: string }
interface UploadKeyRow extends ImageKeyRow { is_active: boolean }
interface ScheduledKeysRow extends QueryResultRow { scheduled_asset_keys: string[] }
interface CountRow extends QueryResultRow { count: string }
interface UpdatedRow extends QueryResultRow { updated: boolean }

const REQUEST_COLUMNS = `
  user_id, identity_id, status, processing_token,
  cancelled_subscription_ids, scheduled_asset_keys,
  data_anonymized_at, identity_disabled_at, identity_deleted_at
`;

/** Old-027 adapter. It never queries canonical-only columns or reclaims an unknown processing owner. */
export class PostgresLegacyAccountDeletionRepository
implements LegacyAccountDeletionRepositoryPort {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  public async getFlight(userId: string): Promise<LegacyAccountDeletionFlight> {
    return this.readFlight(this.client, userId);
  }

  public async getRequest(userId: string): Promise<LegacyAccountDeletionRequestRecord | null> {
    return this.readRequest(this.client, userId);
  }

  public async recordBlocked(userId: string, blockerCodes: string[]): Promise<boolean> {
    const result = await this.client.query<UpdatedRow>(
      `
      INSERT INTO account_deletion_requests (user_id, identity_id, status, blocker_codes)
      SELECT id, supabase_id, 'blocked', $2::text[] FROM users WHERE id = $1::uuid
      ON CONFLICT (user_id) DO UPDATE SET
        blocker_codes = EXCLUDED.blocker_codes,
        last_failure_code = NULL,
        updated_at = NOW()
      WHERE account_deletion_requests.status = 'blocked'
      RETURNING true AS updated
      `,
      [userId, blockerCodes],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async markClaimBlocked(
    userId: string,
    processingToken: string,
    blockerCodes: string[],
  ): Promise<boolean> {
    return this.updateClaim(
      `
      UPDATE account_deletion_requests
      SET status = 'blocked', blocker_codes = $3::text[], last_failure_code = NULL,
          processing_token = NULL, processing_started_at = NULL, updated_at = NOW()
      WHERE user_id = $1::uuid AND processing_token = $2::uuid AND status = 'processing'
      RETURNING true AS updated
      `,
      [userId, processingToken, blockerCodes],
    );
  }

  public async claimRequest(
    input: LegacyAccountDeletionClaimInput,
  ): Promise<LegacyAccountDeletionClaimResult> {
    return this.transactionRunner.transaction(async (client) => {
      // Spec 5/11: old INSERT takes a users FK KEY SHARE after reserving the
      // request key. NO KEY UPDATE avoids that cycle while still excluding
      // ordinary user updates and candidate writers/anonymization.
      await client.query(
        'SELECT id FROM users WHERE id = $1::uuid FOR NO KEY UPDATE',
        [input.userId],
      );
      await client.query(
        'SELECT user_id FROM account_deletion_requests WHERE user_id = $1::uuid FOR UPDATE',
        [input.userId],
      );
      const flight = await this.readFlight(client, input.userId);
      if (hasClaimBlocker(flight, input)) return { kind: 'blocked', flight };

      await client.query(
        `
        INSERT INTO account_deletion_requests (user_id, identity_id, status, last_failure_code)
        VALUES ($1::uuid, $2, 'processing', NULL)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [input.userId, input.identityId],
      );
      const claimed = await client.query<RequestRow>(
        `
        UPDATE account_deletion_requests
        SET identity_id = $2, status = 'processing', processing_token = $3::uuid,
            processing_started_at = NOW(), blocker_codes = '{}', last_failure_code = NULL,
            updated_at = NOW()
        WHERE user_id = $1::uuid AND status <> 'completed' AND processing_token IS NULL
        RETURNING ${REQUEST_COLUMNS}
        `,
        [input.userId, input.identityId, input.processingToken],
      );
      const row = claimed.rows[0];
      if (row !== undefined) return { kind: 'claimed', request: mapRequest(row) };
      const current = await this.readRequest(client, input.userId);
      return current?.status === 'completed' ? { kind: 'completed' } : { kind: 'in_progress' };
    });
  }

  public async claimNextPending(
    processingToken: string,
    excludedUserIds: readonly string[] = [],
  ): Promise<LegacyAccountDeletionRequestRecord | null> {
    const result = await this.client.query<RequestRow>(
      `
      WITH candidate AS (
        SELECT user_id FROM account_deletion_requests
        WHERE status = 'pending_external_action' AND processing_token IS NULL
          AND NOT (user_id = ANY($2::uuid[]))
        ORDER BY updated_at ASC, user_id ASC FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE account_deletion_requests AS requests
      SET status = 'processing', processing_token = $1::uuid,
          processing_started_at = NOW(), last_failure_code = NULL, updated_at = NOW()
      FROM candidate WHERE requests.user_id = candidate.user_id
      RETURNING requests.user_id, requests.identity_id, requests.status,
        requests.processing_token, requests.cancelled_subscription_ids,
        requests.scheduled_asset_keys, requests.data_anonymized_at,
        requests.identity_disabled_at, requests.identity_deleted_at
      `,
      [processingToken, excludedUserIds],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRequest(row);
  }

  public async markSubscriptionCancelled(
    userId: string,
    processingToken: string,
    subscriptionId: string,
  ): Promise<boolean> {
    return this.updateClaim(
      `
      UPDATE account_deletion_requests
      SET cancelled_subscription_ids = CASE WHEN $3 = ANY(cancelled_subscription_ids)
            THEN cancelled_subscription_ids ELSE array_append(cancelled_subscription_ids, $3) END,
          updated_at = NOW()
      WHERE user_id = $1::uuid AND processing_token = $2::uuid AND status = 'processing'
      RETURNING true AS updated
      `,
      [userId, processingToken, subscriptionId],
    );
  }

  public async markAssetScheduled(
    userId: string,
    processingToken: string,
    key: string,
  ): Promise<boolean> {
    return this.updateClaim(
      `
      UPDATE account_deletion_requests
      SET scheduled_asset_keys = CASE WHEN $3 = ANY(scheduled_asset_keys)
            THEN scheduled_asset_keys ELSE array_append(scheduled_asset_keys, $3) END,
          updated_at = NOW()
      WHERE user_id = $1::uuid AND processing_token = $2::uuid AND status = 'processing'
      RETURNING true AS updated
      `,
      [userId, processingToken, key],
    );
  }

  public async anonymizePersonalData(userId: string, processingToken: string): Promise<boolean> {
    return this.transactionRunner.transaction(async (client) => {
      await client.query(
        'SELECT id FROM users WHERE id = $1::uuid FOR UPDATE',
        [userId],
      );
      const ownership = await client.query<ScheduledKeysRow>(
        `SELECT scheduled_asset_keys FROM account_deletion_requests
         WHERE user_id = $1::uuid AND processing_token = $2::uuid AND status = 'processing'
         FOR UPDATE`,
        [userId, processingToken],
      );
      const ownedRequest = ownership.rows[0];
      if (ownedRequest === undefined) return false;
      // Spec 5/8/11: admission and final inventory share users -> request locks.
      // Consuming a token does not revoke its signed PUT. Scheduled keys prove
      // lifecycle reservation only, never physical deletion or remote PUT settlement.
      const uploads = await this.readPersonalUploads(client, userId);
      const assets = await client.query<ImageKeyRow>(LEGACY_PERSONAL_ASSET_KEYS_SQL, [userId]);
      const scheduled = new Set(ownedRequest.scheduled_asset_keys);
      if (uploads.some((row) => row.is_active)
        || [...uploads, ...assets.rows].some((row) => !scheduled.has(row.s3_key))) {
        throw new ConflictError('Personal account deletion has unsettled uploads or assets');
      }
      await client.query('DELETE FROM works WHERE user_id = $1::uuid AND organization_id IS NULL', [userId]);
      await client.query('DELETE FROM organization_members WHERE user_id = $1::uuid', [userId]);
      await client.query(
        `
        UPDATE users SET supabase_id = 'deleted:' || id::text,
          email = 'deleted+' || id::text || '@invalid.local', display_name = NULL,
          stripe_customer_id = NULL, plan_code = 'free', updated_at = NOW()
        WHERE id = $1::uuid
        `,
        [userId],
      );
      const updated = await client.query<UpdatedRow>(
        `
        UPDATE account_deletion_requests
        SET data_anonymized_at = COALESCE(data_anonymized_at, NOW()), updated_at = NOW()
        WHERE user_id = $1::uuid AND processing_token = $2::uuid AND status = 'processing'
        RETURNING true AS updated
        `,
        [userId, processingToken],
      );
      return (updated.rowCount ?? 0) > 0;
    });
  }

  public async markIdentityDisabled(userId: string, processingToken: string): Promise<boolean> {
    return this.markTimestamp(userId, processingToken, 'identity_disabled_at');
  }

  public async markIdentityDeleted(userId: string, processingToken: string): Promise<boolean> {
    return this.markTimestamp(userId, processingToken, 'identity_deleted_at');
  }

  public async markCompleted(userId: string, processingToken: string): Promise<boolean> {
    return this.updateClaim(
      `
      UPDATE account_deletion_requests
      SET status = 'completed', blocker_codes = '{}', last_failure_code = NULL,
          processing_token = NULL, processing_started_at = NULL,
          completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
      WHERE user_id = $1::uuid AND processing_token = $2::uuid AND status = 'processing'
        AND data_anonymized_at IS NOT NULL
        AND identity_disabled_at IS NOT NULL
        AND identity_deleted_at IS NOT NULL
      RETURNING true AS updated
      `,
      [userId, processingToken],
    );
  }

  public async recordFailure(
    userId: string,
    processingToken: string,
    failureCode: string,
  ): Promise<boolean> {
    return this.updateClaim(
      `
      UPDATE account_deletion_requests
      SET status = 'pending_external_action', last_failure_code = $3,
          retry_count = retry_count + 1, processing_token = NULL,
          processing_started_at = NULL, updated_at = NOW()
      WHERE user_id = $1::uuid AND processing_token = $2::uuid AND status = 'processing'
      RETURNING true AS updated
      `,
      [userId, processingToken, failureCode],
    );
  }

  private async markTimestamp(
    userId: string,
    processingToken: string,
    column: 'identity_disabled_at' | 'identity_deleted_at',
  ): Promise<boolean> {
    return this.updateClaim(
      `UPDATE account_deletion_requests SET ${column} = COALESCE(${column}, NOW()), updated_at = NOW()
       WHERE user_id = $1::uuid AND processing_token = $2::uuid AND status = 'processing'
       RETURNING true AS updated`,
      [userId, processingToken],
    );
  }

  private async updateClaim(text: string, values: readonly unknown[]): Promise<boolean> {
    const result = await this.client.query<UpdatedRow>(text, values);
    return (result.rowCount ?? 0) > 0;
  }

  private async readRequest(client: DatabaseClient, userId: string): Promise<LegacyAccountDeletionRequestRecord | null> {
    const result = await client.query<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM account_deletion_requests WHERE user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRequest(row);
  }

  private async readPersonalUploads(client: DatabaseClient, userId: string): Promise<UploadKeyRow[]> {
    const result = await client.query<UploadKeyRow>(
      `SELECT s3_key, expires_at > NOW() AS is_active
       FROM entity_reference_upload_tokens
       WHERE user_id = $1::uuid AND organization_id IS NULL ORDER BY s3_key ASC`,
      [userId],
    );
    // Keep expired/failed-signing rows and consumed rows as exact-key inventory.
    // Legacy remote signature expiry and in-flight PUTs still need external proof.
    return result.rows;
  }

  private async readFlight(client: DatabaseClient, userId: string): Promise<LegacyAccountDeletionFlight> {
    // The same method runs on a transaction client during claim. Keep queries
    // sequential: node-postgres does not support concurrent query calls on one client.
    const owners = await client.query<OrganizationRow>(
        `SELECT organizations.id, organizations.name FROM organization_members
         INNER JOIN organizations ON organizations.id = organization_members.organization_id
         WHERE organization_members.user_id = $1::uuid AND organization_members.role = 'owner'
           AND organization_members.status = 'active'
           AND (SELECT COUNT(*) FROM organization_members AS owner_members
             WHERE owner_members.organization_id = organization_members.organization_id
               AND owner_members.role = 'owner' AND owner_members.status = 'active') = 1
         ORDER BY organizations.name ASC, organizations.id ASC LIMIT 25`,
        [userId],
      );
    const subscriptions = await client.query<SubscriptionRow>(
        `SELECT stripe_subscription_id FROM subscriptions
         WHERE user_id = $1::uuid AND organization_id IS NULL AND status IN ('active', 'trialing')
         ORDER BY stripe_subscription_id ASC`,
        [userId],
      );
    const stores = await client.query<StoreSubscriptionRow>(
        `SELECT store, expires_at, auto_renew_enabled FROM mobile_store_purchases
         WHERE user_id = $1::uuid AND kind = 'subscription'
           AND (state = 'active' OR (state = 'cancelled' AND expires_at IS NOT NULL AND expires_at > NOW()))
         ORDER BY store ASC, id ASC`,
        [userId],
      );
    const assets = await client.query<ImageKeyRow>(LEGACY_PERSONAL_ASSET_KEYS_SQL, [userId]);
    const uploads = await this.readPersonalUploads(client, userId);
    const generationJobs = await client.query<CountRow>(
        `SELECT COUNT(*)::text AS count FROM generation_jobs
         WHERE user_id = $1::uuid AND organization_id IS NULL AND status IN ('queued', 'processing')`,
        [userId],
      );
    const activePersonalExportJobCount =
      await new LegacyExportDeletionBlocker(client).countActivePersonalJobs(userId);
    return {
      uniqueOwnerOrganizations: owners.rows.map((row) => ({ id: row.id, name: row.name })),
      activePersonalStripeSubscriptionIds: subscriptions.rows.map((row) => row.stripe_subscription_id),
      activeStoreSubscriptions: stores.rows.map(mapStoreSubscription),
      personalAssetKeys: assets.rows.map((row) => row.s3_key),
      personalTemporaryUploadKeys: uploads.map((row) => row.s3_key),
      activePersonalUploadCount: uploads.filter((row) => row.is_active).length,
      activePersonalGenerationJobCount: parseCount(generationJobs.rows[0]),
      activePersonalExportJobCount,
    };
  }
}

function mapStoreSubscription(row: StoreSubscriptionRow): LegacyAccountDeletionStoreSubscription {
  return { store: row.store, expiresAt: row.expires_at, autoRenewEnabled: row.auto_renew_enabled };
}

function mapRequest(row: RequestRow): LegacyAccountDeletionRequestRecord {
  return {
    userId: row.user_id, identityId: row.identity_id, status: row.status,
    processingToken: row.processing_token,
    cancelledSubscriptionIds: row.cancelled_subscription_ids,
    scheduledAssetKeys: row.scheduled_asset_keys,
    dataAnonymized: row.data_anonymized_at !== null,
    identityDisabled: row.identity_disabled_at !== null,
    identityDeleted: row.identity_deleted_at !== null,
  };
}

function parseCount(row: CountRow | undefined): number {
  const value = Number(row?.count ?? '0');
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function hasClaimBlocker(flight: LegacyAccountDeletionFlight, input: LegacyAccountDeletionClaimInput): boolean {
  return flight.uniqueOwnerOrganizations.length > 0
    || flight.activePersonalGenerationJobCount > 0
    || flight.activePersonalExportJobCount > 0
    || flight.activePersonalUploadCount > 0
    || (flight.activePersonalStripeSubscriptionIds.length > 0 && !input.acknowledgePersonalSubscriptions)
    || (flight.activeStoreSubscriptions.length > 0 && !input.acknowledgeStoreBilling)
    || (flight.personalAssetKeys.length > 0 && !input.acknowledgePersonalAssets);
}

const LEGACY_PERSONAL_ASSET_KEYS_SQL = `
  WITH personal_works AS (
    SELECT works.id FROM works WHERE works.user_id = $1::uuid AND works.organization_id IS NULL
  ), personal_reference_images AS (
    SELECT reference_image->>'s3_key' AS s3_key FROM reference_sets
    INNER JOIN entities ON entities.id = reference_sets.entity_id
    INNER JOIN personal_works ON personal_works.id = entities.work_id
    CROSS JOIN LATERAL jsonb_array_elements(reference_sets.reference_images) AS reference_image
    WHERE reference_sets.status IN ('partial', 'ready')
  ), personal_page_images AS (
    SELECT pages.generated_image->>'s3_key' AS s3_key FROM pages
    INNER JOIN episodes ON episodes.id = pages.episode_id
    INNER JOIN chapters ON chapters.id = episodes.chapter_id
    INNER JOIN personal_works ON personal_works.id = chapters.work_id
    WHERE pages.generated_image IS NOT NULL
  )
  SELECT DISTINCT s3_key FROM (
    SELECT s3_key FROM personal_reference_images UNION ALL SELECT s3_key FROM personal_page_images
  ) AS personal_asset_keys
  WHERE s3_key IS NOT NULL AND s3_key <> '' ORDER BY s3_key ASC
`;
