import { createHash } from 'node:crypto';
import { ConfigurationError } from '../domain/errors/index.js';
import type { TransactionRunner } from './db.js';
import { readRuntimeSchemaCatalog, type RuntimeSchemaCatalog } from './runtimeSchemaAttestation.js';
import { PRODUCTION44_CATALOG_SIGNATURES } from './production44RuntimeSchemaDescriptor.js';

export interface Production44RuntimeSchemaDescription {
  kind: 'production44_pg18_v1' | 'unsupported';
  failures: string[];
}

/** Read-only candidate attestation. The canonical-only startup gate stays closed. */
export function describeProduction44RuntimeSchema(catalog: RuntimeSchemaCatalog): Production44RuntimeSchemaDescription {
  const failures: string[] = [];
  for (const part of Object.keys(PRODUCTION44_CATALOG_SIGNATURES) as Array<keyof typeof PRODUCTION44_CATALOG_SIGNATURES>) {
    const rows = catalog[part];
    const signature = Array.isArray(rows)
      ? createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(normalize(row))).sort())).digest('hex')
      : null;
    if (signature !== PRODUCTION44_CATALOG_SIGNATURES[part]) failures.push('PRODUCTION44_' + part.toUpperCase() + '_MISMATCH');
  }
  return failures.length === 0 ? { kind: 'production44_pg18_v1', failures: [] } : { kind: 'unsupported', failures };
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, normalize(record[key])]));
  }
  return value;
}

export async function attestProduction44RuntimeSchema(database: TransactionRunner): Promise<'production44_pg18_v1'> {
  let catalog: RuntimeSchemaCatalog;
  try {
    catalog = await readRuntimeSchemaCatalog(database, { includeFunctionBodies: true, includeLegacyAttributes: true });
  } catch {
    throw new ConfigurationError('Runtime production44 schema attestation failed: SCHEMA_QUERY_FAILED');
  }
  const description = describeProduction44RuntimeSchema(catalog);
  if (description.kind !== 'production44_pg18_v1') throw new ConfigurationError('Runtime production44 schema attestation failed: SCHEMA_UNSUPPORTED');
  return description.kind;
}
