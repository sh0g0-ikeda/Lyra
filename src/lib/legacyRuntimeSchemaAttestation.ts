import { ConfigurationError } from '../domain/errors/index.js';
import type { TransactionRunner } from './db.js';
import { readRuntimeSchemaCatalog, type RuntimeSchemaCatalog } from './runtimeSchemaAttestation.js';
import { LEGACY_RUNTIME_SCHEMA_REFERENCE } from './legacyRuntimeSchemaDescriptor.js';

export interface LegacyRuntimeSchemaDescription {
  kind: 'legacy_2debe_v1' | 'unsupported';
  failures: string[];
}

/** Candidate preflight only. It does not enable legacy runtime or mutate a database. */
export function describeLegacyRuntimeSchema(catalog: RuntimeSchemaCatalog): LegacyRuntimeSchemaDescription {
  const parts = [
    'migrationFilenames', 'relations', 'namespaceArtifacts', 'columns',
    'constraints', 'indexes', 'triggers', 'functions',
  ] as const;
  const failures: string[] = [];
  for (const part of parts) {
    const actual = catalog[part];
    const expected = LEGACY_RUNTIME_SCHEMA_REFERENCE[part];
    if (!Array.isArray(actual) || !Array.isArray(expected) ||
        normalizedRows(actual) !== normalizedRows(expected)) {
      failures.push('LEGACY_' + part.toUpperCase() + '_MISMATCH');
    }
  }
  return failures.length === 0
    ? { kind: 'legacy_2debe_v1', failures: [] }
    : { kind: 'unsupported', failures };
}

function normalizedRows(values: readonly unknown[]): string {
  return JSON.stringify(values.map(value => JSON.stringify(normalizeValue(value))).sort());
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => normalizeValue(item));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, normalizeValue(record[key])]));
  }
  return value;
}

export async function attestLegacyRuntimeSchema(database: TransactionRunner): Promise<'legacy_2debe_v1'> {
  let catalog: RuntimeSchemaCatalog;
  try {
    catalog = await readRuntimeSchemaCatalog(database, {
      includeFunctionBodies: true,
      includeLegacyAttributes: true,
    });
  } catch {
    throw new ConfigurationError('Runtime legacy schema attestation failed: SCHEMA_QUERY_FAILED');
  }
  const description = describeLegacyRuntimeSchema(catalog);
  if (description.kind !== 'legacy_2debe_v1') {
    throw new ConfigurationError('Runtime legacy schema attestation failed: SCHEMA_UNSUPPORTED');
  }
  return description.kind;
}
