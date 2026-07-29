import type { QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface AccountDeletionFlight {
  uniqueOwnerOrganizations: Array<{ id: string; name: string }>;
  activePersonalSubscriptionIds: string[];
  activeMobileStoreSubscriptionCount: number;
  confirmedAssetCount: number;
  personalAssetKeys: string[];
}

export interface AccountDeletionRequestRecord {
  userId: string;
  identityId: string;
  status: 'blocked' | 'processing' | 'pending_external_action' | 'completed';
  cancelledSubscriptionIds: string[];
  identityDisabled: boolean;
  identityDeleted: boolean;
  scheduledAssetKeys: string[];
  dataAnonymized: boolean;
}

export interface AccountDeletionRepository {
  getFlight(userId: string): Promise<AccountDeletionFlight>;
  getRequest(userId: string): Promise<AccountDeletionRequestRecord | null>;
  claimRequest(input: {
    userId: string;
    identityId: string;
    processingToken: string;
  }): Promise<AccountDeletionRequestRecord | null>;
  recordBlocked(userId: string, blockerCodes: string[]): Promise<void>;
  markSubscriptionCancelled(userId: string, subscriptionId: string): Promise<void>;
  markIdentityDisabled(userId: string): Promise<void>;
  markIdentityDeleted(userId: string): Promise<void>;
  markAssetKeyScheduled(userId: string, key: string): Promise<void>;
  anonymizePersonalData(userId: string): Promise<void>;
  markCompleted(userId: string): Promise<void>;
  recordExternalFailure(userId: string, failureCode: string): Promise<void>;
}

interface AccountDeletionRequestRow extends QueryResultRow {
  user_id: string;
  identity_id: string;
  status: 'blocked' | 'processing' | 'pending_external_action' | 'completed';
  cancelled_subscription_ids: string[];
  identity_disabled_at: Date | null;
  identity_deleted_at: Date | null;
  scheduled_asset_keys: string[];
  data_anonymized_at: Date | null;
}

interface OrganizationRow extends QueryResultRow {
  id: string;
  name: string;
}

interface SubscriptionRow extends QueryResultRow {
  stripe_subscription_id: string;
}

interface MobileSubscriptionCountRow extends QueryResultRow {
  active_mobile_subscription_count: string;
}

interface ImageKeyRow extends QueryResultRow {
  s3_key: string;
}

export class PostgresAccountDeletionRepository implements AccountDeletionRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  public async getFlight(userId: string): Promise<AccountDeletionFlight> {
    const [
      uniqueOwnerOrganizations,
      activeSubscriptions,
      activeMobileSubscriptions,
      personalAssetKeys,
    ] = await Promise.all([
      this.client.query<OrganizationRow>(
        `
        SELECT organizations.id, organizations.name
        FROM organization_members
        INNER JOIN organizations ON organizations.id = organization_members.organization_id
        WHERE organization_members.user_id = $1
          AND organization_members.role = 'owner'
          AND organization_members.status = 'active'
          AND (
            SELECT COUNT(*)
            FROM organization_members AS owner_members
            WHERE owner_members.organization_id = organization_members.organization_id
              AND owner_members.role = 'owner'
              AND owner_members.status = 'active'
        ) = 1
        ORDER BY organizations.name ASC, organizations.id ASC
        LIMIT 25
        `,
        [userId],
      ),
      this.client.query<SubscriptionRow>(
        `
        SELECT stripe_subscription_id
        FROM subscriptions
        WHERE user_id = $1
          AND organization_id IS NULL
          AND status IN ('active', 'trialing')
        ORDER BY stripe_subscription_id ASC
        `,
        [userId],
      ),
      this.client.query<MobileSubscriptionCountRow>(
        `
        SELECT COUNT(*)::text AS active_mobile_subscription_count
        FROM mobile_store_purchases
        WHERE user_id = $1
          AND kind = 'subscription'
          AND (
            state = 'active'
            OR (state = 'cancelled' AND expires_at IS NOT NULL AND expires_at > NOW())
          )
        `,
        [userId],
      ),
      this.client.query<ImageKeyRow>(
        `
        WITH personal_works AS (
          SELECT works.id
          FROM works
          WHERE works.user_id = $1
            AND works.organization_id IS NULL
        ),
        personal_reference_images AS (
          SELECT reference_image->>'s3_key' AS s3_key
          FROM reference_sets
          INNER JOIN entities ON entities.id = reference_sets.entity_id
          INNER JOIN personal_works ON personal_works.id = entities.work_id
          CROSS JOIN LATERAL jsonb_array_elements(reference_sets.reference_images) AS reference_image
          WHERE reference_sets.status IN ('partial', 'ready')
        ),
        personal_page_images AS (
          SELECT pages.generated_image->>'s3_key' AS s3_key
          FROM pages
          INNER JOIN episodes ON episodes.id = pages.episode_id
          INNER JOIN chapters ON chapters.id = episodes.chapter_id
          INNER JOIN personal_works ON personal_works.id = chapters.work_id
          WHERE pages.generated_image IS NOT NULL
        )
        SELECT DISTINCT s3_key
        FROM (
          SELECT s3_key FROM personal_reference_images
          UNION ALL
          SELECT s3_key FROM personal_page_images
        ) AS personal_asset_keys
        WHERE s3_key IS NOT NULL
          AND s3_key <> ''
        ORDER BY s3_key ASC
        `,
        [userId],
      ),
    ]);

    const keys = personalAssetKeys.rows.map((row) => row.s3_key);
    const mobileSubscriptionCount = Number(
      activeMobileSubscriptions.rows[0]?.active_mobile_subscription_count ?? '0',
    );
    return {
      uniqueOwnerOrganizations: uniqueOwnerOrganizations.rows.map((row) => ({ id: row.id, name: row.name })),
      activePersonalSubscriptionIds: activeSubscriptions.rows.map((row) => row.stripe_subscription_id),
      activeMobileStoreSubscriptionCount: Number.isSafeInteger(mobileSubscriptionCount)
        ? mobileSubscriptionCount
        : 0,
      confirmedAssetCount: keys.length,
      personalAssetKeys: keys,
    };
  }

  public async getRequest(userId: string): Promise<AccountDeletionRequestRecord | null> {
    const result = await this.client.query<AccountDeletionRequestRow>(
      `
      SELECT
        user_id,
        identity_id,
        status,
        cancelled_subscription_ids,
        identity_disabled_at,
        identity_deleted_at,
        scheduled_asset_keys,
        data_anonymized_at
      FROM account_deletion_requests
      WHERE user_id = $1
      `,
      [userId],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapRequest(row);
  }

  public async claimRequest(input: {
    userId: string;
    identityId: string;
    processingToken: string;
  }): Promise<AccountDeletionRequestRecord | null> {
    await this.client.query(
      `
      INSERT INTO account_deletion_requests (user_id, identity_id, status, last_failure_code)
      VALUES ($1, $2, 'processing', NULL)
      ON CONFLICT (user_id) DO NOTHING
      `,
      [input.userId, input.identityId],
    );

    const result = await this.client.query<AccountDeletionRequestRow>(
      `
      UPDATE account_deletion_requests
      SET identity_id = $2,
          status = 'processing',
          processing_token = $3::uuid,
          processing_started_at = NOW(),
          last_failure_code = NULL,
          updated_at = NOW()
      WHERE user_id = $1
        AND status <> 'completed'
        AND (
          processing_token IS NULL
          OR processing_started_at < NOW() - INTERVAL '10 minutes'
        )
      RETURNING
        user_id,
        identity_id,
        status,
        cancelled_subscription_ids,
        identity_disabled_at,
        identity_deleted_at,
        scheduled_asset_keys,
        data_anonymized_at
      `,
      [input.userId, input.identityId, input.processingToken],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapRequest(row);
  }

  public async recordBlocked(userId: string, blockerCodes: string[]): Promise<void> {
    await this.client.query(
      `
      INSERT INTO account_deletion_requests (user_id, identity_id, status, blocker_codes)
      SELECT id, supabase_id, 'blocked', $2::text[]
      FROM users
      WHERE id = $1
      ON CONFLICT (user_id)
      DO UPDATE SET
        status = 'blocked',
        blocker_codes = EXCLUDED.blocker_codes,
        last_failure_code = NULL,
        processing_token = NULL,
        processing_started_at = NULL,
        updated_at = NOW()
      `,
      [userId, blockerCodes],
    );
  }

  public async markSubscriptionCancelled(userId: string, subscriptionId: string): Promise<void> {
    await this.client.query(
      `
      UPDATE account_deletion_requests
      SET cancelled_subscription_ids = CASE
            WHEN $2 = ANY(cancelled_subscription_ids) THEN cancelled_subscription_ids
            ELSE array_append(cancelled_subscription_ids, $2)
          END,
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId, subscriptionId],
    );
  }

  public async markIdentityDisabled(userId: string): Promise<void> {
    await this.markTimestamp(userId, 'identity_disabled_at');
  }

  public async markIdentityDeleted(userId: string): Promise<void> {
    await this.markTimestamp(userId, 'identity_deleted_at');
  }

  public async markAssetKeyScheduled(userId: string, key: string): Promise<void> {
    await this.client.query(
      `
      UPDATE account_deletion_requests
      SET scheduled_asset_keys = CASE
            WHEN $2 = ANY(scheduled_asset_keys) THEN scheduled_asset_keys
            ELSE array_append(scheduled_asset_keys, $2)
          END,
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId, key],
    );
  }

  public async anonymizePersonalData(userId: string): Promise<void> {
    await this.transactionRunner.transaction(async (client) => {
      await client.query(
        `
        DELETE FROM works
        WHERE user_id = $1
          AND organization_id IS NULL
        `,
        [userId],
      );
      await client.query('DELETE FROM organization_members WHERE user_id = $1', [userId]);
      await client.query(
        `
        UPDATE users
        SET supabase_id = 'deleted:' || id::text,
            email = 'deleted+' || id::text || '@invalid.local',
            display_name = NULL,
            stripe_customer_id = NULL,
            plan_code = 'free',
            updated_at = NOW()
        WHERE id = $1
        `,
        [userId],
      );
      await client.query(
        `
        UPDATE account_deletion_requests
        SET data_anonymized_at = COALESCE(data_anonymized_at, NOW()),
            updated_at = NOW()
        WHERE user_id = $1
        `,
        [userId],
      );
    });
  }

  public async markCompleted(userId: string): Promise<void> {
    await this.client.query(
      `
      UPDATE account_deletion_requests
      SET status = 'completed',
          blocker_codes = '{}',
          last_failure_code = NULL,
          processing_token = NULL,
          processing_started_at = NULL,
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId],
    );
  }

  public async recordExternalFailure(userId: string, failureCode: string): Promise<void> {
    await this.client.query(
      `
      UPDATE account_deletion_requests
      SET status = 'pending_external_action',
          last_failure_code = $2,
          retry_count = retry_count + 1,
          processing_token = NULL,
          processing_started_at = NULL,
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId, failureCode],
    );
  }

  private async markTimestamp(userId: string, column: 'identity_disabled_at' | 'identity_deleted_at'): Promise<void> {
    await this.client.query(
      `
      UPDATE account_deletion_requests
      SET ${column} = COALESCE(${column}, NOW()),
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId],
    );
  }
}

function mapRequest(row: AccountDeletionRequestRow | undefined): AccountDeletionRequestRecord {
  if (row === undefined) {
    throw new Error('Account deletion request was not persisted');
  }

  return {
    userId: row.user_id,
    identityId: row.identity_id,
    status: row.status,
    cancelledSubscriptionIds: row.cancelled_subscription_ids,
    identityDisabled: row.identity_disabled_at !== null,
    identityDeleted: row.identity_deleted_at !== null,
    scheduledAssetKeys: row.scheduled_asset_keys,
    dataAnonymized: row.data_anonymized_at !== null,
  };
}
