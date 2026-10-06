import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseClient, TransactionRunner } from './db.js';
import { ConfigurationError } from '../domain/errors/index.js';
import { createAccountDeletionIdentityKey } from '../domain/accountDeletion.js';
export const PRODUCTION_BRIDGE_FILENAME = '046_bridge_production_schema_lineage.sql';
const SOURCE_REVISION = '2debe8c3c22633ed077e7b189ddcfa8b209a00dc';
const PRODUCTION_MARKERS = ['028_add_page_story_metadata_columns.sql', '035_add_processing_generation_job_cancellation.sql', '036_fix_push_notification_cancelled_guard.sql', '040_repair_page_story_metadata_columns.sql', '041_add_mobile_subscription_scheduled_plan.sql'];
const LEGACY_ALIASES = [
    ['024_add_account_deletion_requests.sql', '027_add_account_deletion_requests.sql'],
    ['025_add_page_story_metadata_columns.sql', '028_add_page_story_metadata_columns.sql'],
    ['026_add_mobile_store_purchase_ledger.sql', '029_add_mobile_store_purchase_ledger.sql'],
    ['028_add_entity_reference_upload_tokens.sql', '031_add_entity_reference_upload_tokens.sql'],
    ['029_add_episode_export_jobs.sql', '032_add_episode_export_jobs.sql'],
    ['030_add_mobile_push_token_registry.sql', '033_add_mobile_push_token_registry.sql'],
    ['031_add_mobile_push_notification_outbox.sql', '034_add_mobile_push_notification_outbox.sql'],
    ['032_add_processing_generation_job_cancellation.sql', '024_add_generation_job_cancellation.sql'],
] as const;
const REFERENCE_CHECK_FILES = [
    '029_add_mobile_store_purchase_ledger.sql', '031_add_entity_reference_upload_tokens.sql',
    '032_add_episode_export_jobs.sql', '033_add_mobile_push_token_registry.sql', '034_add_mobile_push_notification_outbox.sql',
    '035_add_generation_cancellation_contract.sql',
];
const TABLE_PREFIXES = ['mobile_store_purchase_events', 'mobile_store_purchases', 'credit_ledger', 'entity_reference_upload_tokens',
    'episode_export_job_outbox', 'episode_export_jobs', 'mobile_push_notification_outbox', 'mobile_push_notification_deliveries', 'mobile_push_tokens', 'generation_jobs'];
const REQUIRED_COLUMNS: Record<string, string[]> = {
    users: ['id', 'supabase_id', 'email'], works: ['id', 'user_id', 'organization_id'], entities: ['id', 'work_id', 'user_id'], pages: ['id', 'episode_id', 'layout_config'],
    organizations: ['id', 'created_by_user_id'], organization_members: ['id', 'organization_id', 'user_id'],
    organization_credit_balances: ['organization_id', 'monthly_credits', 'purchased_credits'],
    chapters: ['id', 'work_id'], episodes: ['id', 'chapter_id'], entity_states: ['id', 'entity_id'], reference_sets: ['id', 'entity_id'],
    generation_job_history_hides: ['generation_job_id', 'user_id', 'hidden_at'],
    credit_balances: ['user_id', 'monthly_credits', 'purchased_credits'], credit_ledger: ['id', 'user_id', 'organization_id', 'job_id', 'type', 'amount', 'mobile_store_event_key'],
    generation_jobs: ['id', 'user_id', 'organization_id', 'job_type', 'status', 'params', 'created_at', 'retry_count', 'cancel_requested_at', 'cancelled_at', 'commit_started_at'],
    account_deletion_requests: ['user_id', 'identity_id', 'status', 'created_at', 'updated_at', 'completed_at', 'processing_token', 'processing_started_at', 'data_anonymized_at', 'identity_disabled_at', 'identity_deleted_at', 'scheduled_asset_keys', 'cancelled_subscription_ids'],
    mobile_store_purchases: ['id', 'user_id', 'store', 'external_purchase_key', 'transaction_key', 'product_id', 'kind', 'plan_code', 'credit_package_code', 'state', 'granted_credits', 'reversed_credits'],
    mobile_store_purchase_events: ['id', 'purchase_id', 'event_key', 'transaction_key', 'operation', 'metadata', 'provider_event_type'],
    entity_reference_upload_tokens: ['id', 'user_id', 'organization_id', 'entity_id', 'token_hash', 'purpose', 'mime_type', 'size_bytes', 's3_key', 'expires_at', 'consumed_at', 'created_at'],
    mobile_push_tokens: ['id', 'user_id', 'installation_id', 'platform', 'locale', 'token_hash', 'token_ciphertext', 'encryption_key_id', 'created_at', 'updated_at'],
    mobile_push_notification_outbox: ['id', 'generation_job_id', 'user_id', 'terminal_status', 'created_at'],
    mobile_push_notification_deliveries: ['id', 'outbox_id', 'push_token_id', 'status', 'available_at', 'locked_at', 'lease_token', 'attempt_count', 'error_code', 'sent_at', 'created_at', 'updated_at'],
    export_jobs: ['id', 'user_id', 'organization_id', 'episode_id', 'format', 'filename', 'page_ids', 'page_snapshot', 'request_fingerprint', 'idempotency_key', 'status', 'progress_stage', 'progress_percent', 'artifact_s3_key', 'artifact_mime_type', 'artifact_size_bytes', 'artifact_deleted_at', 'error_code', 'error_message', 'created_at', 'started_at', 'completed_at', 'expires_at', 'updated_at'],
    export_job_outbox: ['export_job_id', 'created_at', 'dispatched_at', 'sqs_message_id', 'dispatch_attempts', 'last_dispatch_error'],
};
interface Catalog {
    columns: Map<string, Map<string, string>>;
    tables: Set<string>;
    relations: Set<string>;
    nullableColumns: Set<string>;
    applied: Set<string>;
    primaryKeys: Map<string, string[]>;
    constraints: Map<string, Set<string>>;
    uniqueKeys: Set<string>;
    foreignKeys: Set<string>;
    validUniqueIndexes: Map<string, string>;
}
export interface MigrationLineageOptions {
    migrationsDir?: string;
    accountDeletionIdentityHashSecret?: string;
}
export interface MigrationLineageReport {
    sourceRevision: string;
    lineage: 'fresh' | 'candidate' | 'production' | 'legacy_mobile' | 'production_bridged' | 'unknown';
    bridgeRequired: boolean;
    continuationRequiresQuiescence: boolean;
    blockers: string[];
    counts: Record<string, number>;
    aliasReceipts: string[];
}
interface NamedCheck {
    name: string;
    expression: string;
}
interface ReferenceCheck extends NamedCheck {
    table: string;
    physicalTable: string;
    validationOnly: boolean;
}
export function extractNamedChecks(sql: string): NamedCheck[] {
    const checks: NamedCheck[] = [];
    const pattern = /\bCONSTRAINT\s+([a-z][a-z0-9_]*)\s+CHECK\s*\(/giu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
        const start = pattern.lastIndex;
        let depth = 1;
        let quoted = false;
        let index = start;
        for (; index < sql.length; index++) {
            const char = sql[index];
            if (char === "'") {
                if (quoted && sql[index + 1] === "'") {
                    index++;
                    continue;
                }
                quoted = !quoted;
                continue;
            }
            if (quoted)
                continue;
            if (char === '(')
                depth++;
            else if (char === ')' && --depth === 0)
                break;
        }
        if (depth !== 0 || quoted)
            throw new ConfigurationError('Malformed historical CHECK constraint');
        checks.push({ name: match[1]!, expression: sql.slice(start, index) });
        pattern.lastIndex = index + 1;
    }
    return checks;
}
async function readCatalog(client: DatabaseClient): Promise<Catalog> {
    const columns = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
    }>("SELECT table_name,column_name,CASE WHEN data_type='ARRAY' THEN udt_name ELSE data_type END AS data_type,is_nullable FROM information_schema.columns WHERE table_schema=CURRENT_SCHEMA()");
    const map = new Map<string, Map<string, string>>();
    for (const row of columns.rows) {
        if (!map.has(row.table_name))
            map.set(row.table_name, new Map());
        map.get(row.table_name)!.set(row.column_name, row.data_type);
    }
    const tables = await client.query<{
        name: string;
        kind: string;
    }>(`SELECT c.relname AS name,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=CURRENT_SCHEMA() AND c.relkind IN ('r','p','v','m','f')`);
    const applied = map.has('schema_migrations') ? await client.query<{
        filename: string;
    }>('SELECT filename FROM schema_migrations') : { rows: [] };
    const constraints = await client.query<{
        table_name: string;
        constraint_name: string;
        constraint_type: string;
        columns: string[] | null;
        target_table: string | null;
        target_schema: string | null;
        target_columns: string[] | null;
        validated: boolean;
        delete_action: string;
    }>(`
    SELECT t.relname AS table_name,c.conname AS constraint_name,c.contype AS constraint_type,
      target.relname AS target_table,target_ns.nspname AS target_schema,c.convalidated AS validated,c.confdeltype AS delete_action,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS target_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      LEFT JOIN pg_class target ON target.oid=c.confrelid
      LEFT JOIN pg_namespace target_ns ON target_ns.oid=target.relnamespace
      WHERE n.nspname=CURRENT_SCHEMA()
  `);
    const primaryKeys = new Map<string, string[]>();
    const names = new Map<string, Set<string>>();
    const uniqueKeys = new Set<string>();
    const foreignKeys = new Set<string>();
    const currentSchema = (await client.query<{
        schema: string;
    }>('SELECT CURRENT_SCHEMA() AS schema')).rows[0]?.schema;
    for (const row of constraints.rows) {
        if (row.constraint_type === 'p')
            primaryKeys.set(row.table_name, row.columns ?? []);
        if (row.constraint_type === 'u' && row.validated)
            uniqueKeys.add(`${row.table_name}:${row.columns?.join(',')}`);
        if (row.constraint_type === 'f' && row.validated && row.target_schema === currentSchema) {
            foreignKeys.add(`${row.table_name}:${row.columns?.join(',')}:${row.target_table}:${row.target_columns?.join(',')}:${row.delete_action}`);
        }
        if (!names.has(row.table_name))
            names.set(row.table_name, new Set());
        names.get(row.table_name)!.add(row.constraint_name);
    }
    const indexes = await client.query<{
        name: string;
        definition: string;
    }>(`SELECT i.relname AS name, pg_get_indexdef(i.oid) AS definition FROM pg_index x
    JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=i.relnamespace
    WHERE n.nspname=CURRENT_SCHEMA() AND x.indisunique AND x.indisvalid AND x.indisready`);
    return { uniqueKeys, foreignKeys, nullableColumns: new Set(columns.rows.filter((row) => row.is_nullable === 'YES').map((row) => `${row.table_name}.${row.column_name}`)), validUniqueIndexes: new Map(indexes.rows.map((row) => [row.name, row.definition])), columns: map, tables: new Set(tables.rows.filter((row) => row.kind === 'r').map((row) => row.name)), relations: new Set(tables.rows.map((row) => row.name)), applied: new Set(applied.rows.map((row) => row.filename)), primaryKeys, constraints: names };
}
async function referenceChecks(migrationsDir: string, catalog: Catalog): Promise<ReferenceCheck[]> {
    const checks: ReferenceCheck[] = [];
    for (const filename of REFERENCE_CHECK_FILES) {
        for (const check of extractNamedChecks(await readFile(join(migrationsDir, filename), 'utf8'))) {
            const table = TABLE_PREFIXES.find((name) => check.name.startsWith(`${name}_`));
            if (!table)
                continue;
            const physicalTable = table === 'episode_export_jobs' && catalog.tables.has('export_jobs') ? 'export_jobs'
                : table === 'episode_export_job_outbox' && catalog.tables.has('export_job_outbox') ? 'export_job_outbox' : table;
            let expression = check.expression;
            if (table === 'generation_jobs') {
                if (!catalog.columns.get(table)?.has('cancel_requested_by') && catalog.columns.get(table)?.has('cancel_requested_by_user_id'))
                    expression = expression.replace(/\bcancel_requested_by\b/gu, 'cancel_requested_by_user_id');
                expression = expression.replace(/\bstatus\b/gu, "(CASE WHEN status='canceled' THEN 'cancelled' ELSE status END)");
            }
            checks.push({ ...check, expression, table, physicalTable, validationOnly: table === 'generation_jobs' });
        }
    }
    return checks;
}
async function count(client: DatabaseClient, sql: string): Promise<number> {
    const result = await client.query<{
        count: string;
    }>(sql);
    return Number(result.rows[0]?.count ?? 0);
}
function identifier(value: string): string {
    if (!/^[a-z][a-z0-9_]*$/u.test(value))
        throw new ConfigurationError('Unexpected lineage identifier');
    return `"${value}"`;
}
export async function inspectMigrationLineage(client: DatabaseClient, options: MigrationLineageOptions = {}): Promise<MigrationLineageReport> {
    const migrationsDir = options.migrationsDir ?? join(process.cwd(), 'migrations');
    const available = new Set((await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')));
    const catalog = await readCatalog(client);
    const legacy = LEGACY_ALIASES.some(([name]) => catalog.applied.has(name));
    const production = PRODUCTION_MARKERS.some((name) => catalog.applied.has(name)) || legacy;
    const bridged = catalog.applied.has(PRODUCTION_BRIDGE_FILENAME);
    const report: MigrationLineageReport = { sourceRevision: SOURCE_REVISION, lineage: 'unknown', bridgeRequired: false, continuationRequiresQuiescence: false, blockers: [], counts: {}, aliasReceipts: [] };
    const allowedHistory = new Set([...available, ...PRODUCTION_MARKERS, ...LEGACY_ALIASES.flatMap((pair) => [...pair])]);
    const unknownHistory = [...catalog.applied].filter((name) => !allowedHistory.has(name)).length;
    if (unknownHistory) {
        report.counts.unknown_history = unknownHistory;
        report.blockers.push('UNKNOWN_MIGRATION_HISTORY');
        return report;
    }
    if (!production) {
        if (catalog.tables.has('export_jobs') || catalog.tables.has('export_job_outbox')) {
            report.blockers.push('UNRECOGNIZED_EXPORT_LINEAGE');
            return report;
        }
        if (catalog.applied.size === 0 && catalog.tables.has('users')) {
            report.blockers.push('UNTRACKED_EXISTING_SCHEMA');
            return report;
        }
        report.lineage = catalog.applied.size === 0 ? 'fresh' : 'candidate';
        return report;
    }
    const legacyExports = catalog.tables.has('export_jobs') && catalog.tables.has('export_job_outbox');
    const candidateExports = catalog.tables.has('episode_export_jobs') && catalog.tables.has('episode_export_job_outbox');
    const anyLegacyExport = catalog.relations.has('export_jobs') || catalog.relations.has('export_job_outbox');
    const anyCandidateExport = catalog.relations.has('episode_export_jobs') || catalog.relations.has('episode_export_job_outbox');
    if ((!bridged && (!legacyExports || anyCandidateExport)) || (bridged && (!candidateExports || anyLegacyExport))) {
        report.blockers.push('AMBIGUOUS_EXPORT_SCHEMA');
        return report;
    }
    if (!bridged && [...catalog.applied].some((name) => /^0(?:35|36|37|38|39|40|41)_/u.test(name) && available.has(name) && !PRODUCTION_MARKERS.includes(name))) {
        report.blockers.push('CANDIDATE_HISTORY_WITHOUT_BRIDGE');
        return report;
    }
    // A marker alone is insufficient: the complete common base and mobile lineage
    // must be recorded under their actual canonical names or recognized aliases.
    const effectiveHistory = new Set(catalog.applied);
    for (const [alias, canonical] of LEGACY_ALIASES)
        if (catalog.applied.has(alias))
            effectiveHistory.add(canonical);
    const requiredHistory = [...available].filter((name) => /^0(?:0[1-9]|[12][0-9]|3[0-4])_/u.test(name))
        .map((name) => name.startsWith('028_') ? '028_add_page_story_metadata_columns.sql' : name);
    const missingHistory = requiredHistory.filter((name) => !effectiveHistory.has(name)).length;
    if (missingHistory) {
        report.counts.missing_required_history = missingHistory;
        report.blockers.push('INCOMPLETE_PRODUCTION_HISTORY');
        return report;
    }
    if (!bridged) {
        const unexpectedColumns: Record<string, string[]> = {
            export_jobs: ['attempt_count', 'processing_lease_token', 'processing_lease_expires_at', 'last_heartbeat_at'],
            mobile_push_notification_outbox: ['generation_retry_count'],
            episodes: ['starting_entity_states'],
            entity_states: ['name', 'description', 'reference_image'],
        };
        const unexpectedConstraints: Record<string, string[]> = {
            generation_jobs: ['generation_jobs_cancellation_state_check', 'legacy_production_generation_cancel_request_metadata_check'],
            users: ['users_account_deletion_timestamps_check'],
            account_deletion_requests: ['account_deletion_requests_identity_key_shape_check'],
            entity_states: ['entity_states_variant_name_description_check', 'entity_states_reference_image_object_check'],
            episodes: ['episodes_starting_entity_states_shape_check'],
        };
        const artifacts = ['generation_quotes', 'google_identity_link_challenges'].filter((name) => catalog.relations.has(name)).length
            + Object.entries(unexpectedColumns).reduce((sum, [table, names]) => sum + names.filter((name) => catalog.columns.get(table)?.has(name)).length, 0)
            + Object.entries(unexpectedConstraints).reduce((sum, [table, names]) => sum + names.filter((name) => catalog.constraints.get(table)?.has(name)).length, 0);
        if (artifacts) {
            report.counts.untracked_candidate_artifacts = artifacts;
            report.blockers.push('UNTRACKED_CANDIDATE_SCHEMA');
            return report;
        }
    }
    report.lineage = bridged ? 'production_bridged' : legacy ? 'legacy_mobile' : 'production';
    report.bridgeRequired = !bridged;
    report.continuationRequiresQuiescence = bridged && [...available].some((name) => /^0(?:0[1-9]|[1-3][0-9]|4[0-6])_/u.test(name) && !catalog.applied.has(name));
    if (!report.bridgeRequired && !report.continuationRequiresQuiescence)
        return report;
    for (const [table, names] of Object.entries(REQUIRED_COLUMNS)) {
        const physical = bridged && table.startsWith('export_') ? `episode_${table}` : table;
        const present = catalog.columns.get(physical);
        const expectedKey = table === 'generation_job_history_hides' ? ['generation_job_id', 'user_id']
            : table === 'account_deletion_requests' || table === 'credit_balances' ? ['user_id']
                : table === 'organization_credit_balances' ? ['organization_id']
                    : table === 'export_job_outbox' ? ['export_job_id'] : ['id'];
        if (JSON.stringify(catalog.primaryKeys.get(physical)) !== JSON.stringify(expectedKey)) {
            report.counts[`schema.${table}.unexpected_primary_key`] = 1;
            report.blockers.push('UNSUPPORTED_PRIMARY_KEYS');
        }
        const missing = names.filter((name) => !present?.has(name)).length;
        if (missing) {
            report.counts[`schema.${table}.missing_columns`] = missing;
            report.blockers.push('UNSUPPORTED_REQUIRED_COLUMNS');
        }
    }
    const physicalTable = (name: string): string => bridged && name.startsWith('export_') ? `episode_${name}` : name;
    const requiredForeignKeys = [
        ['export_jobs', 'user_id', 'users', 'c'], ['export_jobs', 'organization_id', 'organizations', 'c'], ['export_jobs', 'episode_id', 'episodes', 'c'],
        ['export_job_outbox', 'export_job_id', 'export_jobs', 'c'],
        ['mobile_push_notification_outbox', 'generation_job_id', 'generation_jobs', 'c'], ['mobile_push_notification_outbox', 'user_id', 'users', 'c'],
        ['mobile_push_notification_deliveries', 'outbox_id', 'mobile_push_notification_outbox', 'c'], ['mobile_push_notification_deliveries', 'push_token_id', 'mobile_push_tokens', 'n'],
        ['entity_reference_upload_tokens', 'user_id', 'users', 'c'], ['entity_reference_upload_tokens', 'organization_id', 'organizations', 'c'], ['entity_reference_upload_tokens', 'entity_id', 'entities', 'c'],
        ['mobile_store_purchase_events', 'purchase_id', 'mobile_store_purchases', 'n'],
    ];
    const missingForeignKeys = requiredForeignKeys.filter(([table, column, target, action]) => !catalog.foreignKeys.has(`${physicalTable(table!)}:${column}:${physicalTable(target!)}:id:${action}`)).length;
    if (missingForeignKeys) {
        report.counts.missing_foreign_keys = missingForeignKeys;
        report.blockers.push('UNSUPPORTED_FOREIGN_KEYS');
    }
    if (!catalog.foreignKeys.has('mobile_store_purchases:user_id:users:id:c') && !catalog.foreignKeys.has('mobile_store_purchases:user_id:users:id:r'))
        report.blockers.push('UNSUPPORTED_PURCHASE_OWNER_FOREIGN_KEY');
    const requiredUniqueKeys = [
        'users:email',
        'mobile_store_purchases:store,external_purchase_key', 'mobile_store_purchase_events:store,event_key', 'mobile_store_purchase_events:store,transaction_key,operation',
        'entity_reference_upload_tokens:token_hash', 'entity_reference_upload_tokens:s3_key', 'mobile_push_tokens:token_hash', 'mobile_push_tokens:user_id,installation_id',
        'mobile_push_notification_deliveries:outbox_id,push_token_id',
    ];
    if (!bridged)
        requiredUniqueKeys.push('mobile_push_notification_outbox:generation_job_id');
    const missingUniqueKeys = requiredUniqueKeys.filter((key) => !catalog.uniqueKeys.has(key)).length;
    if (missingUniqueKeys) {
        report.counts.missing_unique_keys = missingUniqueKeys;
        report.blockers.push('UNSUPPORTED_UNIQUE_KEYS');
    }
    const expectedIndexes: Record<string, string> = {
        idx_credit_ledger_mobile_store_event_unique: "credit_ledger USING btree (mobile_store_event_key) WHERE (mobile_store_event_key IS NOT NULL)",
        idx_export_jobs_idempotency_scope: `${physicalTable('export_jobs')} USING btree (user_id, COALESCE((organization_id)::text, ''::text), idempotency_key)`,
        idx_export_jobs_active_duplicate: `${physicalTable('export_jobs')} USING btree (episode_id, COALESCE((organization_id)::text, ''::text), request_fingerprint) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]))`,
    };
    const missingIndexes = Object.entries(expectedIndexes).filter(([name, definition]) => {
        const actual = catalog.validUniqueIndexes.get(name);
        return actual === undefined || !actual.endsWith(`.${definition}`);
    }).length;
    if (missingIndexes) {
        report.counts.missing_unique_indexes = missingIndexes;
        report.blockers.push('UNSUPPORTED_UNIQUE_INDEXES');
    }
    const requiredNotNull: Record<string, string[]> = {
        users: ['supabase_id', 'email'],
        account_deletion_requests: ['scheduled_asset_keys', 'cancelled_subscription_ids'],
        mobile_store_purchases: ['user_id', 'store', 'environment', 'external_purchase_key', 'product_id', 'kind', 'state', 'granted_credits', 'reversed_credits', 'last_observed_at', 'created_at', 'updated_at'],
        mobile_store_purchase_events: ['store', 'event_key', 'operation', 'provider_event_type', 'state', 'occurred_at', 'metadata', 'created_at'],
        entity_reference_upload_tokens: ['token_hash', 'user_id', 'purpose', 'mime_type', 'size_bytes', 's3_key', 'expires_at', 'created_at'],
        mobile_push_tokens: ['user_id', 'installation_id', 'platform', 'locale', 'token_hash', 'token_ciphertext', 'encryption_key_id', 'created_at', 'updated_at'],
        mobile_push_notification_outbox: ['generation_job_id', 'user_id', 'terminal_status', 'created_at'],
        mobile_push_notification_deliveries: ['outbox_id', 'status', 'available_at', 'attempt_count', 'created_at', 'updated_at'],
        export_jobs: ['user_id', 'episode_id', 'format', 'filename', 'page_ids', 'page_snapshot', 'request_fingerprint', 'idempotency_key', 'status', 'progress_stage', 'progress_percent', 'created_at', 'expires_at', 'updated_at'],
        export_job_outbox: ['created_at', 'dispatch_attempts'],
    };
    // layout_config is nullable in the supported base; NULL means an empty
    // object during the explicit page metadata normalization below.
    const nullableRequired = Object.entries(requiredNotNull).reduce((total, [table, columns]) => total + columns.filter((column) => catalog.nullableColumns.has(`${physicalTable(table)}.${column}`)).length, 0);
    if (nullableRequired) {
        report.counts.nullable_required_columns = nullableRequired;
        report.blockers.push('UNSUPPORTED_NULLABILITY');
    }
    const generation = catalog.columns.get('generation_jobs');
    if (!generation?.has('cancel_requested_by') && !generation?.has('cancel_requested_by_user_id'))
        report.blockers.push('MISSING_RECORDED_CANCELLATION_ACTOR_COLUMN');
    for (const [table, names] of catalog.columns) {
        if (!(table in REQUIRED_COLUMNS) && table !== 'episode_export_jobs' && table !== 'episode_export_job_outbox')
            continue;
        for (const [name, type] of names) {
            if ((name === 'id' || name === 'user_id' || name === 'organization_id' || name === 'episode_id' || name === 'generation_job_id') && type !== 'uuid') {
                report.counts.unexpected_identity_column_types = (report.counts.unexpected_identity_column_types ?? 0) + 1;
            }
        }
    }
    const expectedTypes: Record<string, Record<string, string>> = {
        users: { email: 'text' },
        pages: { layout_config: 'jsonb', story_source_scene_ids: '_uuid', story_page_purpose: 'text', story_continuity_note: 'text' },
        generation_jobs: { params: 'jsonb', retry_count: 'integer', status: 'text', cancel_requested_by: 'uuid', cancel_requested_by_user_id: 'uuid' },
        account_deletion_requests: { identity_id: 'text', identity_key: 'text', scheduled_asset_keys: '_text', cancelled_subscription_ids: '_text' },
        export_jobs: { page_ids: '_uuid', page_snapshot: 'jsonb' },
    };
    for (const [table, fields] of Object.entries(expectedTypes))
        for (const [column, expected] of Object.entries(fields)) {
            const actual = catalog.columns.get(physicalTable(table))?.get(column);
            if (actual !== undefined && actual !== expected)
                report.counts.unexpected_identity_column_types = (report.counts.unexpected_identity_column_types ?? 0) + 1;
        }
    if (report.counts.unexpected_identity_column_types)
        report.blockers.push('UNSUPPORTED_COLUMN_TYPES');
    if (report.blockers.length) {
        report.blockers = [...new Set(report.blockers)];
        return report;
    }
    const exportTable = bridged ? 'episode_export_jobs' : 'export_jobs';
    const counts: Record<string, string> = {
        active_generation_jobs: "SELECT COUNT(*)::text AS count FROM generation_jobs WHERE status IN ('queued','processing')",
        active_export_jobs: `SELECT COUNT(*)::text AS count FROM ${exportTable} WHERE status IN ('queued','processing')`,
        active_push_deliveries: "SELECT COUNT(*)::text AS count FROM mobile_push_notification_deliveries WHERE status='processing'",
        active_account_deletions: "SELECT COUNT(*)::text AS count FROM account_deletion_requests WHERE status='processing'",
        invalid_page_layouts: "SELECT COUNT(*)::text AS count FROM pages WHERE layout_config IS NOT NULL AND jsonb_typeof(layout_config)<>'object'",
        outbox_actor_mismatch: "SELECT COUNT(*)::text AS count FROM mobile_push_notification_outbox o JOIN generation_jobs j ON j.id=o.generation_job_id WHERE o.user_id<>j.user_id",
        invalid_pending_push_terminal_snapshots: "SELECT COUNT(*)::text AS count FROM mobile_push_notification_deliveries d JOIN mobile_push_notification_outbox o ON o.id=d.outbox_id JOIN generation_jobs j ON j.id=o.generation_job_id WHERE d.status IN ('pending','processing') AND ((CASE WHEN j.status='canceled' THEN 'cancelled' ELSE j.status END) IS DISTINCT FROM o.terminal_status OR j.cancel_requested_at IS NOT NULL OR j.cancelled_at IS NOT NULL)",
        deletion_timestamp_inversion: "SELECT COUNT(*)::text AS count FROM account_deletion_requests WHERE status='completed' AND COALESCE(processing_started_at,data_anonymized_at,identity_disabled_at,created_at)>COALESCE(completed_at,identity_deleted_at,data_anonymized_at,updated_at)",
        missing_deletion_identity_record: "SELECT COUNT(*)::text AS count FROM users u LEFT JOIN account_deletion_requests r ON r.user_id=u.id AND r.status IN ('processing','pending_external_action','completed') WHERE u.supabase_id LIKE 'deleted:%' AND r.user_id IS NULL",
        unusable_deletion_identity_record: "SELECT COUNT(*)::text AS count FROM account_deletion_requests WHERE status IN ('processing','pending_external_action','completed') AND btrim(identity_id) LIKE 'deleted:%'",
        duplicate_deletion_identity: "SELECT COUNT(*)::text AS count FROM (SELECT btrim(identity_id) FROM account_deletion_requests WHERE status IN ('processing','pending_external_action','completed') GROUP BY btrim(identity_id) HAVING COUNT(*)>1) duplicates",
    };
    if (!bridged) {
        // Legacy pending rows have no persisted acknowledgement/scope receipt.
        // Their scheduled keys mean lifecycle scheduling, not exact deletion.
        // Never let the new recovery mapper silently reinterpret that evidence.
        counts.legacy_pending_deletion_requests = "SELECT COUNT(*)::text AS count FROM account_deletion_requests WHERE status='pending_external_action'";
        counts.legacy_scheduled_asset_records = "SELECT COUNT(*)::text AS count FROM account_deletion_requests WHERE cardinality(scheduled_asset_keys)>0";
        // Preserving an original identity is not a scrubbed completion receipt.
        // Match the final deployment invariant without inventing completion or
        // erasing historical evidence. Missing identity_key is itself unresolved.
        const missingIdentityKey=catalog.columns.get('account_deletion_requests')!.has('identity_key')?'identity_key IS NULL':'TRUE';
        counts.legacy_completed_deletion_unscrubbed=`SELECT COUNT(*)::text AS count FROM account_deletion_requests WHERE status='completed' AND (
          ${missingIdentityKey} OR identity_id <> 'deleted:' || user_id::text
          OR cardinality(cancelled_subscription_ids) <> 0 OR cardinality(scheduled_asset_keys) <> 0
          OR data_anonymized_at IS NULL OR identity_deleted_at IS NULL OR completed_at IS NULL
          OR processing_token IS NOT NULL OR processing_started_at IS NOT NULL)`;

    }
    if (generation!.has('cancel_requested_by') && generation!.has('cancel_requested_by_user_id')) {
        counts.conflicting_recorded_cancellation_actor = "SELECT COUNT(*)::text AS count FROM generation_jobs WHERE cancel_requested_by IS NOT NULL AND cancel_requested_by_user_id IS NOT NULL AND cancel_requested_by<>cancel_requested_by_user_id";
    }
    if (catalog.columns.get('mobile_push_notification_outbox')!.has('organization_id')) {
        counts.outbox_scope_mismatch = "SELECT COUNT(*)::text AS count FROM mobile_push_notification_outbox o JOIN generation_jobs j ON j.id=o.generation_job_id WHERE o.organization_id IS NOT NULL AND o.organization_id IS DISTINCT FROM j.organization_id";
    }
    if (!catalog.columns.get('pages')!.has('story_source_scene_ids')) {
        counts.invalid_legacy_scene_ids = "SELECT COUNT(*)::text AS count FROM pages WHERE (layout_config ? 'story_source_scene_ids' AND jsonb_typeof(layout_config->'story_source_scene_ids') NOT IN ('array','null')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(layout_config->'story_source_scene_ids')='array' THEN layout_config->'story_source_scene_ids' ELSE '[]'::jsonb END) AS item(value) WHERE value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')";
    }
    if (catalog.columns.get('account_deletion_requests')!.has('identity_key')) {
        counts.invalid_existing_identity_keys = "SELECT COUNT(*)::text AS count FROM account_deletion_requests WHERE identity_key IS NOT NULL AND char_length(identity_key)<>43";
        counts.duplicate_existing_identity_keys = "SELECT COUNT(*)::text AS count FROM (SELECT identity_key FROM account_deletion_requests WHERE identity_key IS NOT NULL GROUP BY identity_key HAVING COUNT(*)>1) duplicates";
    }
    const started = catalog.columns.get('users')!.has('account_deletion_started_at') ? 'u.account_deletion_started_at' : 'NULL::timestamptz';
    const deleted = catalog.columns.get('users')!.has('account_deleted_at') ? 'u.account_deleted_at' : 'NULL::timestamptz';
    // Match UserRepository.findByEmail's exact lower(email) normalization after
    // the deletion-start timestamps this prepass will preserve/backfill. Report
    // only the number of ambiguous groups; never choose, merge or print users.
    counts.duplicate_normalized_active_email_groups = `SELECT COUNT(*)::text AS count FROM (
      SELECT lower(u.email) FROM users u
      LEFT JOIN account_deletion_requests r ON r.user_id=u.id AND r.status IN ('processing','pending_external_action','completed')
      WHERE ${started} IS NULL AND r.user_id IS NULL
      GROUP BY lower(u.email) HAVING COUNT(*)>1
    ) duplicate_groups`;
    counts.invalid_resulting_deletion_timestamps = `WITH resulting AS (SELECT
    COALESCE(${started},r.processing_started_at,r.data_anonymized_at,r.identity_disabled_at,r.created_at) AS started,
    CASE WHEN r.status='completed' THEN COALESCE(${deleted},r.completed_at,r.identity_deleted_at,r.data_anonymized_at,r.updated_at) ELSE ${deleted} END AS deleted
    FROM users u LEFT JOIN account_deletion_requests r ON r.user_id=u.id AND r.status IN ('processing','pending_external_action','completed'))
    SELECT COUNT(*)::text AS count FROM resulting WHERE deleted IS NOT NULL AND (started IS NULL OR deleted<started)`;
    for (const [name, sql] of Object.entries(counts)) {
        const value = await count(client, sql);
        report.counts[name] = value;
        if (value > 0)
            report.blockers.push(name.startsWith('active_') ? 'ACTIVE_WORK_REQUIRES_QUIESCENCE' : name.startsWith('invalid_') ? name.toUpperCase() : `INVALID_${name.toUpperCase()}`);
    }
    for (const check of await referenceChecks(migrationsDir, catalog)) {
        const violations = await count(client, `SELECT COUNT(*)::text AS count FROM ${identifier(check.physicalTable)} WHERE (${check.expression}) IS FALSE`);
        report.counts[`constraint.${check.name}`] = violations;
        if (violations > 0)
            report.blockers.push(`LEGACY_ROWS_VIOLATE_${check.name.toUpperCase()}`);
    }
    const identityKeyColumn = catalog.columns.get('account_deletion_requests')!.has('identity_key') ? 'identity_key' : 'NULL::text AS identity_key';
    const identities = await client.query<{
        identity_id: string;
        identity_key: string | null;
    }>(`SELECT identity_id,${identityKeyColumn} FROM account_deletion_requests WHERE status IN ('processing','pending_external_action','completed')`);
    report.counts.deletion_identities_requiring_hash = identities.rows.length;
    if (identities.rows.length > 0) {
        if (options.accountDeletionIdentityHashSecret === undefined)
            report.blockers.push('MISSING_IDENTITY_HASH_SECRET');
        else {
            try {
                for (const row of identities.rows) {
                    const key = createAccountDeletionIdentityKey(options.accountDeletionIdentityHashSecret, row.identity_id);
                    if (row.identity_key !== null && row.identity_key !== key)
                        report.blockers.push('EXISTING_IDENTITY_KEY_MISMATCH');
                }
            }
            catch {
                report.blockers.push('INVALID_IDENTITY_OR_HASH_SECRET');
            }
        }
    }
    report.aliasReceipts = LEGACY_ALIASES.filter(([legacyName, canonical]) => catalog.applied.has(legacyName) && !catalog.applied.has(canonical)).map(([, canonical]) => canonical);
    report.blockers = [...new Set(report.blockers)];
    return report;
}
export async function reconcileProductionLineage(database: DatabaseClient & TransactionRunner, options: MigrationLineageOptions & {
    allowProductionLineageBridge?: boolean;
}, applied: Set<string>, available: ReadonlySet<string>): Promise<string[]> {
    if (!available.has(PRODUCTION_BRIDGE_FILENAME))
        return [];
    const report = await inspectMigrationLineage(database, options);
    if (report.lineage === 'fresh' || report.lineage === 'candidate')
        return [];
    if (report.blockers.length)
        throw new ConfigurationError(`Production lineage bridge blocked: ${report.blockers.join(', ')}`);
    if (!report.bridgeRequired && !report.continuationRequiresQuiescence)
        return [];
    if (options.allowProductionLineageBridge !== true)
        throw new ConfigurationError('Production lineage bridge requires explicit writer-quiescence acknowledgement');
    const migrated = await database.transaction(async (client) => {
        await client.query("SET LOCAL lock_timeout='5s'");
        const catalog = await readCatalog(client);
        const tables = Object.keys(REQUIRED_COLUMNS).map((name) => name.startsWith('export_') && !catalog.tables.has(name) ? `episode_${name}` : name).sort();
        await client.query(`LOCK TABLE ${tables.map(identifier).join(', ')} IN ACCESS EXCLUSIVE MODE`);
        const current = await inspectMigrationLineage(client, options);
        if (current.blockers.length)
            throw new ConfigurationError(`Production lineage bridge blocked: ${current.blockers.join(', ')}`);
        if (!current.bridgeRequired)
            return false;
        await client.query("SELECT set_config('lyra.production_lineage_bridge','validated-production-v1',true)");
        await client.query(await readFile(join(options.migrationsDir ?? join(process.cwd(), 'migrations'), PRODUCTION_BRIDGE_FILENAME), 'utf8'));
        // Checks are copied from immutable historical candidate SQL, never invented
        // from filename aliases. Validate legacy data before recording their adoption.
        const checks = await referenceChecks(options.migrationsDir ?? join(process.cwd(), 'migrations'), catalog);
        for (const check of checks) {
            if (check.validationOnly)
                continue;
            await client.query(`ALTER TABLE ${identifier(check.table)} DROP CONSTRAINT IF EXISTS ${identifier(check.name)}`);
            await client.query(`ALTER TABLE ${identifier(check.table)} ADD CONSTRAINT ${identifier(check.name)} CHECK (${check.expression}) NOT VALID`);
            await client.query(`ALTER TABLE ${identifier(check.table)} VALIDATE CONSTRAINT ${identifier(check.name)}`);
        }
        const identities = await client.query<{
            user_id: string;
            identity_id: string;
            identity_key: string | null;
        }>("SELECT user_id,identity_id,identity_key FROM account_deletion_requests WHERE status IN ('processing','pending_external_action','completed') FOR UPDATE");
        for (const identity of identities.rows) {
            if (options.accountDeletionIdentityHashSecret === undefined)
                throw new ConfigurationError('Identity hash secret is required');
            const key = createAccountDeletionIdentityKey(options.accountDeletionIdentityHashSecret, identity.identity_id);
            if (identity.identity_key !== null && identity.identity_key !== key)
                throw new ConfigurationError('Existing deletion tombstone does not match the configured identity hash secret');
            await client.query('UPDATE account_deletion_requests SET identity_key=$2 WHERE user_id=$1::uuid', [identity.user_id, key]);
        }
        for (const filename of current.aliasReceipts)
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [filename]);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [PRODUCTION_BRIDGE_FILENAME]);
        return true;
    });
    const refreshed = await database.query<{
        filename: string;
    }>('SELECT filename FROM schema_migrations');
    for (const row of refreshed.rows)
        applied.add(row.filename);
    return migrated ? [PRODUCTION_BRIDGE_FILENAME] : [];
}
