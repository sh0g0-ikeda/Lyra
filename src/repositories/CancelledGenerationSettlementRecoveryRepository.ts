import { GENERATION_RECOVERY_BATCH_LIMIT } from '../domain/constants/generation.js';
import { ConfigurationError } from '../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { attestProduction44RuntimeSchema } from '../lib/production44RuntimeSchemaAttestation.js';
import { attestProduction44ExpandedRuntimeSchema } from '../lib/production44ExpandedRuntimeSchemaAttestation.js';
import { isProduction44RepositorySchemaProfile, type Production44RepositorySchemaProfile } from './RepositorySchemaProfile.js';
import { PostgresGenerationJobRepository } from './GenerationJobRepository.js';

const ELIGIBLE_JOB_SQL = `status = 'cancelled' AND credit_cost > 0
  AND job_type IN ('page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton')`;
// Scan and post-settlement verification must use the same billing scope.
const SCOPED_DEBIT_SQL = `COALESCE((
  SELECT SUM(-ledger.amount) > 0 FROM credit_ledger AS ledger
  WHERE ledger.job_id = candidates.id AND ledger.type IN ('consume', 'refund')
    AND ((candidates.organization_id IS NULL AND ledger.organization_id IS NULL AND ledger.user_id = candidates.user_id)
      OR (candidates.organization_id IS NOT NULL AND ledger.organization_id = candidates.organization_id))
), FALSE)`;

export interface CancelledSettlementCandidate {
  jobId: string;
  needsSettlement: boolean;
}

export interface CancelledGenerationSettlementRecoveryRepository {
  readonly profile: Production44RepositorySchemaProfile;
  scanBatch(input: { afterId: string | null; limit: number }): Promise<CancelledSettlementCandidate[]>;
  /** True only when finalization succeeded and the current cancelled job has no
   * remaining scoped debit. A terminal status alone does not prove a refund. */
  settleAndVerify(jobId: string): Promise<boolean>;
}

/** C0: a profile string alone never authorizes scanning. Keep construction behind
 * full read-only attestation; this factory does not enable a runtime entrypoint. */
export async function createCancelledGenerationSettlementRecoveryRepository(
  database: DatabaseClient & TransactionRunner,
  profile: unknown,
): Promise<CancelledGenerationSettlementRecoveryRepository> {
  if (!isProduction44RepositorySchemaProfile(profile)) {
    throw new ConfigurationError('Cancelled settlement recovery requires verified production44 persistence');
  }
  if (profile === 'production44_pg18_v1') await attestProduction44RuntimeSchema(database);
  else await attestProduction44ExpandedRuntimeSchema(database);
  return Object.freeze(new PostgresCancelledGenerationSettlementRecoveryRepository(database, profile));
}

class PostgresCancelledGenerationSettlementRecoveryRepository implements CancelledGenerationSettlementRecoveryRepository {
  readonly #cancellation: PostgresGenerationJobRepository;

  public constructor(private readonly client: DatabaseClient & TransactionRunner, public readonly profile: Production44RepositorySchemaProfile) {
    // Composition is fixed behind attestation; callers cannot supply a canonical
    // or legacy finalizer whose already-cancelled fast return skips settlement.
    this.#cancellation = new PostgresGenerationJobRepository(client, profile);
  }

  public async settleAndVerify(jobId: string): Promise<boolean> {
    if (!isJobId(jobId)) throw new ConfigurationError('Invalid cancelled settlement recovery job');
    if (!await this.#cancellation.finalizeCancellation(jobId)) return false;
    const result = await this.client.query<{ id: string; needs_settlement: boolean }>(`
      WITH candidates AS MATERIALIZED (
        SELECT id, user_id, organization_id FROM generation_jobs
        WHERE ${ELIGIBLE_JOB_SQL} AND id = $1::uuid
      )
      SELECT candidates.id, ${SCOPED_DEBIT_SQL} AS needs_settlement FROM candidates
    `, [jobId]);
    // Missing or no-longer-cancelled rows are not reported as settled. This is a
    // point-in-time observation; a later old debit is found on the next sweep.
    return result.rows.length === 1 && result.rows[0]?.needs_settlement === false;
  }

  public async scanBatch(input: { afterId: string | null; limit: number }): Promise<CancelledSettlementCandidate[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > GENERATION_RECOVERY_BATCH_LIMIT
      || (input.afterId !== null && !isJobId(input.afterId))) {
      throw new ConfigurationError('Invalid cancelled settlement recovery batch');
    }
    // Limit the candidate window before ledger aggregation. Settled/no-consume
    // rows remain in the window so the caller advances past them and poison rows.
    const result = await this.client.query<{ id: string; needs_settlement: boolean }>(`
      WITH candidates AS MATERIALIZED (
        SELECT id, user_id, organization_id
        FROM generation_jobs
        WHERE ${ELIGIBLE_JOB_SQL}
          AND ($1::uuid IS NULL OR id > $1::uuid)
        ORDER BY id ASC
        LIMIT $2::int
      )
      SELECT candidates.id, ${SCOPED_DEBIT_SQL} AS needs_settlement
      FROM candidates
      ORDER BY candidates.id ASC
    `, [input.afterId, input.limit]);
    return result.rows.map(row => ({ jobId: row.id, needsSettlement: row.needs_settlement }));
  }
}

function isJobId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}
