import type { QueryResultRow } from 'pg';
import { ConflictError, NotFoundError } from '../domain/errors/index.js';
import type { GoogleLinkChallenge } from '../domain/types/googleIdentityLink.js';
import type { GoogleLinkStatus } from '../domain/auth/GoogleLinkProtocol.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
export interface GoogleIdentityLinkRepository {
    findRequest(userId: string, requestKey: string): Promise<GoogleLinkChallenge | null>;
    create(input: GoogleLinkChallenge): Promise<GoogleLinkChallenge>;
    findForUser(id: string, userId: string): Promise<GoogleLinkChallenge | null>;
    claimState(stateHash: string): Promise<GoogleLinkChallenge | null>;
    reserveIdentity(id: string, subjectHash: string): Promise<void>;
    performLink(id: string, subjectHash: string, operation: () => Promise<void>): Promise<void>;
    finish(id: string, status: GoogleLinkStatus, messageCode?: string): Promise<void>;
    completeReconciliation(id: string, subjectHash: string): Promise<void>;
    expirePending(limit: number): Promise<number>;
}
interface LinkRow extends QueryResultRow {
    id: string;
    user_id: string;
    request_key: string;
    session_hash: string;
    state_hash: string;
    email_hash: string;
    native_subject: string;
    native_username: string;
    exchange_material: string | null;
    platform: 'mobile' | 'web';
    status: GoogleLinkStatus;
    provider_subject_hash: string | null;
    message_code: string | null;
    created_at: Date;
    expires_at: Date;
    consumed_at: Date | null;
}
export class PostgresGoogleIdentityLinkRepository implements GoogleIdentityLinkRepository {
    public constructor(private readonly database: DatabaseClient & TransactionRunner) { }
    public async findRequest(userId: string, requestKey: string): Promise<GoogleLinkChallenge | null> {
        const result = await this.database.query<LinkRow>('SELECT * FROM oauth_link_challenges WHERE user_id=$1::uuid AND request_key=$2::uuid', [userId, requestKey]);
        return result.rows[0] === undefined ? null : mapRow(result.rows[0]);
    }
    public async create(input: GoogleLinkChallenge): Promise<GoogleLinkChallenge> {
        return this.database.transaction(async (client) => {
            await lockActiveUser(client, input.userId, input.nativeSubject);
            const result = await client.query<LinkRow>(`INSERT INTO oauth_link_challenges
        (id,user_id,provider,request_key,session_hash,state_hash,email_hash,native_subject,native_username,exchange_material,platform,created_at,expires_at)
        VALUES ($1,$2,'Google',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (user_id,request_key) DO NOTHING RETURNING *`, [input.id, input.userId, input.requestKey, input.sessionHash, input.stateHash, input.emailHash, input.nativeSubject, input.nativeUsername, input.exchangeMaterial, input.platform, input.createdAt, input.expiresAt]);
            if (result.rows[0] !== undefined)
                return mapRow(result.rows[0]);
            const existing = await client.query<LinkRow>('SELECT * FROM oauth_link_challenges WHERE user_id=$1 AND request_key=$2', [input.userId, input.requestKey]);
            if (existing.rows[0] === undefined)
                throw new ConflictError('Identity link request changed');
            return mapRow(existing.rows[0]);
        });
    }
    public async findForUser(id: string, userId: string): Promise<GoogleLinkChallenge | null> {
        const result = await this.database.query<LinkRow>('SELECT * FROM oauth_link_challenges WHERE id=$1::uuid AND user_id=$2::uuid', [id, userId]);
        return result.rows[0] === undefined ? null : mapRow(result.rows[0]);
    }
    public async claimState(stateHash: string): Promise<GoogleLinkChallenge | null> {
        const lookup = await this.database.query<LinkRow>('SELECT * FROM oauth_link_challenges WHERE state_hash=$1', [stateHash]);
        const found = lookup.rows[0];
        if (found === undefined)
            return null;
        return this.database.transaction(async (client) => {
            await lockActiveUser(client, found.user_id, found.native_subject);
            const claimed = await client.query<LinkRow>(`UPDATE oauth_link_challenges SET status='processing',consumed_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND status='pending' AND expires_at>NOW() RETURNING *`, [found.id]);
            return claimed.rows[0] === undefined ? null : mapRow(claimed.rows[0]);
        });
    }
    public async reserveIdentity(id: string, subjectHash: string): Promise<void> {
        await this.withChallenge(id, async (client, row) => {
            if (row.status !== 'processing' || row.expires_at.getTime() <= Date.now())
                throw new ConflictError('Identity link request expired');
            await client.query(`INSERT INTO oauth_identity_links(provider,provider_subject_hash,user_id,challenge_id,status)
        VALUES ('Google',$1,$2,$3,'pending') ON CONFLICT DO NOTHING`, [subjectHash, row.user_id, id]);
            const links = await client.query<{
                user_id: string;
                provider_subject_hash: string;
                challenge_id: string | null;
                status: string;
            }>(`SELECT user_id,provider_subject_hash,challenge_id,status FROM oauth_identity_links
         WHERE provider='Google' AND (provider_subject_hash=$1 OR user_id=$2) FOR UPDATE`, [subjectHash, row.user_id]);
            if (links.rows.length !== 1 || links.rows[0]?.user_id !== row.user_id || links.rows[0]?.provider_subject_hash !== subjectHash
                || (links.rows[0]?.challenge_id !== id && links.rows[0]?.status !== 'linked'))
                throw new ConflictError('Identity is already linked or requires recovery');
            await client.query(`UPDATE oauth_link_challenges SET provider_subject_hash=$2,exchange_material=NULL,updated_at=NOW() WHERE id=$1`, [id, subjectHash]);
        });
    }
    public async performLink(id: string, subjectHash: string, operation: () => Promise<void>): Promise<void> {
        await this.withChallenge(id, async (client, row) => {
            if (row.provider_subject_hash !== subjectHash || row.status !== 'processing')
                throw new ConflictError('Identity link request changed');
            const result = await client.query<{
                status: string;
            }>(`SELECT status FROM oauth_identity_links WHERE provider='Google' AND provider_subject_hash=$1 AND user_id=$2 FOR UPDATE`, [subjectHash, row.user_id]);
            if (result.rows[0] === undefined)
                throw new ConflictError('Identity link reservation is unavailable');
            // Intent was committed before this phase. Never replay an ambiguous AWS
            // mutation; the authenticated status path performs read-only reconciliation.
            if (result.rows[0].status !== 'linked')
                await operation();
            await markLinked(client, row.id, row.user_id, subjectHash);
        });
    }
    public async completeReconciliation(id: string, subjectHash: string): Promise<void> {
        await this.withChallenge(id, async (client, row) => {
            if (row.provider_subject_hash !== subjectHash || !['processing', 'recovery_required', 'linked'].includes(row.status))
                throw new ConflictError('Identity link request changed');
            await markLinked(client, row.id, row.user_id, subjectHash);
        });
    }
    public async finish(id: string, status: GoogleLinkStatus, messageCode?: string): Promise<void> {
        await this.withChallenge(id, async (client, row) => {
            if (row.status === 'linked')
                return;
            const nextStatus = row.provider_subject_hash !== null ? 'recovery_required' : status;
            const nextMessage = row.provider_subject_hash !== null ? 'RECOVERY_REQUIRED' : messageCode ?? null;
            await client.query(`UPDATE oauth_link_challenges SET status=$2,consumed_at=COALESCE(consumed_at,NOW()),exchange_material=NULL,message_code=$3,updated_at=NOW() WHERE id=$1`, [id, nextStatus, nextMessage]);
            if (row.provider_subject_hash !== null && status !== 'linked')
                await client.query(`UPDATE oauth_identity_links SET status='recovery_required',updated_at=NOW() WHERE challenge_id=$1 AND status<>'linked'`, [id]);
        });
    }
    public async expirePending(limit: number): Promise<number> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw new Error('Invalid cleanup batch');
        // Clear exchange material but retain the idempotency receipt. Deleting it
        // here could turn a timed-out same-key retry into a brand-new challenge.
        const expired = await this.database.query<{
            id: string;
        }>(`SELECT id FROM oauth_link_challenges
      WHERE expires_at<NOW() AND provider_subject_hash IS NULL AND exchange_material IS NOT NULL
      AND status IN ('pending','processing') ORDER BY expires_at LIMIT $1`, [limit]);
        let count = 0;
        for (const row of expired.rows) {
            try {
                const expiredOne = await this.withChallenge(row.id, async (client, locked) => {
                    if (locked.provider_subject_hash !== null || locked.exchange_material === null || !['pending', 'processing'].includes(locked.status) || locked.expires_at.getTime() > Date.now()) return false;
                    await client.query(`UPDATE oauth_link_challenges SET status='expired',consumed_at=COALESCE(consumed_at,NOW()),exchange_material=NULL,updated_at=NOW() WHERE id=$1`, [row.id]);
                    return true;
                });
                if (expiredOne) count++;
            }
            catch (error) {
                if (!(error instanceof NotFoundError))
                    throw error;
            }
        }
        return count;
    }
    private async withChallenge<T>(id: string, operation: (client: DatabaseClient, row: LinkRow) => Promise<T>): Promise<T> {
        const lookup = await this.database.query<LinkRow>('SELECT * FROM oauth_link_challenges WHERE id=$1::uuid', [id]);
        const found = lookup.rows[0];
        if (found === undefined)
            throw new NotFoundError('Identity link request not found');
        return this.database.transaction(async (client) => {
            await lockActiveUser(client, found.user_id, found.native_subject);
            const locked = await client.query<LinkRow>('SELECT * FROM oauth_link_challenges WHERE id=$1::uuid FOR UPDATE', [id]);
            if (locked.rows[0] === undefined)
                throw new NotFoundError('Identity link request not found');
            return operation(client, locked.rows[0]);
        });
    }
}
async function lockActiveUser(client: DatabaseClient, userId: string, subject: string): Promise<void> {
    const result = await client.query<{
        supabase_id: string;
        account_deletion_started_at: Date | null;
        account_deleted_at: Date | null;
    }>('SELECT supabase_id,account_deletion_started_at,account_deleted_at FROM users WHERE id=$1::uuid FOR UPDATE', [userId]);
    const user = result.rows[0];
    if (user === undefined || user.supabase_id !== subject || user.account_deletion_started_at !== null || user.account_deleted_at !== null)
        throw new ConflictError('Account is unavailable for identity linking');
}
async function markLinked(client: DatabaseClient, id: string, userId: string, hash: string): Promise<void> {
    await client.query(`UPDATE oauth_identity_links SET status='linked',updated_at=NOW() WHERE provider='Google' AND provider_subject_hash=$1 AND user_id=$2`, [hash, userId]);
    await client.query(`UPDATE oauth_link_challenges SET status='linked',exchange_material=NULL,message_code=NULL,updated_at=NOW() WHERE id=$1`, [id]);
}
function mapRow(row: LinkRow): GoogleLinkChallenge {
    return { id: row.id, userId: row.user_id, requestKey: row.request_key, sessionHash: row.session_hash, stateHash: row.state_hash, emailHash: row.email_hash, nativeSubject: row.native_subject, nativeUsername: row.native_username, exchangeMaterial: row.exchange_material, platform: row.platform, status: row.status, providerSubjectHash: row.provider_subject_hash, messageCode: row.message_code, createdAt: row.created_at, expiresAt: row.expires_at, consumedAt: row.consumed_at };
}
