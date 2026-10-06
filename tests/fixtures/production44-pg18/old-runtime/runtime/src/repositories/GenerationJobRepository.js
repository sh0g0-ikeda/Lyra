import { createGenerationJobCreditSettlement } from '../domain/types/job.js';
import { ConfigurationError, ConflictError, ValidationError } from '../domain/errors/index.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';
const DEFAULT_CAPACITY_JOB_TYPES = [
    'page_generate',
    'entity_generate',
];
export class PostgresGenerationJobRepository {
    client;
    static advisoryLockNamespace = 81_527;
    constructor(client) {
        this.client = client;
    }
    async create(input) {
        const capacityLimits = input.capacityLimits;
        if (capacityLimits !== undefined) {
            const transactionRunner = this.requireTransactionRunnerForCapacity();
            return transactionRunner.transaction(async (transactionClient) => {
                const scope = getGenerationCapacityScope(input.userId, input.organizationId ?? null);
                await this.lockGenerationCapacity(transactionClient, scope);
                await this.assertCapacityWithinTransaction(transactionClient, scope, capacityLimits);
                return this.insertJob(transactionClient, input);
            });
        }
        return this.insertJob(this.client, input);
    }
    async insertJob(client, input) {
        const result = await client.query(`
      INSERT INTO generation_jobs (
        id,
        user_id,
        organization_id,
        job_type,
        generation_mode,
        credit_cost,
        params,
        expires_at
      )
      VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb, NOW() + INTERVAL '7 days')
      RETURNING *
      `, [
            input.id ?? null,
            input.userId,
            input.organizationId ?? null,
            input.jobType,
            input.generationMode,
            input.creditCost,
            JSON.stringify(input.params),
        ]);
        return mapGenerationJobRow(result.rows[0]);
    }
    async lockGenerationCapacity(client, scope) {
        await client.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)', [PostgresGenerationJobRepository.advisoryLockNamespace, 'generation_jobs:global']);
        await client.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)', [PostgresGenerationJobRepository.advisoryLockNamespace, formatGenerationCapacityScopeKey(scope)]);
    }
    async assertCapacityWithinTransaction(client, scope, limits) {
        const jobTypes = normalizeCapacityJobTypes(limits.jobTypes);
        const activeForScope = await this.countActiveGenerationJobsByScopeWithClient(client, scope, jobTypes);
        if (activeForScope >= limits.perUser) {
            throw new ConflictError('Generation scope has too many active generation jobs');
        }
        const activeGlobally = await this.countActiveGenerationJobsWithClient(client, jobTypes);
        if (activeGlobally >= limits.global) {
            throw new ConflictError('Generation queue is temporarily full');
        }
    }
    async findByIdAndUserId(jobId, userId, organizationId = null) {
        const result = await this.client.query(`
      SELECT generation_jobs.*
      FROM generation_jobs
      WHERE id = $1
        AND (
          ($3::uuid IS NULL
            AND generation_jobs.user_id = $2
            AND generation_jobs.organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND generation_jobs.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = generation_jobs.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      `, [jobId, userId, organizationId]);
        return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
    }
    async findByIdForScope(input) {
        return this.findScopedJobWithClient(this.client, input, false);
    }
    async listForScope(input) {
        if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 100) {
            throw new ValidationError('Job list limit must be between 1 and 100');
        }
        const scopeSql = buildGenerationJobScopeSql('generation_jobs', input.capability, 1, 2);
        const result = await this.client.query(`
      WITH visible_jobs AS (
        SELECT
          generation_jobs.*,
          CASE WHEN generation_jobs.status IN ('queued', 'processing') THEN 0 ELSE 1 END AS active_rank
        FROM generation_jobs
        WHERE ${scopeSql}
          AND NOT EXISTS (
            SELECT 1
            FROM generation_job_history_hides
            WHERE generation_job_history_hides.generation_job_id = generation_jobs.id
              AND generation_job_history_hides.user_id = $1
          )
          AND (cardinality($3::text[]) = 0 OR generation_jobs.status = ANY($3::text[]))
          AND (cardinality($4::text[]) = 0 OR generation_jobs.job_type = ANY($4::text[]))
      ),
      settled_jobs AS (
        SELECT
          visible_jobs.*,
          credit_settlement.charged_credits,
          credit_settlement.refunded_credits
        FROM visible_jobs
        ${buildGenerationJobCreditSettlementLateralJoin('visible_jobs')}
      )
      SELECT *
      FROM settled_jobs
      WHERE (
        $5::int IS NULL
        OR active_rank > $5::int
        OR (
          active_rank = $5::int
          AND (
            created_at < $6::timestamptz
            OR (created_at = $6::timestamptz AND id < $7::uuid)
          )
        )
      )
      ORDER BY active_rank ASC, created_at DESC, id DESC
      LIMIT $8
      `, [
            input.userId,
            input.organizationId,
            [...input.statuses],
            [...input.jobTypes],
            input.cursor?.activeRank ?? null,
            input.cursor?.createdAt ?? null,
            input.cursor?.id ?? null,
            input.limit + 1,
        ]);
        const hasMore = result.rows.length > input.limit;
        const rows = hasMore ? result.rows.slice(0, input.limit) : result.rows;
        const lastRow = rows.at(-1);
        return {
            jobs: rows.map(mapGenerationJobRow),
            nextCursor: hasMore && lastRow !== undefined
                ? {
                    activeRank: lastRow.active_rank,
                    createdAt: lastRow.created_at,
                    id: lastRow.id,
                }
                : null,
        };
    }
    async cancelQueuedForScope(input) {
        const transactionRunner = this.requireTransactionRunnerForJobManagement();
        return transactionRunner.transaction(async (client) => {
            const candidate = await this.findScopedJobWithClient(client, input, false);
            if (candidate === null) {
                return { kind: 'not_found' };
            }
            // Generation producers and the late-consume trigger lock the balance first,
            // then the job row. Keep the same order to avoid cancellation/refund races.
            if (candidate.creditCost > 0) {
                await this.lockCreditBalanceForJob(client, candidate);
            }
            const job = await this.findScopedJobWithClient(client, input, true);
            if (job === null) {
                return { kind: 'not_found' };
            }
            if (job.status === 'processing') {
                return { kind: 'processing', job };
            }
            if (job.status !== 'queued') {
                return { kind: 'terminal', job };
            }
            const canceledResult = await client.query(`
        UPDATE generation_jobs
        SET status = 'cancelled',
            cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
            cancel_requested_by = COALESCE(cancel_requested_by, $2::uuid),
            cancelled_at = COALESCE(cancelled_at, NOW()),
            completed_at = NOW(),
            error_message = NULL
        WHERE id = $1
          AND status = 'queued'
        RETURNING *
        `, [job.id, input.userId]);
            const canceledRow = canceledResult.rows[0];
            if (canceledRow === undefined) {
                const current = await this.findScopedJobWithClient(client, input, true);
                return current === null || current.status === 'queued'
                    ? { kind: 'not_found' }
                    : current.status === 'processing'
                        ? { kind: 'processing', job: current }
                        : { kind: 'terminal', job: current };
            }
            const canceledJob = mapGenerationJobRow(canceledRow);
            const refundedCredits = await this.refundCanceledJobCredits(client, canceledJob, input.userId);
            await this.recordOrganizationCancellation(client, canceledJob, input.userId, refundedCredits);
            const settledCanceledJob = await this.findScopedJobWithClient(client, input, false);
            return {
                kind: 'canceled',
                job: settledCanceledJob ?? canceledJob,
                refundedCredits,
            };
        });
    }
    async cancelForScope(input) {
        const immediate = await this.cancelQueuedForScope(input);
        if (immediate.kind !== 'processing') {
            return immediate;
        }
        const result = await this.client.query(`
      UPDATE generation_jobs
      SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
          cancel_requested_by = COALESCE(cancel_requested_by, $2::uuid)
      WHERE id = $1
        AND status = 'processing'
        AND commit_started_at IS NULL
        AND ${buildGenerationJobScopeSql('generation_jobs', input.capability, 2, 3)}
      RETURNING *
      `, [input.jobId, input.userId, input.organizationId]);
        const requested = result.rows[0];
        if (requested !== undefined) {
            const settled = await this.findScopedJobWithClient(this.client, input, false);
            return {
                kind: 'requested',
                job: settled ?? mapGenerationJobRow(requested),
            };
        }
        const current = await this.findScopedJobWithClient(this.client, input, false);
        return current === null
            ? { kind: 'not_found' }
            : { kind: 'terminal', job: current };
    }
    async finalizeCancellationIfRequested(jobId) {
        const transactionRunner = this.requireTransactionRunnerForJobManagement();
        return transactionRunner.transaction(async (client) => {
            const candidate = await this.findJobByIdWithClient(client, jobId, false);
            if (candidate === null ||
                candidate.status !== 'processing' ||
                candidate.cancelRequestedAt === null ||
                candidate.cancelRequestedAt === undefined) {
                return false;
            }
            // Credit producers and the queued-cancel path acquire the balance before
            // the job row. Keep this order for processing cancellation as well.
            if (candidate.creditCost > 0) {
                await this.lockCreditBalanceForJob(client, candidate);
            }
            const job = await this.findJobByIdWithClient(client, jobId, true);
            if (job === null ||
                job.status !== 'processing' ||
                job.cancelRequestedAt === null ||
                job.cancelRequestedAt === undefined) {
                return false;
            }
            const canceledResult = await client.query(`
        UPDATE generation_jobs
        SET status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, NOW()),
            completed_at = NOW(),
            error_message = NULL
        WHERE id = $1
          AND status = 'processing'
          AND cancel_requested_at IS NOT NULL
          AND commit_started_at IS NULL
        RETURNING *
        `, [job.id]);
            const canceledRow = canceledResult.rows[0];
            if (canceledRow === undefined) {
                return false;
            }
            const canceledJob = mapGenerationJobRow(canceledRow);
            const actorUserId = canceledJob.cancelRequestedBy ?? canceledJob.userId;
            const refundedCredits = await this.refundCanceledJobCredits(client, canceledJob, actorUserId);
            await this.recordOrganizationCancellation(client, canceledJob, actorUserId, refundedCredits);
            return true;
        });
    }
    async hideFromHistory(input) {
        const transactionRunner = this.requireTransactionRunnerForJobManagement();
        return transactionRunner.transaction(async (client) => {
            const job = await this.findScopedJobWithClient(client, input, true, true);
            if (job === null) {
                return { kind: 'not_found' };
            }
            if (!isTerminalGenerationJobStatus(job.status)) {
                return { kind: 'active', job };
            }
            await client.query(`
        INSERT INTO generation_job_history_hides (generation_job_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (generation_job_id, user_id) DO NOTHING
        `, [job.id, input.userId]);
            return { kind: 'hidden', job };
        });
    }
    async findActivePageGenerationJob(userId, pageId, organizationId = null) {
        return this.findActiveResourceJob(userId, 'page_generate', 'page_id', pageId, organizationId);
    }
    async findActiveEntityGenerationJob(userId, entityId, organizationId = null) {
        return this.findActiveResourceJob(userId, 'entity_generate', 'entity_id', entityId, organizationId);
    }
    async findActiveEpisodeStoryAutofillJob(userId, episodeId, organizationId = null) {
        return this.findActiveResourceJob(userId, 'episode_story_autofill', 'episode_id', episodeId, organizationId);
    }
    async findActiveEpisodePageSkeletonJob(userId, episodeId, organizationId = null) {
        return this.findActiveResourceJob(userId, 'episode_page_skeleton', 'episode_id', episodeId, organizationId);
    }
    async countActiveGenerationJobsByUser(userId, jobTypes = DEFAULT_CAPACITY_JOB_TYPES) {
        return this.countActiveGenerationJobsByUserWithClient(this.client, userId, normalizeCapacityJobTypes(jobTypes));
    }
    async countActiveGenerationJobsByUserWithClient(client, userId, jobTypes) {
        return this.countActiveGenerationJobsByScopeWithClient(client, { userId, organizationId: null }, jobTypes);
    }
    async countActiveGenerationJobsByScopeWithClient(client, scope, jobTypes) {
        const result = await client.query(`
      SELECT COUNT(*)::text AS count
      FROM generation_jobs
      WHERE (
          ($1::uuid IS NULL AND user_id = $2 AND organization_id IS NULL)
          OR ($1::uuid IS NOT NULL AND organization_id = $1::uuid)
        )
        AND job_type = ANY($3::text[])
        AND status IN ('queued', 'processing')
      `, [scope.organizationId, scope.userId, [...jobTypes]]);
        return Number(result.rows[0]?.count ?? '0');
    }
    async countActiveGenerationJobs(jobTypes = DEFAULT_CAPACITY_JOB_TYPES) {
        return this.countActiveGenerationJobsWithClient(this.client, normalizeCapacityJobTypes(jobTypes));
    }
    async countActiveGenerationJobsWithClient(client, jobTypes) {
        const result = await client.query(`
      SELECT COUNT(*)::text AS count
      FROM generation_jobs
      WHERE job_type = ANY($1::text[])
        AND status IN ('queued', 'processing')
      `, [[...jobTypes]]);
        return Number(result.rows[0]?.count ?? '0');
    }
    async attachQueueMessageId(jobId, messageId) {
        const result = await this.client.query(`
      UPDATE generation_jobs
      SET sqs_message_id = $2
      WHERE id = $1
      RETURNING *
      `, [jobId, messageId]);
        return (result.rowCount ?? 0) > 0;
    }
    async requestCancellation(jobId, userId, organizationId = null) {
        const result = await this.client.query(`
      UPDATE generation_jobs
      SET cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
          cancel_requested_by = COALESCE(cancel_requested_by, $2::uuid),
          status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
          cancelled_at = CASE WHEN status = 'queued' THEN NOW() ELSE cancelled_at END,
          completed_at = CASE WHEN status = 'queued' THEN NOW() ELSE completed_at END,
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'progress_stage', CASE WHEN status = 'queued' THEN 'cancelled' ELSE 'cancellation_requested' END,
            'progress_message', CASE
              WHEN status = 'queued' THEN 'Story plan autofill was stopped.'
              ELSE 'Stop requested. The current safe step will finish before stopping.'
            END,
            'progress_updated_at', NOW()
          )
      WHERE id = $1
        AND (
          ($3::uuid IS NULL
            AND generation_jobs.user_id = $2
            AND generation_jobs.organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND generation_jobs.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = generation_jobs.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
        AND job_type = 'episode_story_autofill'
        AND status IN ('queued', 'processing')
        AND commit_started_at IS NULL
      RETURNING *
      `, [jobId, userId, organizationId]);
        return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
    }
    async finalizeCancellation(jobId) {
        const result = await this.client.query(`
      UPDATE generation_jobs
      SET status = 'cancelled',
          cancelled_at = COALESCE(cancelled_at, NOW()),
          completed_at = COALESCE(completed_at, NOW()),
          error_message = NULL,
          result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'progress_stage', 'cancelled',
            'progress_message', 'Story plan autofill was stopped.',
            'progress_updated_at', NOW()
          )
      WHERE id = $1
        AND job_type = 'episode_story_autofill'
        AND status = 'processing'
        AND cancel_requested_at IS NOT NULL
        AND commit_started_at IS NULL
      RETURNING *
      `, [jobId]);
        return (result.rowCount ?? 0) > 0;
    }
    async markFailed(jobId, errorMessage) {
        const persistedErrorMessage = sanitizePersistedErrorMessage(errorMessage, 'Generation job failed');
        const result = await this.client.query(`
      UPDATE generation_jobs
      SET status = 'failed',
          error_message = $2,
          completed_at = NOW()
      WHERE id = $1
        AND status IN ('queued', 'processing')
        AND cancel_requested_at IS NULL
      RETURNING *
      `, [jobId, persistedErrorMessage]);
        return (result.rowCount ?? 0) > 0;
    }
    async prepareRetry(jobId, maxRetryCount, options) {
        if (options !== undefined) {
            const transactionRunner = this.requireTransactionRunnerForCapacity();
            return transactionRunner.transaction(async (transactionClient) => {
                const scope = getGenerationCapacityScope(options.userId, options.organizationId ?? null);
                await this.lockGenerationCapacity(transactionClient, scope);
                await this.assertCapacityWithinTransaction(transactionClient, scope, options.capacityLimits);
                return this.prepareRetryWithClient(transactionClient, jobId, maxRetryCount);
            });
        }
        return this.prepareRetryWithClient(this.client, jobId, maxRetryCount);
    }
    async findScopedJobWithClient(client, input, forUpdate, includeHistoryHidden = false) {
        const scopeSql = buildGenerationJobScopeSql('generation_jobs', input.capability, 2, 3);
        const result = await client.query(`
      WITH scoped_job AS (
        SELECT generation_jobs.*
        FROM generation_jobs
        WHERE generation_jobs.id = $1
          AND ${scopeSql}
          ${includeHistoryHidden ? '' : `
          AND NOT EXISTS (
            SELECT 1
            FROM generation_job_history_hides
            WHERE generation_job_history_hides.generation_job_id = generation_jobs.id
              AND generation_job_history_hides.user_id = $2
          )`}
        ${forUpdate ? 'FOR UPDATE' : ''}
      )
      SELECT
        scoped_job.*,
        credit_settlement.charged_credits,
        credit_settlement.refunded_credits
      FROM scoped_job
      ${buildGenerationJobCreditSettlementLateralJoin('scoped_job')}
      `, [input.jobId, input.userId, input.organizationId]);
        return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
    }
    async findJobByIdWithClient(client, jobId, forUpdate) {
        const result = await client.query(`
      SELECT *
      FROM generation_jobs
      WHERE id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}
      `, [jobId]);
        return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
    }
    async lockCreditBalanceForJob(client, job) {
        if ((job.organizationId ?? null) === null) {
            await client.query(`
        INSERT INTO credit_balances (user_id, monthly_credits, purchased_credits)
        VALUES ($1, 0, 0)
        ON CONFLICT (user_id) DO NOTHING
        `, [job.userId]);
            const result = await client.query(`
        SELECT monthly_credits, purchased_credits, monthly_expires_at
        FROM credit_balances
        WHERE user_id = $1
        FOR UPDATE
        `, [job.userId]);
            const balance = result.rows[0];
            if (balance === undefined) {
                throw new ConfigurationError('Personal credit balance could not be locked');
            }
            return balance;
        }
        const organizationId = job.organizationId ?? null;
        if (organizationId === null) {
            throw new ConfigurationError('Organization generation job is missing its organization scope');
        }
        await client.query(`
      INSERT INTO organization_credit_balances (organization_id)
      VALUES ($1)
      ON CONFLICT (organization_id) DO NOTHING
      `, [organizationId]);
        const result = await client.query(`
      SELECT monthly_credits, purchased_credits, monthly_expires_at
      FROM organization_credit_balances
      WHERE organization_id = $1
      FOR UPDATE
      `, [organizationId]);
        const balance = result.rows[0];
        if (balance === undefined) {
            throw new ConfigurationError('Organization credit balance could not be locked');
        }
        return balance;
    }
    async refundCanceledJobCredits(client, job, actorUserId) {
        if (job.creditCost <= 0) {
            return 0;
        }
        const ledgerSummaryResult = await client.query(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'consume'), 0)::text AS consumed_amount,
        COALESCE(SUM(amount) FILTER (WHERE type = 'refund'), 0)::text AS refunded_amount,
        COALESCE(SUM(monthly_delta) FILTER (WHERE type = 'consume'), 0)::text AS consumed_monthly_delta,
        COALESCE(SUM(purchased_delta) FILTER (WHERE type = 'consume'), 0)::text AS consumed_purchased_delta,
        COALESCE(SUM(monthly_delta) FILTER (WHERE type = 'refund'), 0)::text AS refunded_monthly_delta,
        COALESCE(SUM(purchased_delta) FILTER (WHERE type = 'refund'), 0)::text AS refunded_purchased_delta,
        COUNT(*) FILTER (WHERE type = 'consume')::text AS consumed_entry_count,
        COUNT(*) FILTER (WHERE type = 'refund')::text AS refunded_entry_count,
        COUNT(*) FILTER (
          WHERE type = 'consume'
            AND monthly_delta IS NOT NULL
            AND purchased_delta IS NOT NULL
        )::text AS consumed_complete_entry_count,
        COUNT(*) FILTER (
          WHERE type = 'refund'
            AND monthly_delta IS NOT NULL
            AND purchased_delta IS NOT NULL
        )::text AS refunded_complete_entry_count
      FROM credit_ledger
      WHERE job_id = $1
        AND (
          ($2::uuid IS NULL AND organization_id IS NULL AND user_id = $3)
          OR ($2::uuid IS NOT NULL AND organization_id = $2::uuid)
        )
      `, [job.id, job.organizationId ?? null, job.userId]);
        const refund = calculateCanceledJobRefund(ledgerSummaryResult.rows[0], job.creditCost);
        if (refund === null) {
            return 0;
        }
        const balance = await this.lockCreditBalanceForJob(client, job);
        const monthlyExpired = balance.monthly_expires_at !== null && balance.monthly_expires_at.getTime() <= Date.now();
        const monthlyDelta = monthlyExpired ? 0 : refund.monthlyDelta;
        const purchasedDelta = refund.purchasedDelta + (monthlyExpired ? refund.monthlyDelta : 0);
        const nextMonthly = (monthlyExpired ? 0 : balance.monthly_credits) + monthlyDelta;
        const nextPurchased = balance.purchased_credits + purchasedDelta;
        const organizationId = job.organizationId ?? null;
        if (organizationId === null) {
            await client.query(`
        UPDATE credit_balances
        SET monthly_credits = $2,
            purchased_credits = $3,
            updated_at = NOW()
        WHERE user_id = $1
        `, [job.userId, nextMonthly, nextPurchased]);
        }
        else {
            await client.query(`
        UPDATE organization_credit_balances
        SET monthly_credits = $2,
            purchased_credits = $3,
            updated_at = NOW()
        WHERE organization_id = $1
        `, [organizationId, nextMonthly, nextPurchased]);
        }
        await client.query(`
      INSERT INTO credit_ledger (
        user_id, organization_id, type, amount, monthly_delta, purchased_delta,
        monthly_after, purchased_after, description, job_id
      )
      VALUES ($1, $2, 'refund', $3, $4, $5, $6, $7, $8, $9)
      `, [
            actorUserId,
            organizationId,
            refund.amount,
            monthlyDelta,
            purchasedDelta,
            nextMonthly,
            nextPurchased,
            'Refund for canceled queued generation job',
            job.id,
        ]);
        return refund.amount;
    }
    async recordOrganizationCancellation(client, job, actorUserId, refundedCredits) {
        const organizationId = job.organizationId ?? null;
        if (organizationId === null) {
            return;
        }
        await client.query(`
      INSERT INTO organization_usage_events (
        organization_id, user_id, generation_job_id, event_type, credit_amount, metadata
      )
      VALUES ($1, $2, $3, 'generation.canceled', 0, $4::jsonb)
      `, [organizationId, actorUserId, job.id, JSON.stringify({ credits_refunded: refundedCredits })]);
        await client.query(`
      INSERT INTO organization_audit_logs (
        organization_id, actor_user_id, action, target_type, target_id, metadata
      )
      VALUES ($1, $2, 'generation.canceled', 'generation_job', $3, $4::jsonb)
      `, [organizationId, actorUserId, job.id, JSON.stringify({ credits_refunded: refundedCredits })]);
    }
    requireTransactionRunnerForCapacity() {
        if (!isTransactionRunner(this.client)) {
            throw new ConfigurationError('Generation job capacity limits require a transaction-capable database client');
        }
        return this.client;
    }
    requireTransactionRunnerForJobManagement() {
        if (!isTransactionRunner(this.client)) {
            throw new ConfigurationError('Generation job management requires a transaction-capable database client');
        }
        return this.client;
    }
    async prepareRetryWithClient(client, jobId, maxRetryCount) {
        const result = await client.query(`
      UPDATE generation_jobs
      SET status = 'queued',
          retry_count = retry_count + 1,
          started_at = NULL,
          completed_at = NULL,
          error_message = NULL,
          openai_request_id = NULL,
          sqs_message_id = NULL,
          cancel_requested_at = NULL,
          cancel_requested_by = NULL,
          cancelled_at = NULL,
          commit_started_at = NULL
      WHERE id = $1
        AND status = 'failed'
        AND retry_count < $2
      RETURNING *
      `, [jobId, maxRetryCount]);
        return (result.rowCount ?? 0) > 0;
    }
    async pruneExpiredTerminalJobs(input) {
        if (!Number.isSafeInteger(input.maxDeletes) || input.maxDeletes <= 0) {
            throw new Error('maxDeletes must be a positive safe integer');
        }
        const candidateIds = await this.findExpiredTerminalJobIds(input.maxDeletes + 1);
        const truncated = candidateIds.length > input.maxDeletes;
        const idsToDelete = candidateIds.slice(0, input.maxDeletes);
        if (input.dryRun || idsToDelete.length === 0) {
            return {
                dryRun: input.dryRun,
                candidateCount: idsToDelete.length,
                deletedCount: 0,
                candidateIds: idsToDelete,
                truncated,
            };
        }
        const deletedResult = await this.client.query(`
      DELETE FROM generation_jobs
      WHERE id = ANY($1::uuid[])
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
        AND status IN ('completed', 'failed', 'cancelled')
      RETURNING id
      `, [idsToDelete]);
        return {
            dryRun: false,
            candidateCount: idsToDelete.length,
            deletedCount: deletedResult.rows.length,
            candidateIds: deletedResult.rows.map((row) => row.id),
            truncated,
        };
    }
    async findExpiredTerminalJobIds(limit) {
        const result = await this.client.query(`
      SELECT id
      FROM generation_jobs
      WHERE expires_at IS NOT NULL
        AND expires_at < NOW()
        AND status IN ('completed', 'failed', 'cancelled')
      ORDER BY expires_at ASC, created_at ASC
      LIMIT $1
      `, [limit]);
        return result.rows.map((row) => row.id);
    }
    async findActiveResourceJob(userId, jobType, resourceParamKey, resourceId, organizationId) {
        const result = await this.client.query(`
      SELECT *
      FROM generation_jobs
      WHERE job_type = $2
        AND status IN ('queued', 'processing')
        AND params->>$3 = $4
        AND (
          ($5::uuid IS NULL AND user_id = $1 AND organization_id IS NULL)
          OR (
            $5::uuid IS NOT NULL
            AND organization_id = $5::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = generation_jobs.organization_id
                AND organization_members.user_id = $1
                AND organization_members.status = 'active'
            )
          )
        )
      ORDER BY created_at DESC
      LIMIT 1
      `, [userId, jobType, resourceParamKey, resourceId, organizationId]);
        return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
    }
}
function buildGenerationJobScopeSql(tableName, capability, userIdParameter, organizationIdParameter) {
    const organizationRoles = generationJobOrganizationRoles(capability)
        .map((role) => `'${role}'`)
        .join(', ');
    return `(
    ($${organizationIdParameter}::uuid IS NULL
      AND ${tableName}.user_id = $${userIdParameter}
      AND ${tableName}.organization_id IS NULL)
    OR (
      $${organizationIdParameter}::uuid IS NOT NULL
      AND ${tableName}.organization_id = $${organizationIdParameter}::uuid
      AND EXISTS (
        SELECT 1
        FROM organization_members
        WHERE organization_members.organization_id = ${tableName}.organization_id
          AND organization_members.user_id = $${userIdParameter}
          AND organization_members.status = 'active'
          AND organization_members.role IN (${organizationRoles})
      )
    )
  )`;
}
function generationJobOrganizationRoles(capability) {
    return capability === 'generate'
        ? ['owner', 'admin', 'editor']
        : ['owner', 'admin', 'editor', 'viewer'];
}
function isTerminalGenerationJobStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}
function calculateCanceledJobRefund(row, requestedAmount) {
    const consumedEntryCount = Number(row?.consumed_entry_count ?? '0');
    if (consumedEntryCount === 0) {
        return null;
    }
    const consumedCompleteEntryCount = Number(row?.consumed_complete_entry_count ?? '0');
    const refundedEntryCount = Number(row?.refunded_entry_count ?? '0');
    const refundedCompleteEntryCount = Number(row?.refunded_complete_entry_count ?? '0');
    const allBucketDeltasPresent = consumedEntryCount === consumedCompleteEntryCount &&
        refundedEntryCount === refundedCompleteEntryCount;
    if (allBucketDeltasPresent) {
        const remainingMonthly = Math.max(0, -Number(row?.consumed_monthly_delta ?? '0') - Number(row?.refunded_monthly_delta ?? '0'));
        const remainingPurchased = Math.max(0, -Number(row?.consumed_purchased_delta ?? '0') - Number(row?.refunded_purchased_delta ?? '0'));
        const refundableAmount = remainingMonthly + remainingPurchased;
        if (refundableAmount <= 0) {
            return null;
        }
        const amount = Math.min(requestedAmount, refundableAmount);
        const monthlyDelta = Math.min(remainingMonthly, amount);
        return { amount, monthlyDelta, purchasedDelta: amount - monthlyDelta };
    }
    const refundableAmount = Math.max(0, Math.abs(Number(row?.consumed_amount ?? '0')) - Number(row?.refunded_amount ?? '0'));
    if (refundableAmount <= 0) {
        return null;
    }
    const amount = Math.min(requestedAmount, refundableAmount);
    return { amount, monthlyDelta: 0, purchasedDelta: amount };
}
function isTransactionRunner(client) {
    return typeof client.transaction === 'function';
}
function normalizeCapacityJobTypes(jobTypes) {
    const normalized = jobTypes?.filter((jobType, index, values) => values.indexOf(jobType) === index);
    return normalized === undefined || normalized.length === 0 ? DEFAULT_CAPACITY_JOB_TYPES : normalized;
}
function getGenerationCapacityScope(userId, organizationId) {
    return { userId, organizationId };
}
function formatGenerationCapacityScopeKey(scope) {
    return scope.organizationId === null
        ? `generation_jobs:user:${scope.userId}`
        : `generation_jobs:organization:${scope.organizationId}`;
}
export function isUniqueViolation(error) {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505');
}
function mapGenerationJobRow(row) {
    const creditSettlement = toGenerationJobCreditSettlement(row);
    return {
        id: row.id,
        userId: row.user_id,
        organizationId: row.organization_id,
        jobType: row.job_type,
        status: row.status,
        generationMode: toPageGenerationMode(row.generation_mode),
        creditCost: row.credit_cost,
        ...(creditSettlement === undefined ? {} : { creditSettlement }),
        params: toJsonObject(row.params),
        result: row.result === null ? null : toJsonObject(row.result),
        sqsMessageId: row.sqs_message_id,
        openaiRequestId: row.openai_request_id,
        errorMessage: row.error_message,
        cancelRequestedAt: row.cancel_requested_at,
        cancelRequestedBy: row.cancel_requested_by,
        cancelledAt: row.cancelled_at,
        commitStartedAt: row.commit_started_at,
        retryCount: row.retry_count,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        expiresAt: row.expires_at,
    };
}
function buildGenerationJobCreditSettlementLateralJoin(jobTable) {
    return `
      LEFT JOIN LATERAL (
        SELECT
          GREATEST(0, -COALESCE(SUM(credit_ledger.amount) FILTER (
            WHERE credit_ledger.type = 'consume'
          ), 0))::text AS charged_credits,
          GREATEST(0, COALESCE(SUM(credit_ledger.amount) FILTER (
            WHERE credit_ledger.type = 'refund'
          ), 0))::text AS refunded_credits
        FROM credit_ledger
        WHERE credit_ledger.job_id = ${jobTable}.id
          AND (
            (${jobTable}.organization_id IS NULL
              AND credit_ledger.organization_id IS NULL
              AND credit_ledger.user_id = ${jobTable}.user_id)
            OR (
              ${jobTable}.organization_id IS NOT NULL
              AND credit_ledger.organization_id = ${jobTable}.organization_id
            )
          )
      ) AS credit_settlement ON TRUE`;
}
function toGenerationJobCreditSettlement(row) {
    if (row.charged_credits === undefined || row.refunded_credits === undefined) {
        return undefined;
    }
    return createGenerationJobCreditSettlement(row.status, Number(row.charged_credits), Number(row.refunded_credits));
}
function toPageGenerationMode(value) {
    return value === 'standard' || value === 'thinking' ? value : null;
}
function toJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : {};
}
