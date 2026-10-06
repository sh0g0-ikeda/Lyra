import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import {
  CANONICAL_RUNTIME_MIGRATIONS,
  CANONICAL_RUNTIME_SCHEMA_SIGNATURES,
  attestCanonicalRuntimeSchema,
  describeRuntimeSchema,
  prepareCanonicalRuntimeSchema,
  readRuntimeSchemaCatalog,
  type RuntimeSchemaCatalog,
} from '../../../src/lib/runtimeSchemaAttestation.js';

/**
 * Design contract: this is a candidate-startup guard, not a complete database
 * proof. It may inspect catalog metadata and migration filenames only. Unknown,
 * legacy, or hybrid databases fail before recovery, queue handling, HTTP
 * admission, or automatic migration can start.
 */
describe('runtime schema attestation', () => {
  it('canonical fresh v1のdescriptorとactive jobに依存しないcatalogを受け入れる', () => {
    expect(describeRuntimeSchema(canonicalCatalog())).toEqual({
      kind: 'canonical_fresh_v1',
      failures: [],
    });
  });

  it('tableがなくても途中DDL artifactが残るschemaをempty freshとして扱わない', () => {
    const catalog = emptyCatalog();
    catalog.namespaceArtifacts = [{ kind: 'function', name: 'partial_runtime_guard()' }];
    expect(describeRuntimeSchema(catalog).kind).toBe('unsupported');
  });

  it('empty fresh許可名と同名でもtable以外のrelationは拒否する', () => {
    const catalog = emptyCatalog();
    catalog.relations.push({ name: 'schema_migration_locks', kind: 'S' });
    expect(describeRuntimeSchema(catalog).kind).toBe('unsupported');
  });

  it('canonical 001..046だけの既知fresh schemaを047 migration候補として識別する', () => {
    const catalog = canonicalCatalog();
    catalog.migrationFilenames = [...CANONICAL_RUNTIME_MIGRATIONS.slice(0, -1)];
    catalog.relations = catalog.relations.filter(({ name }) => name !== 'state_reference_copy_attempts');
    catalog.columns = catalog.columns.filter(({ relation }) => relation !== 'state_reference_copy_attempts');
    catalog.constraints = catalog.constraints.filter(({ relation }) => relation !== 'state_reference_copy_attempts');
    catalog.indexes = catalog.indexes.filter(({ relation }) => relation !== 'state_reference_copy_attempts');
    catalog.triggers = catalog.triggers.filter(({ relation }) => relation !== 'state_reference_copy_attempts');

    expect(describeRuntimeSchema(catalog)).toEqual({
      kind: 'canonical_046_pending_047',
      failures: [],
    });
  });

  it.each([
    ['旧export relation', (catalog: RuntimeSchemaCatalog) => catalog.relations.push({ name: 'export_jobs', kind: 'r' })],
    ['未知migration', (catalog: RuntimeSchemaCatalog) => catalog.migrationFilenames.push('999_unknown.sql')],
    ['046 bridge由来の物理metadata列', (catalog: RuntimeSchemaCatalog) => catalog.columns.push(column('pages', 'story_page_purpose', 'text'))],
    ['旧push trigger', (catalog: RuntimeSchemaCatalog) => catalog.triggers.push(trigger('generation_jobs', 'generation_jobs_enqueue_mobile_push_notification', 'legacy_push'))],
  ])('%sを含むlegacy/unknown/hybrid catalogを拒否する', (_label, mutate) => {
    const catalog = canonicalCatalog();
    mutate(catalog);
    expect(describeRuntimeSchema(catalog).kind).toBe('unsupported');
  });

  it.each([
    ['必須列', (catalog: RuntimeSchemaCatalog) => removeColumn(catalog, 'generation_jobs', 'cancel_requested_at')],
    ['push unique', (catalog: RuntimeSchemaCatalog) => removeConstraint(catalog, 'mobile_push_notification_outbox_event_unique')],
    ['settlement trigger', (catalog: RuntimeSchemaCatalog) => removeTrigger(catalog, 'generation_job_credit_consume_guard')],
  ])('履歴が正しくても%sが欠ければ拒否する', (_label, mutate) => {
    const catalog = canonicalCatalog();
    mutate(catalog);
    expect(describeRuntimeSchema(catalog).kind).toBe('unsupported');
  });

  it.each([
    ['constraint', (catalog: RuntimeSchemaCatalog) => { catalog.constraints[0]!.definitionSha256 = '0'.repeat(64); }],
    ['index', (catalog: RuntimeSchemaCatalog) => { catalog.indexes[0]!.definitionSha256 = '0'.repeat(64); }],
    ['trigger', (catalog: RuntimeSchemaCatalog) => { catalog.triggers[0]!.definitionSha256 = '0'.repeat(64); }],
  ])('同名%sでも定義署名が違うhybridを拒否する', (_label, mutate) => {
    const catalog = canonicalCatalog();
    mutate(catalog);
    expect(describeRuntimeSchema(catalog).kind).toBe('unsupported');
  });

  it('同一transactionをREAD ONLYにしてcatalogとfilenameだけを読む', async () => {
    const catalog = canonicalCatalog();
    const queries: string[] = [];
    const database: TransactionRunner = {
      transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => work({
        query: async <R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
          queries.push(sql);
          return queryCatalogFixture<R>(sql, catalog);
        },
      }),
    };

    await expect(readRuntimeSchemaCatalog(database)).resolves.toEqual(catalog);
    expect(queries[0]).toMatch(/SET TRANSACTION READ ONLY/u);
    expect(queries.join('\n')).not.toMatch(/generation_jobs\s+WHERE|COUNT\(|INSERT|UPDATE|DELETE|ALTER|CREATE/u);
    expect(queries.join('\n')).toContain("dependency.classid = 'pg_proc'::regclass");
    expect(queries.join('\n')).toContain("dependency.classid = 'pg_type'::regclass");
    expect(queries.join('\n')).not.toContain('pg_get_function_result');
    expect(queries.join('\n')).not.toContain('relation.relrowsecurity');
    expect(queries.join('\n')).not.toContain('column_default');
    expect(queries.join('\n')).not.toContain('procedure.provolatile');
  });

  it('関数本文を要求した場合はcurrent schemaの非extension function/procedureを意味的に取得する', async () => {
    const catalog = canonicalCatalog();
    const functions = [{
      name: 'legacy_refund',
      identityArguments: 'job_id uuid',
      returnType: 'trigger',
      language: 'plpgsql',
      securityDefiner: false,
      settings: ['search_path=public'],
      bodySha256: 'a'.repeat(64),
    }];
    const queries: string[] = [];
    const database = catalogDatabase([catalog], [], [functions], queries);

    await expect(readRuntimeSchemaCatalog(database, { includeFunctionBodies: true })).resolves.toEqual({
      ...catalog,
      functions,
    });

    const functionQuery = queries.find((query) => query.includes('pg_get_function_result'));
    expect(functionQuery).toContain("procedure.prokind IN ('f', 'p')");
    expect(functionQuery).toContain("dependency.classid = 'pg_proc'::regclass");
    expect(functionQuery).toContain("replace(procedure.prosrc, E'\\r\\n', E'\\n')");
  });

  it('legacy属性を要求した場合だけcolumn default・function execution・relation RLSを取得する', async () => {
    const catalog = canonicalCatalog();
    Object.assign(catalog.relations[0]!, { rowSecurity: false, forceRowSecurity: false });
    Object.assign(catalog.columns[0]!, {
      defaultExpressionSha256: 'b'.repeat(64),
      identityGeneration: null,
      generatedExpressionSha256: null,
    });
    const functions = [{
      name: 'legacy_refund', identityArguments: '', returnType: 'trigger', language: 'plpgsql',
      securityDefiner: false, settings: [], bodySha256: 'a'.repeat(64),
      kind: 'function', volatility: 'volatile', strict: false, parallel: 'unsafe', leakproof: false,
    }];
    const queries: string[] = [];
    const database = catalogDatabase([catalog], [], [functions], queries);

    const result = await readRuntimeSchemaCatalog(database, {
      includeFunctionBodies: true,
      includeLegacyAttributes: true,
    });

    expect(result).toEqual({ ...catalog, functions });
    expect(queries.join('\n')).toContain('relation.relrowsecurity');
    expect(queries.join('\n')).toContain('column_default');
    expect(queries.join('\n')).toContain('procedure.provolatile');
  });

  it('query failureを秘密値なしの安定したConfigurationErrorにする', async () => {
    const secret = 'postgres://user:private-password@example.invalid/secret';
    const database: TransactionRunner = {
      transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => work({
        query: async () => { throw new Error(secret); },
      }),
    };

    await expect(attestCanonicalRuntimeSchema(database)).rejects.toEqual(
      new ConfigurationError('Runtime schema attestation failed: SCHEMA_QUERY_FAILED'),
    );
    await expect(attestCanonicalRuntimeSchema(database)).rejects.not.toThrow(secret);
  });

  it('AUTO_RUN_MIGRATIONS=falseではrunnerを呼ばずcanonicalだけを許可する', async () => {
    const runMigrations = vi.fn();
    await expect(prepareCanonicalRuntimeSchema({
      database: catalogDatabase([canonicalCatalog()]),
      autoRunMigrations: false,
      runMigrations,
    })).resolves.toMatchObject({ descriptor: 'canonical_fresh_v1', appliedMigrations: [] });
    expect(runMigrations).not.toHaveBeenCalled();

    await expect(prepareCanonicalRuntimeSchema({
      database: catalogDatabase([oldCatalog()]),
      autoRunMigrations: false,
      runMigrations,
    })).rejects.toThrow('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it('empty freshだけはmutation前attestation後にmigrationを実行しfinal canonicalを再検証する', async () => {
    const order: string[] = [];
    const runMigrations = vi.fn(async () => { order.push('migrate'); return [...CANONICAL_RUNTIME_MIGRATIONS]; });
    const database = catalogDatabase([emptyCatalog(), canonicalCatalog()], order);

    await expect(prepareCanonicalRuntimeSchema({ database, autoRunMigrations: true, runMigrations })).resolves.toEqual({
      descriptor: 'canonical_fresh_v1',
      appliedMigrations: [...CANONICAL_RUNTIME_MIGRATIONS],
    });
    expect(order).toEqual(['attest', 'migrate', 'attest']);
  });

  it('既知canonical 046は047適用候補に限ってmigration後のfinal canonicalを要求する', async () => {
    const pending = canonicalCatalog();
    pending.migrationFilenames = [...CANONICAL_RUNTIME_MIGRATIONS.slice(0, -1)];
    pending.relations = pending.relations.filter(({ name }) => name !== 'state_reference_copy_attempts');
    pending.columns = pending.columns.filter(({ relation }) => relation !== 'state_reference_copy_attempts');
    pending.constraints = pending.constraints.filter(({ relation }) => relation !== 'state_reference_copy_attempts');
    pending.indexes = pending.indexes.filter(({ relation }) => relation !== 'state_reference_copy_attempts');
    pending.triggers = pending.triggers.filter(({ relation }) => relation !== 'state_reference_copy_attempts');
    const runMigrations = vi.fn(async () => ['047_add_state_reference_copy_attempts.sql']);

    await expect(prepareCanonicalRuntimeSchema({
      database: catalogDatabase([pending, canonicalCatalog()]),
      autoRunMigrations: true,
      runMigrations,
    })).resolves.toEqual({
      descriptor: 'canonical_fresh_v1',
      appliedMigrations: ['047_add_state_reference_copy_attempts.sql'],
    });
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it('AUTO=trueでも旧schemaではmigration mutationを始めない', async () => {
    const runMigrations = vi.fn();
    await expect(prepareCanonicalRuntimeSchema({
      database: catalogDatabase([oldCatalog()]),
      autoRunMigrations: true,
      runMigrations,
    })).rejects.toThrow('Runtime schema attestation failed: SCHEMA_UNSUPPORTED');
    expect(runMigrations).not.toHaveBeenCalled();
  });
});

function canonicalCatalog(): RuntimeSchemaCatalog {
  const relations = [
    'schema_migrations', 'users', 'works', 'entities', 'pages', 'episodes', 'entity_states',
    'generation_jobs', 'credit_ledger', 'account_deletion_requests', 'episode_export_jobs',
    'episode_export_job_outbox', 'mobile_store_purchases', 'mobile_push_notification_outbox',
    'state_reference_copy_attempts',
  ].map((name) => ({ name, kind: 'r' }));
  const columns = [
    column('pages', 'layout_config', 'jsonb'),
    column('generation_jobs', 'status', 'text'),
    column('generation_jobs', 'cancel_requested_at', 'timestamp with time zone'),
    column('generation_jobs', 'cancel_requested_by', 'uuid'),
    column('generation_jobs', 'cancelled_at', 'timestamp with time zone'),
    column('generation_jobs', 'commit_started_at', 'timestamp with time zone'),
    column('entity_states', 'name', 'text'),
    column('entity_states', 'description', 'text'),
    column('entity_states', 'reference_image', 'jsonb'),
    column('episodes', 'starting_entity_states', 'jsonb'),
    column('episode_export_jobs', 'status', 'text'),
    column('episode_export_job_outbox', 'export_job_id', 'uuid'),
    column('users', 'account_deletion_started_at', 'timestamp with time zone'),
    column('users', 'account_deleted_at', 'timestamp with time zone'),
    column('account_deletion_requests', 'identity_key', 'text'),
    column('mobile_push_notification_outbox', 'generation_retry_count', 'integer'),
    column('state_reference_copy_attempts', 'state', 'text'),
  ];
  const constraints = [
    constraint('generation_jobs', 'generation_jobs_status_check'),
    constraint('generation_jobs', 'generation_jobs_cancellation_state_check', 'c', false),
    constraint('entity_states', 'entity_states_variant_name_description_check', 'c', false),
    constraint('entity_states', 'entity_states_reference_image_object_check', 'c', false),
    constraint('episodes', 'episodes_starting_entity_states_shape_check', 'c', false),
    constraint('mobile_push_notification_outbox', 'mobile_push_notification_outbox_event_unique', 'u'),
    constraint('account_deletion_requests', 'account_deletion_requests_identity_key_shape_check'),
    constraint('mobile_store_purchases', 'mobile_store_purchases_scheduled_plan_check'),
    constraint('state_reference_copy_attempts', 'state_copy_v2_scope_shape'),
  ];
  return {
    migrationFilenames: [...CANONICAL_RUNTIME_MIGRATIONS],
    relations,
    namespaceArtifacts: [],
    columns,
    constraints,
    indexes: [
      index('episode_export_jobs', 'idx_episode_export_jobs_idempotency_scope'),
      index('episode_export_jobs', 'idx_episode_export_jobs_active_duplicate'),
      index('account_deletion_requests', 'idx_account_deletion_requests_identity_key'),
      index('state_reference_copy_attempts', 'state_copy_v2_active_candidate'),
    ],
    triggers: [
      trigger('works', 'works_account_deletion_write_guard', 'reject_write_after_account_deletion'),
      trigger('entities', 'entities_account_deletion_write_guard', 'reject_write_after_account_deletion'),
      trigger('generation_jobs', 'generation_jobs_account_deletion_write_guard', 'reject_write_after_account_deletion'),
      trigger('credit_ledger', 'generation_job_credit_consume_guard', 'guard_generation_job_credit_consume'),
      trigger('state_reference_copy_attempts', 'state_copy_v2_guard', 'lyra_guard_state_copy_v2_journal'),
    ],
  };
}

function oldCatalog(): RuntimeSchemaCatalog {
  const catalog = canonicalCatalog();
  catalog.migrationFilenames = ['029_add_episode_export_jobs.sql'];
  catalog.relations = catalog.relations.filter(({ name }) => !name.startsWith('episode_export_'));
  catalog.relations.push({ name: 'export_jobs', kind: 'r' }, { name: 'export_job_outbox', kind: 'r' });
  return catalog;
}

function emptyCatalog(): RuntimeSchemaCatalog {
  return { migrationFilenames: [], relations: [], namespaceArtifacts: [], columns: [], constraints: [], indexes: [], triggers: [] };
}

function column(relation: string, name: string, type: string): RuntimeSchemaCatalog['columns'][number] {
  return { relation, name, type, nullable: true };
}

function constraint(relation: string, name: string, type = 'c', validated = true): RuntimeSchemaCatalog['constraints'][number] {
  return {
    relation,
    name,
    type,
    validated,
    definitionSha256: signature(CANONICAL_RUNTIME_SCHEMA_SIGNATURES.constraints, name),
  };
}

function trigger(
  relation: string,
  name: string,
  functionName: string,
  definitionSha256 = (CANONICAL_RUNTIME_SCHEMA_SIGNATURES.triggers as Readonly<Record<string, string>>)[name] ?? 'f'.repeat(64),
): RuntimeSchemaCatalog['triggers'][number] {
  return {
    relation,
    name,
    functionName,
    enabled: 'O',
    definitionSha256,
  };
}

function index(relation: string, name: string): RuntimeSchemaCatalog['indexes'][number] {
  return {
    relation,
    name,
    unique: true,
    valid: true,
    definitionSha256: signature(CANONICAL_RUNTIME_SCHEMA_SIGNATURES.indexes, name),
  };
}

function signature(values: Readonly<Record<string, string>>, name: string): string {
  const value = values[name];
  if (value === undefined) throw new Error(`Missing fixture signature: ${name}`);
  return value;
}

function removeColumn(catalog: RuntimeSchemaCatalog, relation: string, name: string): void {
  catalog.columns = catalog.columns.filter((item) => item.relation !== relation || item.name !== name);
}

function removeConstraint(catalog: RuntimeSchemaCatalog, name: string): void {
  catalog.constraints = catalog.constraints.filter((item) => item.name !== name);
}

function removeTrigger(catalog: RuntimeSchemaCatalog, name: string): void {
  catalog.triggers = catalog.triggers.filter((item) => item.name !== name);
}

function queryCatalogFixture<T extends QueryResultRow>(
  sql: string,
  catalog: RuntimeSchemaCatalog,
  functions: QueryResultRow[] = [],
): QueryResult<T> {
  if (/SET TRANSACTION READ ONLY/u.test(sql)) return queryResult<T>([]);
  if (/FROM pg_class/u.test(sql)) return queryResult<T>(catalog.relations);
  if (/FROM information_schema\.columns/u.test(sql)) return queryResult<T>(catalog.columns);
  if (/FROM pg_constraint/u.test(sql)) return queryResult<T>(catalog.constraints);
  if (/FROM pg_index/u.test(sql)) return queryResult<T>(catalog.indexes);
  if (/FROM pg_trigger/u.test(sql)) return queryResult<T>(catalog.triggers);
  if (/pg_get_function_result/u.test(sql)) return queryResult<T>(functions);
  if (/FROM pg_proc procedure/u.test(sql)) return queryResult<T>(catalog.namespaceArtifacts);
  if (/SELECT filename FROM schema_migrations/u.test(sql)) return queryResult<T>(catalog.migrationFilenames.map((filename) => ({ filename })));
  throw new Error(`Unexpected catalog query: ${sql}`);
}

function catalogDatabase(
  catalogs: RuntimeSchemaCatalog[],
  order: string[] = [],
  functionsByCatalog: QueryResultRow[][] = [],
  queries: string[] = [],
): TransactionRunner {
  let index = 0;
  return {
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      order.push('attest');
      const catalog = catalogs[index++];
      if (catalog === undefined) throw new Error('No catalog fixture');
      return work({
        query: async <R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
          queries.push(sql);
          return queryCatalogFixture<R>(sql, catalog, functionsByCatalog[index - 1]);
        },
      });
    },
  };
}

function queryResult<T extends QueryResultRow>(rows: QueryResultRow[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as T[],
  };
}
