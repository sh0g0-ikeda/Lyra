import { describe, expect, it } from 'vitest';
import { buildDatabasePoolConfig } from '../../../src/lib/db.js';

describe('buildDatabasePoolConfig', () => {
  it('enables verified TLS when sslMode is require', () => {
    const config = buildDatabasePoolConfig({
      connectionString: 'postgres://lyra:secret@db.example.com:5432/lyra',
      max: 6,
      sslMode: 'require',
    });

    expect(config).toEqual({
      connectionString: 'postgres://lyra:secret@db.example.com:5432/lyra',
      max: 6,
      ssl: { rejectUnauthorized: true },
    });
  });

  it('omits TLS config when sslMode is disable', () => {
    const config = buildDatabasePoolConfig({
      connectionString: 'postgres://postgres:postgres@localhost:5432/lyra',
      max: 3,
      sslMode: 'disable',
    });

    expect(config).toEqual({
      connectionString: 'postgres://postgres:postgres@localhost:5432/lyra',
      max: 3,
    });
  });
});
