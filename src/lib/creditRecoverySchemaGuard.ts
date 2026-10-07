import type { TransactionRunner } from './db.js';
import { ConfigurationError } from '../domain/errors/index.js';
import { STRIPE_RECOVERY_SCHEMA } from './stripeRecoverySchemaDescriptor.js';

/** Spec §§7–8: no listener or paid-generation worker starts before recovery is durable. */
export async function assertCreditRecoverySchema(database: TransactionRunner): Promise<void> {
  try {
    await database.transaction(async client => {
      await client.query('SET TRANSACTION READ ONLY');
      const receipt = await client.query('SELECT filename FROM schema_migrations WHERE filename=$1', ['049_add_stripe_credit_recovery.sql']);
      if (receipt.rows.length !== 1) throw new Error('Missing receipt');
      const columns = await client.query<Record<string, unknown>>(`
        SELECT table_name AS relation, column_name AS name,
          CASE WHEN data_type='ARRAY' THEN udt_name ELSE data_type END AS type,
          is_nullable='YES' AS nullable,
          CASE WHEN column_default IS NULL THEN NULL ELSE encode(sha256(convert_to(column_default,'UTF8')),'hex') END AS "defaultExpressionSha256",
          CASE WHEN is_identity='YES' THEN identity_generation ELSE NULL END AS "identityGeneration",
          CASE WHEN is_generated='ALWAYS' THEN encode(sha256(convert_to(COALESCE(generation_expression,''),'UTF8')),'hex') ELSE NULL END AS "generatedExpressionSha256"
        FROM information_schema.columns WHERE table_schema=CURRENT_SCHEMA()
      `);
      const constraints = await client.query<Record<string, unknown>>(`
        SELECT relation.relname AS relation, schema_constraint.conname AS name,
          schema_constraint.contype AS type, schema_constraint.convalidated AS validated,
          encode(sha256(convert_to(pg_get_constraintdef(schema_constraint.oid,true),'UTF8')),'hex') AS "definitionSha256"
        FROM pg_constraint schema_constraint
        INNER JOIN pg_class relation ON relation.oid=schema_constraint.conrelid
        INNER JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname=CURRENT_SCHEMA()
      `);
      const indexes = await client.query<Record<string, unknown>>(`
        SELECT relation.relname AS relation, index_relation.relname AS name,
          schema_index.indisunique AS unique, (schema_index.indisvalid AND schema_index.indisready) AS valid,
          encode(sha256(convert_to(jsonb_build_array(
            ARRAY(SELECT pg_get_indexdef(schema_index.indexrelid, position, true)
              FROM generate_series(1, schema_index.indnkeyatts) position ORDER BY position),
            COALESCE(pg_get_expr(schema_index.indpred,schema_index.indrelid,true),'')
          )::text,'UTF8')),'hex') AS "definitionSha256"
        FROM pg_index schema_index
        INNER JOIN pg_class relation ON relation.oid=schema_index.indrelid
        INNER JOIN pg_class index_relation ON index_relation.oid=schema_index.indexrelid
        INNER JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname=CURRENT_SCHEMA()
      `);
      for (const part of ['columns','constraints','indexes'] as const) {
        const rows = { columns, constraints, indexes }[part].rows;
        for (const expected of STRIPE_RECOVERY_SCHEMA[part]) {
          const actual = rows.find(row => row.relation===expected.relation && row.name===expected.name);
          if (actual===undefined || !Object.entries(expected).every(([key,value])=>actual[key]===value)) throw new Error('Invalid recovery schema');
        }
      }
    });
  } catch {
    throw new ConfigurationError('Credit recovery startup requires verified migration 049');
  }
}
