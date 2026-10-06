import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readFile as defaultReadFile } from 'node:fs/promises';
import { parseStageDatabaseDrainProofRow } from './stage-database-drain-proof.mjs';

const QUERY = 'SELECT * FROM lyra_stage_ops.collect_database_drain_counts()';
const TIMEOUT = 4000;
const IDENTITY = Object.freeze({ stageId: 'lyra-staging-20261003', clusterId: 'lyra-staging-20261003-cluster', databaseId: 'lyra-staging-20261003-db' });

function fail(code) { throw new Error(code); }
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function validateInput(event) { if (!isRecord(event)) fail('DATABASE_DRAIN_EXECUTOR_INPUT_INVALID'); const keys=Object.keys(event); if(keys.length===0)return 1; if(keys.length===1&&keys[0]==='schemaVersion'&&event.schemaVersion===2)return 2; fail('DATABASE_DRAIN_EXECUTOR_INPUT_INVALID'); }
export function validateEnvironment(env) {
  if (!isRecord(env) || env.STAGE_ID !== IDENTITY.stageId || env.AWS_REGION !== 'ap-northeast-1' || env.AWS_ACCOUNT_ID !== '452284481392' || env.DB_NAME !== 'lyrastaging' || env.DB_USER !== 'lyra_stage_drain_reader') fail('DATABASE_DRAIN_EXECUTOR_ENV_INVALID');
  if (typeof env.DB_HOST !== 'string' || !new RegExp(`^${IDENTITY.databaseId}\\.[a-z0-9-]+\\.ap-northeast-1\\.rds\\.amazonaws\\.com$`, 'u').test(env.DB_HOST)) fail('DATABASE_DRAIN_EXECUTOR_ENV_INVALID');
  if (typeof env.DB_PASSWORD !== 'string' || !/^[0-9a-f]{64}$/u.test(env.DB_PASSWORD)) fail('DATABASE_DRAIN_EXECUTOR_ENV_INVALID');
  if (env.RDS_CA_FILE !== '/var/task/rds-ca-rsa2048-g1.pem' || typeof env.RDS_CA_SHA256 !== 'string' || !/^[0-9a-f]{64}$/u.test(env.RDS_CA_SHA256)) fail('DATABASE_DRAIN_EXECUTOR_ENV_INVALID');
  return { host: env.DB_HOST, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, connectionTimeoutMillis: TIMEOUT, query_timeout: TIMEOUT };
}
export async function executeDatabaseDrain({ event, env, createClient, readCaFile = defaultReadFile }) {
  const schemaVersion=validateInput(event); const options = validateEnvironment(env); if (typeof createClient !== 'function' || typeof readCaFile !== 'function') fail('DATABASE_DRAIN_EXECUTOR_CLIENT_INVALID');
  const ca = await readCaFile('/var/task/rds-ca-rsa2048-g1.pem', 'utf8'); if (createHash('sha256').update(ca).digest('hex') !== env.RDS_CA_SHA256) fail('DATABASE_DRAIN_EXECUTOR_CA_INVALID'); options.ssl = { ca, rejectUnauthorized: true };
  const client = createClient(options); let began = false; let proof; let primary;
  try { await client.connect(); await client.query('BEGIN READ ONLY'); began = true; await client.query(`SET LOCAL statement_timeout = '${TIMEOUT}ms'`); const result = await client.query(QUERY); if (!isRecord(result) || !Array.isArray(result.rows) || result.rows.length !== 1) fail('DATABASE_DRAIN_EXECUTOR_RESULT_INVALID'); proof = parseStageDatabaseDrainProofRow(result.rows[0], IDENTITY, schemaVersion); } catch (error) { primary = error; }
  let cleanupFailed = false; try { if (began) await client.query('ROLLBACK'); } catch { cleanupFailed = true; } try { await client.end(); } catch { cleanupFailed = true; }
  if (primary || cleanupFailed) fail('DATABASE_DRAIN_EXECUTOR_FAILED'); return proof;
}
export function createHandler({ env = process.env, createClient, readCaFile = defaultReadFile }) { return async (event) => { try { return { ok: true, proof: await executeDatabaseDrain({ event, env, createClient, readCaFile }) }; } catch { return { ok: false, error: 'DATABASE_DRAIN_EXECUTOR_FAILED' }; } }; }
export { QUERY as DATABASE_DRAIN_EXECUTOR_QUERY, TIMEOUT as DATABASE_DRAIN_EXECUTOR_TIMEOUT_MS };
export const handler = createHandler({ createClient: (options) => new Client(options) });
