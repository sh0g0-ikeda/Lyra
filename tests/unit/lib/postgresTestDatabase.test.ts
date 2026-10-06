import { describe, expect, it } from 'vitest';
import { resolveSyntheticPostgresAdminTarget } from '../../integration/postgresTestDatabase.js';

const syntheticName = 'lyra_releasecompat_123_' + 'a'.repeat(32);

describe('synthetic PostgreSQL database safety guard', () => {
  it('Actionsのloopback 5432は明示opt-inが揃う場合だけ許可する', () => {
    const base = {
      appEnv: 'test',
      databaseUrl: 'postgres://postgres:secret@127.0.0.1:5432/lyra_test',
      databaseName: syntheticName,
    } as const;

    expect(() => resolveSyntheticPostgresAdminTarget({
      ...base,
      ci: 'true',
      githubActions: 'true',
      ciAdminAllowed: undefined,
    })).toThrow('CI synthetic database administration is not explicitly allowed');

    expect(resolveSyntheticPostgresAdminTarget({
      ...base,
      ci: 'true',
      githubActions: 'true',
      ciAdminAllowed: 'true',
    })).toMatchObject({
      adminUrl: expect.stringContaining('@127.0.0.1:5432/postgres'),
      databaseUrl: expect.stringContaining(`@127.0.0.1:5432/${syntheticName}`),
    });
  });

  it.each([
    ['APP_ENV', { appEnv: 'production', databaseUrl: 'postgres://postgres:secret@127.0.0.1:15432/lyra_test', databaseName: syntheticName }],
    ['loopback', { appEnv: 'test', databaseUrl: 'postgres://postgres:secret@db.example.com:15432/lyra_test', databaseName: syntheticName }],
    ['base database', { appEnv: 'test', databaseUrl: 'postgres://postgres:secret@127.0.0.1:15432/production', databaseName: syntheticName }],
    ['synthetic database name', { appEnv: 'test', databaseUrl: 'postgres://postgres:secret@127.0.0.1:15432/lyra_test', databaseName: 'lyra_releasecompat' }],
    ['approved local PostgreSQL port', { appEnv: 'test', databaseUrl: 'postgres://postgres:secret@127.0.0.1:5432/lyra_test', databaseName: syntheticName }],
  ])('%s条件を満たさないtargetを拒否する', (_label, input) => {
    expect(() => resolveSyntheticPostgresAdminTarget(input)).toThrow();
  });

  it.each([
    ['non-PostgreSQL scheme', 'mysql://postgres:secret@127.0.0.1:15435/lyra_test'],
    ['host override', 'postgres://postgres:secret@127.0.0.1:15435/lyra_test?host=db.example.com'],
    ['port override', 'postgres://postgres:secret@127.0.0.1:15435/lyra_test?port=5432'],
    ['database override', 'postgres://postgres:secret@127.0.0.1:15435/lyra_test?database=production'],
    ['URL fragment', 'postgres://postgres:secret@127.0.0.1:15435/lyra_test#remote'],
  ])('%sを含む接続文字列はURI本体の安全検査を迂回できるため拒否する', (_label, databaseUrl) => {
    expect(() => resolveSyntheticPostgresAdminTarget({
      appEnv: 'test',
      databaseUrl,
      databaseName: syntheticName,
    })).toThrow();
  });

  it.each(['15433', '15435'])('local専用port %sではCI opt-inなしでsynthetic databaseだけを許可する', (port) => {
    const target = resolveSyntheticPostgresAdminTarget({
      appEnv: 'test',
      databaseUrl: `postgres://postgres:secret@localhost:${port}/lyra_test`,
      databaseName: syntheticName,
    });

    expect(target.adminUrl).toContain(`@localhost:${port}/postgres`);
    expect(target.databaseUrl).toContain(`@localhost:${port}/${syntheticName}`);
  });
});
