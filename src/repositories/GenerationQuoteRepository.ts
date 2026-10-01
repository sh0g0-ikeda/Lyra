import type { QueryResultRow } from 'pg';
import { ConflictError, NotFoundError } from '../domain/errors/index.js';
import type { GenerationQuote, GenerationQuotePlan, GenerationQuoteReceipt, GenerationQuoteRequest } from '../domain/types/generationQuote.js';
import type { GenerationJobType } from '../domain/types/job.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

interface QuoteRow extends QueryResultRow {
  id: string; user_id: string; organization_id: string | null;
  request: GenerationQuoteRequest; plan: GenerationQuotePlan; expires_at: Date;
  accepted_job_id: string | null; request_key: string | null; accepted_at: Date | null;
  job_status?: string | null; charged_credits?: number; refunded_credits?: number;
}
export interface QuoteDispatchLease { id: string; job_id: string; job_type: GenerationJobType; lease_token: string }

export class PostgresGenerationQuoteRepository {
  public constructor(private readonly database: DatabaseClient & TransactionRunner) {}
  public async lockActor(client: DatabaseClient, userId: string): Promise<void> {
    const result = await client.query<{ account_deletion_started_at: Date | null; account_deleted_at: Date | null }>(
      // Block deletion/state mutation, but permit legacy job INSERT's user FK
      // KEY SHARE while it holds the generation-capacity lock we acquire later.
      `SELECT account_deletion_started_at, account_deleted_at FROM users WHERE id=$1::uuid FOR NO KEY UPDATE`, [userId],
    );
    const user = result.rows[0];
    if (!user) throw new NotFoundError('Account not found');
    if (user.account_deletion_started_at !== null || user.account_deleted_at !== null) throw new ConflictError('Account deletion has started');
  }
  public async create(client: DatabaseClient, input: {
    id: string; tokenHash: string; userId: string; organizationId: string | null;
    request: GenerationQuoteRequest; plan: GenerationQuotePlan; expiresAt: Date;
  }): Promise<GenerationQuote> {
    const result = await client.query<QuoteRow>(
      `INSERT INTO generation_quotes (id,token_hash,user_id,organization_id,operation,target_id,request,plan,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) RETURNING *`,
      [input.id,input.tokenHash,input.userId,input.organizationId,input.plan.operation,input.plan.targetId,JSON.stringify(input.request),JSON.stringify(input.plan),input.expiresAt],
    );
    return mapQuote(result.rows[0]!);
  }
  public async find(client: DatabaseClient, userId: string, organizationId: string | null, quoteId: string,
    options: { lock?: boolean; tokenHash?: string } = {}): Promise<GenerationQuote> {
    const result = await client.query<QuoteRow>(
      `SELECT * FROM generation_quotes WHERE id=$1::uuid AND user_id=$2::uuid
       AND organization_id IS NOT DISTINCT FROM $3::uuid AND ($4::text IS NULL OR token_hash=$4)
       ${options.lock ? 'FOR UPDATE' : ''}`,
      [quoteId,userId,organizationId,options.tokenHash ?? null],
    );
    if (!result.rows[0]) throw new NotFoundError('Generation quote not found');
    return mapQuote(result.rows[0]);
  }
  public async assertUnusedRequestKey(client: DatabaseClient, quote: GenerationQuote, requestKey: string): Promise<void> {
    const existing = await client.query(
      `SELECT id FROM generation_quotes WHERE user_id=$1 AND organization_id IS NOT DISTINCT FROM $2::uuid
       AND request_key=$3::uuid AND id<>$4::uuid`, [quote.userId,quote.organizationId,requestKey,quote.id],
    );
    if (existing.rows.length > 0) throw new ConflictError('Request key was already used for another quote');
  }
  public async markAccepted(client: DatabaseClient, quoteId: string, jobId: string, requestKey: string): Promise<void> {
    const result=await client.query(
      `UPDATE generation_quotes SET accepted_job_id=$2::uuid, request_key=$3::uuid, accepted_at=NOW(), dispatch_state='pending'
       WHERE id=$1::uuid AND accepted_job_id IS NULL RETURNING id`, [quoteId,jobId,requestKey],
    );
    if(result.rows.length!==1) throw new ConflictError('Quote acceptance receipt could not be saved');
  }
  public async receipt(client: DatabaseClient, userId: string, organizationId: string | null, quoteId: string): Promise<GenerationQuoteReceipt> {
    const result = await client.query<QuoteRow>(
      `SELECT q.*, j.status AS job_status,
         CASE WHEN q.organization_id IS NULL THEN
           (SELECT COALESCE(-SUM(amount),0)::int FROM credit_ledger WHERE job_id=q.accepted_job_id AND user_id=q.user_id AND organization_id IS NULL AND type='consume')
         ELSE (SELECT COALESCE(-SUM(amount),0)::int FROM credit_ledger WHERE job_id=q.accepted_job_id AND organization_id=q.organization_id AND type='consume') END AS charged_credits,
         CASE WHEN q.organization_id IS NULL THEN
           (SELECT COALESCE(SUM(amount),0)::int FROM credit_ledger WHERE job_id=q.accepted_job_id AND user_id=q.user_id AND organization_id IS NULL AND type='refund')
         ELSE (SELECT COALESCE(SUM(amount),0)::int FROM credit_ledger WHERE job_id=q.accepted_job_id AND organization_id=q.organization_id AND type='refund') END AS refunded_credits
       FROM generation_quotes q LEFT JOIN generation_jobs j ON j.id=q.accepted_job_id
       WHERE q.id=$1::uuid AND q.user_id=$2::uuid AND q.organization_id IS NOT DISTINCT FROM $3::uuid`,
      [quoteId,userId,organizationId],
    );
    const row=result.rows[0];
    if (!row) throw new NotFoundError('Generation quote not found');
    return { quote:mapQuote(row), jobStatus:row.job_status ?? null, chargedCredits:row.charged_credits ?? 0, refundedCredits:row.refunded_credits ?? 0 };
  }
  public async findAcceptedJob(jobId: string): Promise<GenerationQuote> {
    const result=await this.database.query<QuoteRow>('SELECT * FROM generation_quotes WHERE accepted_job_id=$1::uuid',[jobId]);
    if (!result.rows[0]) throw new NotFoundError('Accepted generation quote not found');
    return mapQuote(result.rows[0]);
  }
  public async pruneUnaccepted(limit=100):Promise<number>{
    const result=await this.database.query(
      `WITH expired AS (SELECT id FROM generation_quotes WHERE accepted_job_id IS NULL AND expires_at<NOW()-INTERVAL '1 day'
        ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       DELETE FROM generation_quotes q USING expired WHERE q.id=expired.id RETURNING q.id`,
      [Math.max(1,Math.min(1000,limit))],
    );
    return result.rows.length;
  }
  public async claimDispatch(quoteId: string | null = null): Promise<QuoteDispatchLease | null> {
    const result=await this.database.query<QuoteDispatchLease & QueryResultRow>(
      `WITH candidate AS (
         SELECT q.id FROM generation_quotes q JOIN generation_jobs j ON j.id=q.accepted_job_id
         WHERE j.status='queued' AND j.cancel_requested_at IS NULL
           AND (q.dispatch_state='pending' OR (q.dispatch_state='dispatching' AND q.dispatch_lease_until<NOW()))
           AND q.dispatch_next_attempt_at<=NOW() AND ($1::uuid IS NULL OR q.id=$1::uuid)
         ORDER BY q.created_at LIMIT 1 FOR UPDATE OF q SKIP LOCKED
       ), claimed AS (
         UPDATE generation_quotes q SET dispatch_state='dispatching', dispatch_lease_token=gen_random_uuid(),
           dispatch_lease_until=NOW()+INTERVAL '60 seconds', dispatch_attempts=dispatch_attempts+1
         FROM candidate WHERE q.id=candidate.id RETURNING q.*
       ) SELECT claimed.id, claimed.accepted_job_id AS job_id, j.job_type, claimed.dispatch_lease_token AS lease_token
         FROM claimed JOIN generation_jobs j ON j.id=claimed.accepted_job_id`,[quoteId],
    );
    return result.rows[0] ?? null;
  }
  public async finishDispatch(lease: QuoteDispatchLease, success: boolean, messageId?: string | null): Promise<void> {
    await this.database.transaction(async (client) => {
      const result=await client.query(
        `UPDATE generation_quotes SET dispatch_state=$3, dispatch_lease_token=NULL, dispatch_lease_until=NULL,
         dispatch_next_attempt_at=CASE WHEN $3='pending' THEN NOW()+LEAST(300,power(2,LEAST(dispatch_attempts,8))) * INTERVAL '1 second' ELSE NOW() END
         WHERE id=$1::uuid AND dispatch_lease_token=$2::uuid RETURNING accepted_job_id`,
        [lease.id,lease.lease_token,success ? 'dispatched' : 'pending'],
      );
      if (result.rows.length && success && messageId) {
        await client.query('UPDATE generation_jobs SET sqs_message_id=$2 WHERE id=$1::uuid',[lease.job_id,messageId]);
      }
    });
  }
}
function mapQuote(row: QuoteRow): GenerationQuote {
  return { id:row.id,userId:row.user_id,organizationId:row.organization_id,request:row.request,plan:row.plan,
    expiresAt:row.expires_at,acceptedJobId:row.accepted_job_id,requestKey:row.request_key,acceptedAt:row.accepted_at };
}
