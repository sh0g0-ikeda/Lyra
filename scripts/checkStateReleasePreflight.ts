import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseClient } from '../src/lib/db.js';
import {
  DEPLOYMENT_DATA_INVARIANT_QUERIES,
  type DeploymentDataInvariantQuery,
  type DeploymentDataInvariantReport,
  type DeploymentDataInvariantViolation,
} from './checkDeploymentDataInvariants.js';

// Release-only, read-only preflight for the additive 039 -> 041 rollout.
// Do not reuse the older 026 -> 039 preflight, mutate data, or treat a pass as
// approval to deploy. Drain external queues and verify runtime digests separately.
export async function checkStateReleasePreflight(
  database: DatabaseClient,
  schemaVersion: 39 | 41,
): Promise<DeploymentDataInvariantReport> {
  const filenames = (await readdir(join(process.cwd(), 'migrations')))
    .filter((filename) => /^\d{3}_.+\.sql$/u.test(filename))
    .sort()
    .filter((filename) => Number(filename.slice(0, 3)) <= schemaVersion);
  if (filenames.length !== schemaVersion || filenames.some((name, index) => Number(name.slice(0, 3)) !== index + 1)) {
    throw new Error('Expected contiguous release migration files are unavailable');
  }
  const history = await database.query<{ id: string }>(
    `WITH expected(filename) AS (SELECT unnest($1::text[])), differences AS (
       SELECT COALESCE(expected.filename, applied.filename) AS id
       FROM expected FULL OUTER JOIN schema_migrations AS applied USING (filename)
       WHERE expected.filename IS NULL OR applied.filename IS NULL
     ) SELECT id FROM differences ORDER BY id LIMIT 10`,
    [filenames],
  );
  const violations: DeploymentDataInvariantViolation[] = [];
  if (history.rows.length > 0) {
    // Do not run column-dependent queries against an unknown/partial schema.
    return { ok: false, checkedCount: 1, violations: [{
      name: `schema_migrations.expected_${schemaVersion}`, sampleIds: history.rows.map((row) => row.id),
    }] };
  }
  const queries: DeploymentDataInvariantQuery[] = [
    { name: 'release.active_jobs', sql: `SELECT id::text AS id FROM generation_jobs
      WHERE /* release.active_jobs */ status IN ('queued', 'processing') ORDER BY id LIMIT $1` },
    { name: 'release.active_exports', sql: `SELECT id::text AS id FROM episode_export_jobs
      WHERE status IN ('queued', 'processing') ORDER BY id LIMIT $1` },
    { name: 'release.active_deletions', sql: `SELECT user_id::text AS id FROM account_deletion_requests
      WHERE status IN ('processing', 'pending_external_action') ORDER BY id LIMIT $1` },
    ...DEPLOYMENT_DATA_INVARIANT_QUERIES,
  ];
  if (schemaVersion === 39) {
    queries.unshift({ name: 'schema_migrations.partial_state_columns', sql: `SELECT table_name || '.' || column_name AS id
      FROM information_schema.columns WHERE table_schema = CURRENT_SCHEMA()
      AND ((table_name = 'entity_states' AND column_name IN ('name', 'description', 'reference_image', 'updated_at'))
        OR (table_name = 'episodes' AND column_name = 'starting_entity_states')) ORDER BY id LIMIT $1` });
  } else {
    queries.push(
      { name: 'entity_states.variant_shape', sql: `SELECT id::text AS id FROM entity_states
        WHERE /* entity_states.variant_shape */ NOT ((name IS NULL AND description IS NULL)
          OR (name IS NOT NULL AND description IS NOT NULL AND char_length(btrim(name)) BETWEEN 1 AND 100
            AND char_length(btrim(description)) BETWEEN 1 AND 2000))
          OR (reference_image IS NOT NULL AND jsonb_typeof(reference_image) <> 'object') ORDER BY id LIMIT $1` },
      { name: 'episodes.starting_entity_states_shape', sql: `SELECT id::text AS id FROM episodes
        WHERE starting_entity_states IS NOT NULL AND NOT (
          CASE WHEN jsonb_typeof(starting_entity_states) = 'array'
            THEN jsonb_array_length(starting_entity_states) <= 100 ELSE FALSE END
        ) ORDER BY id LIMIT $1` },
    );
  }
  for (const query of queries) {
    const result = await database.query<{ id: unknown }>(query.sql, [10]);
    if (result.rows.length > 0) {
      violations.push({ name: query.name, sampleIds: result.rows.map((row) => String(row.id)) });
    }
  }
  return { ok: violations.length === 0, checkedCount: queries.length + 1, violations };
}

async function main(): Promise<void> {
  const version = process.argv[2];
  if (version !== '39' && version !== '41') {
    throw new Error('Usage: checkStateReleasePreflight.ts 39|41');
  }
  const { loadRuntimeSecretEnv } = await import('../src/lib/runtimeSecretEnv.js');
  await loadRuntimeSecretEnv();
  const { db, closeDatabasePool } = await import('../src/lib/db.js');
  try {
    const report = await db.transaction(async (client) => {
      await client.query('SET TRANSACTION READ ONLY');
      await client.query("SET LOCAL lock_timeout = '1s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      return checkStateReleasePreflight(client, version === '39' ? 39 : 41);
    });
    // Public operational output contains categories/counts only. Never print
    // row identifiers, connection strings, raw SQL errors, content, or secrets.
    console.log(JSON.stringify({
      ok: report.ok,
      checkedCount: report.checkedCount,
      violations: report.violations.map(({ name, sampleIds }) => ({ name, sampledCount: sampleIds.length })),
    }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('State release preflight failed; no database details are emitted.');
    process.exitCode = 1;
  });
}
