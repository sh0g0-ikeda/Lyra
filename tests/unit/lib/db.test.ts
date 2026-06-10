import { describe, expect, it } from 'vitest';
import { buildDatabasePoolConfig } from '../../../src/lib/db.js';

describe('buildDatabasePoolConfig', () => {
  it('enables verified TLS when sslMode is require', () => {
    const config = buildDatabasePoolConfig({
      connectionString: 'postgres://lyra:secret@db.example.com:5432/lyra',
      max: 6,
      sslMode: 'require',
      statementTimeoutMs: 30_000,
      queryTimeoutMs: 30_000,
    });

    expect(config).toEqual({
      connectionString: 'postgres://lyra:secret@db.example.com:5432/lyra',
      max: 6,
      statement_timeout: 30_000,
      query_timeout: 30_000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it('omits TLS config when sslMode is disable', () => {
    const config = buildDatabasePoolConfig({
      connectionString: 'postgres://postgres:postgres@localhost:5432/lyra',
      max: 3,
      sslMode: 'disable',
      statementTimeoutMs: 0,
      queryTimeoutMs: 0,
    });

    expect(config).toEqual({
      connectionString: 'postgres://postgres:postgres@localhost:5432/lyra',
      max: 3,
      statement_timeout: 0,
      query_timeout: 0,
    });
  });
});
