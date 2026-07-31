import type { QueryResultRow } from 'pg';
import { MOBILE_PUSH_TOKEN_REGISTRY_LOCK_KEY } from '../domain/constants/mobilePush.js';
import { ConflictError } from '../domain/errors/index.js';
import type { StorePurchaseStore } from '../domain/storePurchase.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface AccountDeletionOrganization {
  id: string;
  name: string;
}

export interface AccountDeletionStoreSubscription {
  store: StorePurchaseStore;
  expiresAt: Date | null;
  autoRenewEnabled: boolean | null;
}

export interface AccountDeletionFlight {
  uniqueOwnerOrganizations: AccountDeletionOrganization[];
  activePersonalStripeSubscriptionIds: string[];
  activeStoreSubscriptions: AccountDeletionStoreSubscription[];
  personalAssetKeys: string[];
  activePersonalGenerationJobCount: number;
  activePersonalExportJobCount: number;
}

export type AccountDeletionRequestStatus =
  | 'blocked'
  | 'processing'
  | 'pending_external_action'
  | 'completed';

export interface AccountDeletionRequestRecord {
  userId: string;
  identityId: string;
  status: AccountDeletionRequestStatus;
  processingToken: string;
  cancelledSubscriptionIds: string[];
  deletedAssetKeys: string[];
  dataAnonymized: boolean;
  identityDisabled: boolean;
  identityDeleted: boolean;
}

export type AccountDeletionClaimResult =
  | { kind: 'claimed'; request: AccountDeletionRequestRecord }
  | { kind: 'blocked'; flight: AccountDeletionFlight }
  | { kind: 'in_progress' }
  | { kind: 'completed' };

export type AccountDeletionFinalizeResult =
  | { kind: 'completed' }
  | { kind: 'blocked'; flight: AccountDeletionFlight }
  | { kind: 'new_assets'; assetKeys: string[] }
  | { kind: 'uncancelled_subscriptions'; subscriptionIds: string[] };

export interface ClaimAccountDeletionInput {
  userId: string;
  identityId: string;
  identityKey: string;
  processingToken: string;
  acknowledgePersonalSubscriptions: boolean;
  acknowledgeStoreBilling: boolean;
  acknowledgePersonalAssets: boolean;
}

export interface AccountDeletionRepository {
  getFlight(userId: string): Promise<AccountDeletionFlight>;
  getRequest(userId: string): Promise<AccountDeletionRequestRecord | null>;
  recordBlocked(userId: string, blockerCodes: string[]): Promise<void>;
  claimRequest(input: ClaimAccountDeletionInput): Promise<AccountDeletionClaimResult>;
  claimNextRecoverable(processingToken: string): Promise<AccountDeletionRequestRecord | null>;
  markSubscriptionCancelled(
    userId: string,
    processingToken: string,
    subscriptionId: string,
  ): Promise<void>;
  markAssetDeleted(
    userId: string,
    processingToken: string,
    key: string,
  ): Promise<void>;
  finalizePersonalData(
    userId: string,
    processingToken: string,
  ): Promise<AccountDeletionFinalizeResult>;
  markIdentityDisabled(userId: string, processingToken: string): Promise<void>;
  markIdentityDeleted(userId: string, processingToken: string): Promise<void>;
  markCompleted(userId: string, processingToken: string): Promise<void>;
  releaseForContinuation(userId: string, processingToken: string): Promise<void>;
  recordFailure(
    userId: string,
    processingToken: string,
    failureCode: string,
  ): Promise<void>;
}

export interface AccountDeletionIdentityLookupRepository {
  hasBlockedIdentityKey(identityKey: string): Promise<boolean>;
}

interface RequestRow extends QueryResultRow {
  user_id: string;
  identity_id: string;
  status: AccountDeletionRequestStatus;
  processing_token: string | null;
  cancelled_subscription_ids: string[];
  scheduled_asset_keys: string[];
  data_anonymized_at: Date | null;
  identity_disabled_at: Date | null;
  identity_deleted_at: Date | null;
}

interface OrganizationRow extends QueryResultRow {
  id: string;
  name: string;
}

interface SubscriptionRow extends QueryResultRow {
  stripe_subscription_id: string;
}

interface StoreSubscriptionRow extends QueryResultRow {
  store: StorePurchaseStore;
  expires_at: Date | null;
  auto_renew_enabled: boolean | null;
}

interface CountRow extends QueryResultRow {
  count: string;
}

interface AssetKeyRow extends QueryResultRow {
  s3_key: string;
}

interface UserDeletionRow extends QueryResultRow {
  account_deletion_started_at: Date | null;
  account_deleted_at: Date | null;
}

export class PostgresAccountDeletionRepository
implements AccountDeletionRepository, AccountDeletionIdentityLookupRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  public async getFlight(userId: string): Promise<AccountDeletionFlight> {
    return this.readFlight(this.client, userId);
  }

  public async getRequest(userId: string): Promise<AccountDeletionRequestRecord | null> {
    return this.readRequest(this.client, userId);
  }

  public async hasBlockedIdentityKey(identityKey: string): Promise<boolean> {
    const result = await this.client.query(
      `
      SELECT 1
      FROM account_deletion_requests
      WHERE identity_key = $1
        AND status IN ('processing', 'pending_external_action', 'completed')
      LIMIT 1
      `,
      [identityKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async recordBlocked(userId: string, blockerCodes: string[]): Promise<void> {
    await this.client.query(
      `
      INSERT INTO account_deletion_requests (
        user_id,
        identity_id,
        status,
        blocker_codes
      )
      SELECT id, supabase_id, 'blocked', $2::text[]
      FROM users
      WHERE id = $1
        AND account_deletion_started_at IS NULL
      ON CONFLICT (user_id)
      DO UPDATE SET
        status = 'blocked',
        blocker_codes = EXCLUDED.blocker_codes,
        last_failure_code = NULL,
        next_retry_at = NULL,
        processing_token = NULL,
        processing_started_at = NULL,
        updated_at = NOW()
      WHERE account_deletion_requests.status = 'blocked'
      `,
      [userId, blockerCodes],
    );
  }

  public async claimRequest(
    input: ClaimAccountDeletionInput,
  ): Promise<AccountDeletionClaimResult> {
    return this.transactionRunner.transaction(async (client) => {
      const user = await this.lockUser(client, input.userId);
      if (user === null) {
        throw new ConflictError('Account is not available');
      }
      if (user.account_deleted_at !== null) {
        return { kind: 'completed' };
      }

      const existing = await this.readRequest(client, input.userId, true);
      if (existing?.status === 'completed') {
        return { kind: 'completed' };
      }
      if (
        user.account_deletion_started_at !== null
        && existing?.status !== 'blocked'
      ) {
        return { kind: 'in_progress' };
      }

      await this.lockMemberOrganizations(client, input.userId);
      const flight = await this.readFlight(client, input.userId);
      if (hasClaimBlocker(flight, input)) {
        return { kind: 'blocked', flight };
      }

      await client.query(
        `
        INSERT INTO account_deletion_requests (
          user_id,
          identity_id,
          identity_key,
          status,
          blocker_codes,
          processing_token,
          processing_started_at,
          next_retry_at,
          last_failure_code
        )
        VALUES ($1, $2, $3, 'processing', '{}', $4::uuid, NOW(), NULL, NULL)
        ON CONFLICT (user_id)
        DO UPDATE SET
          identity_id = EXCLUDED.identity_id,
          identity_key = EXCLUDED.identity_key,
          status = 'processing',
          blocker_codes = '{}',
          processing_token = EXCLUDED.processing_token,
          processing_started_at = NOW(),
          next_retry_at = NULL,
          last_failure_code = NULL,
          updated_at = NOW()
        WHERE account_deletion_requests.status = 'blocked'
        `,
        [
          input.userId,
          input.identityId,
          input.identityKey,
          input.processingToken,
        ],
      );
      await client.query(
        `
        UPDATE users
        SET account_deletion_started_at = COALESCE(account_deletion_started_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
        `,
        [input.userId],
      );

      const claimed = await this.readRequest(client, input.userId, true);
      if (
        claimed === null
        || claimed.processingToken !== input.processingToken
      ) {
        return { kind: 'in_progress' };
      }
      return { kind: 'claimed', request: claimed };
    });
  }

  public async claimNextRecoverable(
    processingToken: string,
  ): Promise<AccountDeletionRequestRecord | null> {
    return this.transactionRunner.transaction(async (client) => {
      const result = await client.query<RequestRow>(
        `
        WITH candidate AS (
          SELECT user_id
          FROM account_deletion_requests
          WHERE (
              status = 'pending_external_action'
              AND COALESCE(next_retry_at, updated_at) <= NOW()
            )
            OR (
              status = 'processing'
              AND processing_started_at < NOW() - INTERVAL '10 minutes'
            )
          ORDER BY COALESCE(next_retry_at, updated_at) ASC, user_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE account_deletion_requests AS requests
        SET status = 'processing',
            processing_token = $1::uuid,
            processing_started_at = NOW(),
            next_retry_at = NULL,
            last_failure_code = NULL,
            updated_at = NOW()
        FROM candidate
        WHERE requests.user_id = candidate.user_id
        RETURNING ${REQUEST_FIELDS}
        `,
        [processingToken],
      );
      return result.rows[0] === undefined ? null : mapRequest(result.rows[0]);
    });
  }

  public async markSubscriptionCancelled(
    userId: string,
    processingToken: string,
    subscriptionId: string,
  ): Promise<void> {
    await this.updateClaimed(
      userId,
      processingToken,
      `
      cancelled_subscription_ids = CASE
        WHEN $3 = ANY(cancelled_subscription_ids) THEN cancelled_subscription_ids
        ELSE array_append(cancelled_subscription_ids, $3)
      END
      `,
      subscriptionId,
    );
  }

  public async markAssetDeleted(
    userId: string,
    processingToken: string,
    key: string,
  ): Promise<void> {
    await this.updateClaimed(
      userId,
      processingToken,
      `
      scheduled_asset_keys = CASE
        WHEN $3 = ANY(scheduled_asset_keys) THEN scheduled_asset_keys
        ELSE array_append(scheduled_asset_keys, $3)
      END
      `,
      key,
    );
  }

  public async finalizePersonalData(
    userId: string,
    processingToken: string,
  ): Promise<AccountDeletionFinalizeResult> {
    return this.transactionRunner.transaction(async (client) => {
      const user = await this.lockUser(client, userId);
      if (user === null) {
        throw new ConflictError('Account is not available');
      }
      const request = await this.readRequest(client, userId, true);
      this.requireClaim(request, processingToken);
      if (request.dataAnonymized) {
        return { kind: 'completed' };
      }

      await this.lockMemberOrganizations(client, userId);
      const flight = await this.readFlight(client, userId);
      if (hasUnacknowledgeableBlocker(flight)) {
        return { kind: 'blocked', flight };
      }

      const uncancelledSubscriptions =
        flight.activePersonalStripeSubscriptionIds.filter(
          (id) => !request.cancelledSubscriptionIds.includes(id),
        );
      if (uncancelledSubscriptions.length > 0) {
        return {
          kind: 'uncancelled_subscriptions',
          subscriptionIds: uncancelledSubscriptions,
        };
      }
      const newAssets = flight.personalAssetKeys.filter(
        (key) => !request.deletedAssetKeys.includes(key),
      );
      if (newAssets.length > 0) {
        return { kind: 'new_assets', assetKeys: newAssets };
      }

      const originalEmail = await this.readUserEmail(client, userId);
      await client.query(
        `
        DELETE FROM entity_reference_upload_tokens
        WHERE user_id = $1
          AND organization_id IS NULL
        `,
        [userId],
      );
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [MOBILE_PUSH_TOKEN_REGISTRY_LOCK_KEY],
      );
      await client.query(
        `
        UPDATE mobile_push_notification_deliveries AS deliveries
        SET status = 'canceled',
            locked_at = NULL,
            lease_token = NULL,
            sent_at = NULL,
            error_code = NULL,
            updated_at = NOW()
        FROM mobile_push_notification_outbox AS outbox
        WHERE outbox.id = deliveries.outbox_id
          AND outbox.user_id = $1
          AND deliveries.status IN ('pending', 'processing')
        `,
        [userId],
      );
      await client.query('DELETE FROM mobile_push_tokens WHERE user_id = $1', [
        userId,
      ]);
      await client.query(
        `
        UPDATE generation_jobs
        SET params = '{}'::jsonb,
            result = NULL,
            sqs_message_id = NULL,
            openai_request_id = NULL,
            error_message = NULL
        WHERE user_id = $1
          AND organization_id IS NULL
        `,
        [userId],
      );
      await client.query(
        `
        DELETE FROM works
        WHERE user_id = $1
          AND organization_id IS NULL
        `,
        [userId],
      );
      await client.query(
        `
        UPDATE organization_invitations
        SET email = 'deleted+' || id::text || '@invalid.local',
            updated_at = NOW()
        WHERE accepted_by_user_id = $1
          OR lower(email) = lower($2)
        `,
        [userId, originalEmail],
      );
      await client.query('DELETE FROM organization_members WHERE user_id = $1', [
        userId,
      ]);
      await client.query('DELETE FROM credit_balances WHERE user_id = $1', [
        userId,
      ]);
      await client.query(
        `
        UPDATE users
        SET supabase_id = 'deleted:' || id::text,
            email = 'deleted+' || id::text || '@invalid.local',
            display_name = NULL,
            plan_code = 'free',
            account_deleted_at = COALESCE(account_deleted_at, NOW()),
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
          AND processing_token = $2::uuid
        `,
        [userId, processingToken],
      );
      return { kind: 'completed' };
    });
  }

  public async markIdentityDisabled(
    userId: string,
    processingToken: string,
  ): Promise<void> {
    await this.markTimestamp(userId, processingToken, 'identity_disabled_at');
  }

  public async markIdentityDeleted(
    userId: string,
    processingToken: string,
  ): Promise<void> {
    await this.markTimestamp(userId, processingToken, 'identity_deleted_at');
  }

  public async markCompleted(
    userId: string,
    processingToken: string,
  ): Promise<void> {
    const result = await this.client.query(
      `
      UPDATE account_deletion_requests
      SET identity_id = 'deleted:' || user_id::text,
          status = 'completed',
          blocker_codes = '{}',
          cancelled_subscription_ids = '{}',
          scheduled_asset_keys = '{}',
          last_failure_code = NULL,
          next_retry_at = NULL,
          processing_token = NULL,
          processing_started_at = NULL,
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE user_id = $1
        AND processing_token = $2::uuid
        AND data_anonymized_at IS NOT NULL
        AND identity_deleted_at IS NOT NULL
      `,
      [userId, processingToken],
    );
    this.requireUpdated(result.rowCount);
  }

  public async recordFailure(
    userId: string,
    processingToken: string,
    failureCode: string,
  ): Promise<void> {
    const result = await this.client.query(
      `
      UPDATE account_deletion_requests
      SET status = 'pending_external_action',
          last_failure_code = $3,
          retry_count = retry_count + 1,
          next_retry_at = NOW() + (
            LEAST(21600, 30 * POWER(2, LEAST(retry_count, 10)))
            * INTERVAL '1 second'
          ),
          processing_token = NULL,
          processing_started_at = NULL,
          updated_at = NOW()
      WHERE user_id = $1
        AND processing_token = $2::uuid
      `,
      [userId, processingToken, failureCode],
    );
    this.requireUpdated(result.rowCount);
  }

  public async releaseForContinuation(
    userId: string,
    processingToken: string,
  ): Promise<void> {
    const result = await this.client.query(
      `
      UPDATE account_deletion_requests
      SET status = 'pending_external_action',
          last_failure_code = NULL,
          next_retry_at = NOW(),
          processing_token = NULL,
          processing_started_at = NULL,
          updated_at = NOW()
      WHERE user_id = $1
        AND processing_token = $2::uuid
      `,
      [userId, processingToken],
    );
    this.requireUpdated(result.rowCount);
  }

  private async readFlight(
    client: DatabaseClient,
    userId: string,
  ): Promise<AccountDeletionFlight> {
    // This helper also runs inside a PostgreSQL transaction client. Execute
    // sequentially so one connection never receives overlapping queries.
    const organizations = await client.query<OrganizationRow>(
        `
        SELECT organizations.id, organizations.name
        FROM organization_members
        INNER JOIN organizations
          ON organizations.id = organization_members.organization_id
        WHERE organization_members.user_id = $1
          AND organization_members.role = 'owner'
          AND organization_members.status = 'active'
          AND (
            SELECT COUNT(*)
            FROM organization_members AS owners
            WHERE owners.organization_id = organization_members.organization_id
              AND owners.role = 'owner'
              AND owners.status = 'active'
          ) = 1
        ORDER BY organizations.name ASC, organizations.id ASC
        LIMIT 25
        `,
        [userId],
      );
    const stripeSubscriptions = await client.query<SubscriptionRow>(
        `
        SELECT stripe_subscription_id
        FROM subscriptions
        WHERE user_id = $1
          AND organization_id IS NULL
          AND status NOT IN ('canceled', 'incomplete_expired')
        ORDER BY stripe_subscription_id ASC
        `,
        [userId],
      );
    const storeSubscriptions = await client.query<StoreSubscriptionRow>(
        `
        SELECT store, expires_at, auto_renew_enabled
        FROM mobile_store_purchases
        WHERE user_id = $1
          AND kind = 'subscription'
          AND (
            state IN ('pending', 'active')
            OR (
              state = 'cancelled'
              AND expires_at IS NOT NULL
              AND expires_at > NOW()
            )
          )
        ORDER BY store ASC, expires_at DESC NULLS LAST, id ASC
        `,
        [userId],
      );
    const generationJobs = await client.query<CountRow>(
        `
        SELECT COUNT(*)::text AS count
        FROM generation_jobs
        WHERE user_id = $1
          AND organization_id IS NULL
          AND status IN ('queued', 'processing')
        `,
        [userId],
      );
    const exportJobs = await client.query<CountRow>(
        `
        SELECT COUNT(*)::text AS count
        FROM episode_export_jobs
        WHERE user_id = $1
          AND organization_id IS NULL
          AND status IN ('queued', 'processing')
        `,
        [userId],
      );
    const assetKeys = await client.query<AssetKeyRow>(
      PERSONAL_ASSET_KEYS_SQL,
      [userId],
    );

    return {
      uniqueOwnerOrganizations: organizations.rows.map((row) => ({
        id: row.id,
        name: row.name,
      })),
      activePersonalStripeSubscriptionIds: stripeSubscriptions.rows.map(
        (row) => row.stripe_subscription_id,
      ),
      activeStoreSubscriptions: storeSubscriptions.rows.map((row) => ({
        store: row.store,
        expiresAt: row.expires_at,
        autoRenewEnabled: row.auto_renew_enabled,
      })),
      personalAssetKeys: assetKeys.rows.map((row) => row.s3_key),
      activePersonalGenerationJobCount: parseCount(generationJobs.rows[0]),
      activePersonalExportJobCount: parseCount(exportJobs.rows[0]),
    };
  }

  private async readRequest(
    client: DatabaseClient,
    userId: string,
    forUpdate = false,
  ): Promise<AccountDeletionRequestRecord | null> {
    const result = await client.query<RequestRow>(
      `
      SELECT ${REQUEST_FIELDS}
      FROM account_deletion_requests
      WHERE user_id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [userId],
    );
    return result.rows[0] === undefined ? null : mapRequest(result.rows[0]);
  }

  private async lockUser(
    client: DatabaseClient,
    userId: string,
  ): Promise<UserDeletionRow | null> {
    const result = await client.query<UserDeletionRow>(
      `
      SELECT account_deletion_started_at, account_deleted_at
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  private async lockMemberOrganizations(
    client: DatabaseClient,
    userId: string,
  ): Promise<void> {
    await client.query(
      `
      SELECT organizations.id
      FROM organizations
      INNER JOIN organization_members
        ON organization_members.organization_id = organizations.id
      WHERE organization_members.user_id = $1
        AND organization_members.status = 'active'
      ORDER BY organizations.id ASC
      FOR UPDATE OF organizations
      `,
      [userId],
    );
  }

  private async readUserEmail(
    client: DatabaseClient,
    userId: string,
  ): Promise<string> {
    const result = await client.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [userId],
    );
    const email = result.rows[0]?.email;
    if (email === undefined) {
      throw new ConflictError('Account is not available');
    }
    return email;
  }

  private async updateClaimed(
    userId: string,
    processingToken: string,
    assignment: string,
    value: string,
  ): Promise<void> {
    const result = await this.client.query(
      `
      UPDATE account_deletion_requests
      SET ${assignment},
          updated_at = NOW()
      WHERE user_id = $1
        AND processing_token = $2::uuid
      `,
      [userId, processingToken, value],
    );
    this.requireUpdated(result.rowCount);
  }

  private async markTimestamp(
    userId: string,
    processingToken: string,
    column: 'identity_disabled_at' | 'identity_deleted_at',
  ): Promise<void> {
    const result = await this.client.query(
      `
      UPDATE account_deletion_requests
      SET ${column} = COALESCE(${column}, NOW()),
          updated_at = NOW()
      WHERE user_id = $1
        AND processing_token = $2::uuid
      `,
      [userId, processingToken],
    );
    this.requireUpdated(result.rowCount);
  }

  private requireClaim(
    request: AccountDeletionRequestRecord | null,
    processingToken: string,
  ): asserts request is AccountDeletionRequestRecord {
    if (
      request === null
      || request.status !== 'processing'
      || request.processingToken !== processingToken
    ) {
      throw new ConflictError('Account deletion claim is stale');
    }
  }

  private requireUpdated(rowCount: number | null): void {
    if (rowCount !== 1) {
      throw new ConflictError('Account deletion claim is stale');
    }
  }
}

const REQUEST_FIELDS = `
  user_id,
  identity_id,
  status,
  processing_token,
  cancelled_subscription_ids,
  scheduled_asset_keys,
  data_anonymized_at,
  identity_disabled_at,
  identity_deleted_at
`;

const PERSONAL_ASSET_KEYS_SQL = `
  WITH personal_works AS (
    SELECT id
    FROM works
    WHERE user_id = $1
      AND organization_id IS NULL
  ),
  personal_page_images AS (
    SELECT pages.generated_image->>'s3_key' AS s3_key
    FROM pages
    INNER JOIN episodes ON episodes.id = pages.episode_id
    INNER JOIN chapters ON chapters.id = episodes.chapter_id
    INNER JOIN personal_works ON personal_works.id = chapters.work_id
    WHERE pages.generated_image IS NOT NULL
  ),
  personal_reference_images AS (
    SELECT reference_image->>'s3_key' AS s3_key
    FROM reference_sets
    INNER JOIN entities ON entities.id = reference_sets.entity_id
    INNER JOIN personal_works ON personal_works.id = entities.work_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(reference_sets.reference_images) = 'array'
          THEN reference_sets.reference_images
        ELSE '[]'::jsonb
      END
    ) AS reference_image
  ),
  personal_job_candidates AS (
    SELECT candidate->>'s3_key' AS s3_key
    FROM generation_jobs
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(generation_jobs.result->'candidates') = 'array'
          THEN generation_jobs.result->'candidates'
        ELSE '[]'::jsonb
      END
    ) AS candidate
    WHERE generation_jobs.user_id = $1
      AND generation_jobs.organization_id IS NULL
  ),
  personal_job_sources AS (
    SELECT params->>'source_s3_key' AS s3_key
    FROM generation_jobs
    WHERE user_id = $1
      AND organization_id IS NULL
      AND params ? 'source_s3_key'
  ),
  personal_uploads AS (
    SELECT s3_key
    FROM entity_reference_upload_tokens
    WHERE user_id = $1
      AND organization_id IS NULL
  ),
  personal_exports AS (
    SELECT artifact_s3_key AS s3_key
    FROM episode_export_jobs
    WHERE user_id = $1
      AND organization_id IS NULL
      AND artifact_s3_key IS NOT NULL
      AND artifact_deleted_at IS NULL
  )
  SELECT DISTINCT s3_key
  FROM (
    SELECT s3_key FROM personal_page_images
    UNION ALL
    SELECT s3_key FROM personal_reference_images
    UNION ALL
    SELECT s3_key FROM personal_job_candidates
    UNION ALL
    SELECT s3_key FROM personal_job_sources
    UNION ALL
    SELECT s3_key FROM personal_uploads
    UNION ALL
    SELECT s3_key FROM personal_exports
  ) AS keys
  WHERE s3_key IS NOT NULL
    AND s3_key <> ''
  ORDER BY s3_key ASC
`;

function mapRequest(row: RequestRow): AccountDeletionRequestRecord {
  if (row.processing_token === null && row.status === 'processing') {
    throw new Error('Processing account deletion request has no claim token');
  }
  return {
    userId: row.user_id,
    identityId: row.identity_id,
    status: row.status,
    processingToken: row.processing_token ?? '',
    cancelledSubscriptionIds: row.cancelled_subscription_ids,
    deletedAssetKeys: row.scheduled_asset_keys,
    dataAnonymized: row.data_anonymized_at !== null,
    identityDisabled: row.identity_disabled_at !== null,
    identityDeleted: row.identity_deleted_at !== null,
  };
}

function parseCount(row: CountRow | undefined): number {
  const value = Number(row?.count ?? '0');
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function hasUnacknowledgeableBlocker(flight: AccountDeletionFlight): boolean {
  return (
    flight.uniqueOwnerOrganizations.length > 0
    || flight.activePersonalGenerationJobCount > 0
    || flight.activePersonalExportJobCount > 0
  );
}

function hasClaimBlocker(
  flight: AccountDeletionFlight,
  input: Pick<
    ClaimAccountDeletionInput,
    | 'acknowledgePersonalSubscriptions'
    | 'acknowledgeStoreBilling'
    | 'acknowledgePersonalAssets'
  >,
): boolean {
  return (
    hasUnacknowledgeableBlocker(flight)
    || (
      flight.activePersonalStripeSubscriptionIds.length > 0
      && !input.acknowledgePersonalSubscriptions
    )
    || (
      flight.activeStoreSubscriptions.length > 0
      && !input.acknowledgeStoreBilling
    )
    || (
      flight.personalAssetKeys.length > 0
      && !input.acknowledgePersonalAssets
    )
  );
}
