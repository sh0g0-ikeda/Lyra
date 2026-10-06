import { pathToFileURL } from 'node:url';
import type { DatabaseClient, TransactionRunner } from '../src/lib/db.js';
import { PostgresGoogleIdentityLinkRepository } from '../src/repositories/GoogleIdentityLinkRepository.js';
export function parseGoogleLinkExpiryArgs(argv: readonly string[]): {
    apply: boolean;
    limit: number;
} {
    let apply = false, limit = 100;
    const seen = new Set<string>();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (seen.has(arg))
            throw new Error('Duplicate option');
        seen.add(arg);
        if (arg === '--apply')
            apply = true;
        else if (arg === '--dry-run')
            apply = false;
        else if (arg === '--limit') {
            const value = argv[++i];
            if (!value || !/^\d+$/u.test(value))
                throw new Error('Invalid cleanup limit');
            limit = Number(value);
        }
        else
            throw new Error('Unknown option');
    }
    if (seen.has('--apply') && seen.has('--dry-run'))
        throw new Error('Choose apply or dry-run');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error('Invalid cleanup limit');
    return { apply, limit };
}
export async function expireGoogleIdentityLinkChallenges(database: DatabaseClient & TransactionRunner, options: {
    apply: boolean;
    limit: number;
}): Promise<{
    dry_run: boolean;
    expired_exchange_material: number;
}> {
    if (options.apply)
        return { dry_run: false, expired_exchange_material: await new PostgresGoogleIdentityLinkRepository(database).expirePending(options.limit) };
    const result = await database.query<{
        n: number;
    }>(`SELECT count(*)::int n FROM (
  SELECT id FROM oauth_link_challenges WHERE expires_at<NOW() AND provider_subject_hash IS NULL AND exchange_material IS NOT NULL
  AND status IN ('pending','processing') ORDER BY expires_at LIMIT $1) eligible`, [options.limit]);
    return { dry_run: true, expired_exchange_material: result.rows[0]?.n ?? 0 };
}
async function main(): Promise<void> {
    const options = parseGoogleLinkExpiryArgs(process.argv.slice(2));
    const { db, closeDatabasePool } = await import('../src/lib/db.js');
    try {
        console.log(JSON.stringify(await expireGoogleIdentityLinkChallenges(db, options)));
    }
    finally {
        await closeDatabasePool();
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    void main().catch(() => { console.error('Google identity challenge cleanup failed; no private details were printed'); process.exitCode = 1; });
}
