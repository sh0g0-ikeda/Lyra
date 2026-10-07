import { createHash } from 'node:crypto';
import { ConfigurationError } from '../domain/errors/index.js';
import type { TransactionRunner } from './db.js';
import { readRuntimeSchemaCatalog, type RuntimeSchemaCatalog } from './runtimeSchemaAttestation.js';
import { PRODUCTION44_EXPANSION_CHECKPOINTS, PRODUCTION44_EXPANSION_MIGRATIONS } from './production44ExpandedRuntimeSchemaDescriptor.js';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, normalize(record[key])]));
  }
  return value;
}

/** Prefix 0 is exact actual44; the last checkpoint is fully expanded. Unknown/partial DDL is never resumable. */
export function describeProduction44ExpansionCheckpoint(catalog: RuntimeSchemaCatalog): number | null {
  const parts = Object.keys(PRODUCTION44_EXPANSION_CHECKPOINTS[0]) as Array<keyof typeof PRODUCTION44_EXPANSION_CHECKPOINTS[0]>;
  const signatures = Object.fromEntries(parts.map(part => {
    const rows = catalog[part];
    return [part, Array.isArray(rows) ? createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(normalize(row))).sort())).digest('hex') : null];
  }));
  const checkpoint = PRODUCTION44_EXPANSION_CHECKPOINTS.findIndex(expected => parts.every(part => signatures[part] === expected[part]));
  return checkpoint < 0 ? null : checkpoint;
}

/** This attests schema only. Startup activation and writer capability admission remain separate gates. */
export async function attestProduction44ExpandedRuntimeSchema(database: TransactionRunner): Promise<'production44_expanded_pg18_v1'> {
  let catalog: RuntimeSchemaCatalog;
  try {
    catalog = await readRuntimeSchemaCatalog(database, { includeFunctionBodies: true, includeLegacyAttributes: true });
  } catch {
    throw new ConfigurationError('Expanded schema attestation failed: SCHEMA_QUERY_FAILED');
  }
  if (describeProduction44ExpansionCheckpoint(catalog) !== PRODUCTION44_EXPANSION_MIGRATIONS.length) {
    throw new ConfigurationError('Expanded schema attestation failed: SCHEMA_UNSUPPORTED');
  }
  return 'production44_expanded_pg18_v1';
}
