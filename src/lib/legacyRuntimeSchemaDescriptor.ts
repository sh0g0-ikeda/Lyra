import type { RuntimeSchemaCatalog } from './runtimeSchemaAttestation.js';

/** Artificial 38-migration reference from committed 2debe source, not a production DB attestation. */
export const LEGACY_RUNTIME_SCHEMA_SOURCE = '2debe8c3c22633ed077e7b189ddcfa8b209a00dc';
export const LEGACY_RUNTIME_SCHEMA_REFERENCE: Readonly<RuntimeSchemaCatalog> = {
  "migrationFilenames": [
    "001_initial_schema.sql",
    "002_add_episode_story_input_mode.sql",
    "003_add_generation_active_resource_locks.sql",
    "004_add_rate_limit_buckets.sql",
    "005_add_billing_idempotency_indexes.sql",
    "006_add_generation_job_retention_index.sql",
    "007_add_credit_refund_job_idempotency_index.sql",
    "008_add_credit_ledger_bucket_deltas.sql",
    "009_add_generation_job_state_constraints.sql",
    "010_add_billing_state_constraints.sql",
    "011_add_core_app_state_constraints.sql",
    "012_add_credit_ledger_amount_sign_constraint.sql",
    "013_add_subscription_status_constraint.sql",
    "014_add_payment_record_external_id_constraint.sql",
    "015_add_episode_story_autofill_job_type.sql",
    "016_add_episode_story_autofill_active_lock.sql",
    "017_add_episode_page_skeleton_job_type.sql",
    "018_allow_enterprise_billing_plan_codes.sql",
    "019_add_organization_workspaces.sql",
    "020_add_payment_record_invoice_url.sql",
    "021_add_organization_workspace_indexes.sql",
    "022_add_organization_invitation_delivery.sql",
    "023_merge_creator_role_into_editor.sql",
    "024_add_generation_job_cancellation.sql",
    "025_include_cancelled_jobs_in_retention_index.sql",
    "026_backfill_legacy_credit_consume_job_links.sql",
    "027_add_account_deletion_requests.sql",
    "028_add_page_story_metadata_columns.sql",
    "029_add_mobile_store_purchase_ledger.sql",
    "030_add_generation_job_management.sql",
    "031_add_entity_reference_upload_tokens.sql",
    "032_add_episode_export_jobs.sql",
    "033_add_mobile_push_token_registry.sql",
    "034_add_mobile_push_notification_outbox.sql",
    "035_add_processing_generation_job_cancellation.sql",
    "036_fix_push_notification_cancelled_guard.sql",
    "040_repair_page_story_metadata_columns.sql",
    "041_add_mobile_subscription_scheduled_plan.sql"
  ],
  "relations": [
    {
      "name": "account_deletion_requests",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "balloons",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "chapters",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "composition_gallery",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "credit_balances",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "credit_ledger",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "email_delivery_logs",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "entities",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "entity_reference_upload_tokens",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "entity_states",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "episodes",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "export_job_outbox",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "export_jobs",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "generation_job_history_hides",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "generation_jobs",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "mobile_push_notification_deliveries",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "mobile_push_notification_outbox",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "mobile_push_tokens",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "mobile_store_purchase_events",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "mobile_store_purchases",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "organization_audit_logs",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "organization_credit_balances",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "organization_invitations",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "organization_members",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "organization_usage_events",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "organizations",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "pages",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "panel_frames",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "panels",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "payment_records",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "processed_stripe_events",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "rate_limit_buckets",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "reference_sets",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "scenes",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "schema_migration_locks",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "schema_migrations",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "subscriptions",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "users",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "works",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    }
  ],
  "namespaceArtifacts": [
    {
      "kind": "function",
      "name": "enqueue_mobile_push_notification_for_terminal_job()"
    },
    {
      "kind": "function",
      "name": "refund_late_canceled_generation_job_consume()"
    }
  ],
  "columns": [
    {
      "relation": "account_deletion_requests",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "identity_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "02eadf85fb3a4ac5a2118f214b1db7a60731eac071e4ec6d62668b89f94bfa1c",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "blocker_codes",
      "type": "_text",
      "nullable": false,
      "defaultExpressionSha256": "de9b902a0abb75d50771c319ee6d6a50d3963e3d28ce30e76b96e3c382b0c4ab",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "cancelled_subscription_ids",
      "type": "_text",
      "nullable": false,
      "defaultExpressionSha256": "de9b902a0abb75d50771c319ee6d6a50d3963e3d28ce30e76b96e3c382b0c4ab",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "identity_disabled_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "identity_deleted_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "scheduled_asset_keys",
      "type": "_text",
      "nullable": false,
      "defaultExpressionSha256": "de9b902a0abb75d50771c319ee6d6a50d3963e3d28ce30e76b96e3c382b0c4ab",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "data_anonymized_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "processing_token",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "processing_started_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "last_failure_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "retry_count",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "completed_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "account_deletion_requests",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "page_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "speaker_entity_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "balloon_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "022152f4f283f1cf2ecdba7bb2025c3306286d7844a5c4d5216f7d3cc82595e4",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "writing_mode",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": "6111f0f8deb830c276f422e6256d5165c5bc16fee31e8bb05f7ee08e532238bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "text",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "676219f025870b893c0df8670464cfdae5f5cc073c6c44841e35f1805c6b81ce",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "position",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "tail",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "font_size",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": "4ec9599fc203d176a301536c2e091a19bc852759b255bd6818810a42c5fed14a",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "font_family",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": "cd40b3c941e4d7ede5705ab7b88ee974bff92ed980e8afe59b1afa983f885ae7",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "panel_order_reference",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "balloons",
      "name": "z_index",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": "4a44dc15364204a80fe80e9039455cc1608281820fe2b24f1e5233ade6af1dd5",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "work_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "order",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "title",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "purpose",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "starting_state",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "ending_state",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "emotion_curve",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "entities_involved",
      "type": "_uuid",
      "nullable": true,
      "defaultExpressionSha256": "874697a460d59a5bc7ecf858321317e676d3ccefb76042f5832f72ad71e9b223",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "key_beats",
      "type": "_text",
      "nullable": true,
      "defaultExpressionSha256": "de9b902a0abb75d50771c319ee6d6a50d3963e3d28ce30e76b96e3c382b0c4ab",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "version",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "edit_history",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": "3fad7390b7bffb3cf2f50703d5e74be1cd9c8738608b6702cfea68f9d98e02bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "465e7ba2b7715e69c0e0b45f365d8767283687aef1e384664e15d3b028e2e1db",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "chapters",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "name",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "category",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "entity_count",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "preview_s3_key",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "preview_cdn_url",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "composition_prompt",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "shot_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "angle",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "tags",
      "type": "_text",
      "nullable": true,
      "defaultExpressionSha256": "de9b902a0abb75d50771c319ee6d6a50d3963e3d28ce30e76b96e3c382b0c4ab",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "composition_gallery",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_balances",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_balances",
      "name": "monthly_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_balances",
      "name": "purchased_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_balances",
      "name": "monthly_expires_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_balances",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "user_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "amount",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "monthly_after",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "purchased_after",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "description",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "stripe_event_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "job_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "monthly_delta",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "purchased_delta",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "credit_ledger",
      "name": "mobile_store_event_key",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "invitation_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "recipient_email",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "template_key",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "provider",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "provider_message_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "error_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "error_message",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "email_delivery_logs",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "work_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "entity_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "fb9c53b820a2293518dc32aa4df865da0cd2a38ea69a10bb81cec3115a23163c",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "name",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "free_description",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "structured_fields",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": "8001f2ba79d7ee0ed7c18f82705408c75c1e6f9ac6859477febdad7f5599c099",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "prompt_supplement",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "speech_profile",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": "8001f2ba79d7ee0ed7c18f82705408c75c1e6f9ac6859477febdad7f5599c099",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "465e7ba2b7715e69c0e0b45f365d8767283687aef1e384664e15d3b028e2e1db",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entities",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "token_hash",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "purpose",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "mime_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "size_bytes",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "s3_key",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "expires_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "consumed_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "entity_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "scene_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "costume_note",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "costume_ref_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "condition_note",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "hair_note",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "expression_default",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": "7513b4888c472ab432ee12c1cf01884323308159a70389a6ecefffe566a46d18",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "extra_note",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "entity_states",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "chapter_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "order",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "title",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "purpose",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "introduction",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "middle",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "climax",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "ending_hook",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "estimated_pages",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": "b17ef6d19c7a5b1ee83b907c595526dcb1eb06db8227d650d5dda0a9f4ce8cd9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "entities_involved",
      "type": "_uuid",
      "nullable": true,
      "defaultExpressionSha256": "874697a460d59a5bc7ecf858321317e676d3ccefb76042f5832f72ad71e9b223",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "page_skeleton_generated",
      "type": "boolean",
      "nullable": true,
      "defaultExpressionSha256": "fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "version",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "edit_history",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": "3fad7390b7bffb3cf2f50703d5e74be1cd9c8738608b6702cfea68f9d98e02bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "465e7ba2b7715e69c0e0b45f365d8767283687aef1e384664e15d3b028e2e1db",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "story_input_mode",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "321399edffa3ecbf5c8cae8e0f2ecc3336643121d17c99cd39c3f9c589536a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "episodes",
      "name": "story_full_draft",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_job_outbox",
      "name": "export_job_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_job_outbox",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_job_outbox",
      "name": "dispatched_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_job_outbox",
      "name": "sqs_message_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_job_outbox",
      "name": "dispatch_attempts",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_job_outbox",
      "name": "last_dispatch_error",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "episode_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "format",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "filename",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "page_ids",
      "type": "_uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "page_snapshot",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "request_fingerprint",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "idempotency_key",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "920ca217af670763272ef2a643e7baedb0cb3d49984e3c8d1a1bd4c24732bfa0",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "progress_stage",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "920ca217af670763272ef2a643e7baedb0cb3d49984e3c8d1a1bd4c24732bfa0",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "progress_percent",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "artifact_s3_key",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "artifact_mime_type",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "artifact_size_bytes",
      "type": "bigint",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "artifact_deleted_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "error_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "error_message",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "started_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "completed_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "expires_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "export_jobs",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_job_history_hides",
      "name": "generation_job_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_job_history_hides",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_job_history_hides",
      "name": "hidden_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "job_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "920ca217af670763272ef2a643e7baedb0cb3d49984e3c8d1a1bd4c24732bfa0",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "generation_mode",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "credit_cost",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "params",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "result",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "sqs_message_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "openai_request_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "error_message",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "retry_count",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "started_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "completed_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "expires_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "cancel_requested_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "cancel_requested_by",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "cancelled_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_jobs",
      "name": "commit_started_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "outbox_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "push_token_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "a89df8d14a00b7bd2ead7e86414dcd5232bff306786856171b38584e153bb73f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "available_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "locked_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "lease_token",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "sent_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "attempt_count",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "error_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "generation_job_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "terminal_status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "installation_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "platform",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "token_hash",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "token_ciphertext",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "encryption_key_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_push_tokens",
      "name": "locale",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "4b6b49b1712465862280839686f4d14d5664b3510301f37af99e1c5b7f6dfabe",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "purchase_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "store",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "event_key",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "transaction_key",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "operation",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "provider_event_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "state",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "occurred_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "metadata",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "8001f2ba79d7ee0ed7c18f82705408c75c1e6f9ac6859477febdad7f5599c099",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "store",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "environment",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "external_purchase_key",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "product_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "kind",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "plan_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "credit_package_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "state",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "transaction_key",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "expires_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "auto_renew_enabled",
      "type": "boolean",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "granted_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "reversed_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "last_observed_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "scheduled_product_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "scheduled_plan_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "mobile_store_purchases",
      "name": "scheduled_effective_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_audit_logs",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_audit_logs",
      "name": "actor_user_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_audit_logs",
      "name": "action",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_audit_logs",
      "name": "target_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_audit_logs",
      "name": "target_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_audit_logs",
      "name": "metadata",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "8001f2ba79d7ee0ed7c18f82705408c75c1e6f9ac6859477febdad7f5599c099",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_audit_logs",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_credit_balances",
      "name": "monthly_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_credit_balances",
      "name": "purchased_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_credit_balances",
      "name": "monthly_expires_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_credit_balances",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "organization_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "email",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "role",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "token_hash",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "a89df8d14a00b7bd2ead7e86414dcd5232bff306786856171b38584e153bb73f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "invited_by_user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "accepted_by_user_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "expires_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "accepted_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "sent_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "last_sent_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "send_status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "f88c73a0a5e631b17a17abf71b4053b5e1a6c06eaa01c253835c521516886a2f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "send_error_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "send_error_message",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "resend_count",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "revoked_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_invitations",
      "name": "revoked_by_user_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "organization_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "role",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "bc587d16fe04f2dc435392330ab3f1d862259110e3f739541615410e35793930",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "invited_by_user_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "joined_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_members",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "user_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "work_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "generation_job_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "event_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "credit_amount",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "metadata",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "8001f2ba79d7ee0ed7c18f82705408c75c1e6f9ac6859477febdad7f5599c099",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organization_usage_events",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "def2d2da9ed9a228f88f2f199faa465d4be84b5d8582d50081440350f53d7be9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "name",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "legal_name",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "bc587d16fe04f2dc435392330ab3f1d862259110e3f739541615410e35793930",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "plan_key",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "f03e9f3a4de83c39e3380899d180a6a79eba018661692596e92ca1e0949201c1",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "billing_email",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "stripe_customer_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "stripe_subscription_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "created_by_user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "organizations",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "episode_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "scene_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "page_number",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "layout_config",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "8001f2ba79d7ee0ed7c18f82705408c75c1e6f9ac6859477febdad7f5599c099",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "dialogue_mode",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "053bfa91edc13bd12387882c05f965168731bb07dbbb3d0b57d3b31d6acf021e",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "page_dialogue_toggle",
      "type": "boolean",
      "nullable": false,
      "defaultExpressionSha256": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "generated_image",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "generation_mode",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "486f0c4bd0ed6d6933d44d47db624ef70003d54ed8c64b1f6185aed3091d5768",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "story_source_scene_ids",
      "type": "_uuid",
      "nullable": false,
      "defaultExpressionSha256": "20f33b491ada61e22611d7e61b8524635190a4704d7c0d61125fb70276f72b9a",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "story_page_purpose",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "pages",
      "name": "story_continuity_note",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "page_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "panel_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "vertices",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "border_style",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": "c25e9c2cb14bc681be1f6caa32eb742cd6df1cd9f3a1e234fc62178509ae145c",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "border_width",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "border_color",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": "329429d5e29265872c369f5d3ed6c8735f12d683c485227b8560f2f1a4075a93",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "z_index",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panel_frames",
      "name": "reading_order",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "page_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "order",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "panel_role",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": "e4a3eb0def67bdbf8e01e185d8fa8387412d5211249c752a58dbe2aeeed3e8f9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "panel_size",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": "b4e0b7f795e88e8fc4095af23dc9c55303167388efeb253c6f2c149c1aeed829",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "situation_text",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "entities",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "3fad7390b7bffb3cf2f50703d5e74be1cd9c8738608b6702cfea68f9d98e02bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "composition",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "8001f2ba79d7ee0ed7c18f82705408c75c1e6f9ac6859477febdad7f5599c099",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "dialogue_in_panel",
      "type": "boolean",
      "nullable": true,
      "defaultExpressionSha256": "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "dialogue",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "3fad7390b7bffb3cf2f50703d5e74be1cd9c8738608b6702cfea68f9d98e02bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "sfx_text",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "background_note",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "panel_notes",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "panels",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "user_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "stripe_checkout_session_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "stripe_invoice_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "kind",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "amount_jpy",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "invoice_url",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "processed_stripe_events",
      "name": "stripe_event_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "processed_stripe_events",
      "name": "event_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "processed_stripe_events",
      "name": "processed_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "rate_limit_buckets",
      "name": "bucket_key",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "rate_limit_buckets",
      "name": "count",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "rate_limit_buckets",
      "name": "reset_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "rate_limit_buckets",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "reference_sets",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "reference_sets",
      "name": "entity_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "reference_sets",
      "name": "reference_images",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "3fad7390b7bffb3cf2f50703d5e74be1cd9c8738608b6702cfea68f9d98e02bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "reference_sets",
      "name": "primary_ref_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "reference_sets",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "d51469d1de85230572b5b7dc76ecbc914ee4d047a727a4ca19408c9cf3c964fa",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "reference_sets",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "episode_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "order",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "location",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "time",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "atmosphere",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "involved_entity_ids",
      "type": "_uuid",
      "nullable": true,
      "defaultExpressionSha256": "874697a460d59a5bc7ecf858321317e676d3ccefb76042f5832f72ad71e9b223",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "entity_states",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": "3fad7390b7bffb3cf2f50703d5e74be1cd9c8738608b6702cfea68f9d98e02bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "465e7ba2b7715e69c0e0b45f365d8767283687aef1e384664e15d3b028e2e1db",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "scenes",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "schema_migration_locks",
      "name": "name",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "schema_migration_locks",
      "name": "locked_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "schema_migrations",
      "name": "filename",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "schema_migrations",
      "name": "applied_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "user_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "stripe_subscription_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "plan_code",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "current_period_start",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "current_period_end",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "cancel_at_period_end",
      "type": "boolean",
      "nullable": true,
      "defaultExpressionSha256": "fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "subscriptions",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "users",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "users",
      "name": "supabase_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "users",
      "name": "email",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "users",
      "name": "display_name",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "users",
      "name": "stripe_customer_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "users",
      "name": "plan_code",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "3a19b9adc007d1dd1b1b016d8b6083d5d405a6e117da28bc5cbdcf5fda02ad1c",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "users",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "users",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "title",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "genre",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "world_setting",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "theme",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "main_entity_ids",
      "type": "_uuid",
      "nullable": true,
      "defaultExpressionSha256": "874697a460d59a5bc7ecf858321317e676d3ccefb76042f5832f72ad71e9b223",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "starting_point",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "ending_point",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "overall_flow",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "version",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "edit_history",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": "3fad7390b7bffb3cf2f50703d5e74be1cd9c8738608b6702cfea68f9d98e02bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "465e7ba2b7715e69c0e0b45f365d8767283687aef1e384664e15d3b028e2e1db",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    }
  ],
  "constraints": [
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_blocker_code_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "4e9556e50ca0a7a79d5cfa859c1cfea84fb5d3eb417edd01dfb59ce0041c2119"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_blocker_codes_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b1ab2b350decb6d006bea13ed3acca14af2d6e9aefd4c8501d723ccfe7dde376"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_cancelled_subscription_ids_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "cf4d1c854688e40f177f7a816aeb0a5f8d4e3257a4f32829debc254a51a7db34"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_identity_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fff5c80a9f8a7a3b5029d5213110b32ab6766ffc8953ab80bc5aaa8aed9ce6c7"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "44756d887704fc88d8d0adc5c0c431103c555b4f8e6a4ddef6f7a7f6b4110606"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_processing_claim_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "edaebf5ba83b46ba52418a3294c5e6c8a69ef14905180e30b0ec7fd2ece5ff3b"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_retry_count_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "63a5687700f073cf0074e6e69097d05b005ee28cdeb849cfc9d9fbc4e460ce7e"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_retry_count_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "c695e280e496d34e48071d61680678280acdea0c26b26b1fab9d72e92c44584e"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_scheduled_asset_keys_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "aa75fa863b4edc3536a3d51b376322e0ee19f2b3c816ddd7be03e5295ce13290"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "555e384fbcd65e53976997b86b4ec04c06bd385bffe75939ef36fceca14c0f8c"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "db0351f478b802a84b60a198bd2265857cab14e20ea9a0d0484d9573c6052c5a"
    },
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "balloons",
      "name": "balloons_balloon_type_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "efcaad897889c44f010a1ec4456afc59c10b41d46437e8891997fb0778146d21"
    },
    {
      "relation": "balloons",
      "name": "balloons_balloon_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2b359e119d1a8a93934d48f6844fdee289db6b70b49212aa06f9312cf667f019"
    },
    {
      "relation": "balloons",
      "name": "balloons_font_family_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "0c9e2f1e80f43621ab89d972086fe1ab1c5bd6b2a8f80d46f33259fe692dcd36"
    },
    {
      "relation": "balloons",
      "name": "balloons_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "balloons",
      "name": "balloons_page_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "e0a662c6e736eb18e0b68dc781b2cf2b14596a83f6a3e3bc2d5703edda31f819"
    },
    {
      "relation": "balloons",
      "name": "balloons_page_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1488d1384b9b9048291c2f1c3b255c969cda56de7dc7543c2c8d03c1e16c99b9"
    },
    {
      "relation": "balloons",
      "name": "balloons_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "balloons",
      "name": "balloons_position_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e00193a4ee5abba80d598608e9062bfbfaf1a0d42a93f9d0c02a843726d21e2b"
    },
    {
      "relation": "balloons",
      "name": "balloons_speaker_entity_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "edabf9c20b2f9ab3b28c338951d0e44a45325a43bd8c604bfe087950cd6a72a7"
    },
    {
      "relation": "balloons",
      "name": "balloons_text_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "dd47a73318f77aedeab9f2321490575001e719d7b2557ebd47e5b571ed8a5917"
    },
    {
      "relation": "balloons",
      "name": "balloons_writing_mode_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "2c036e2b6c329e92284b6bc6cae0209b0ef60d333c58bb03be823300c934846b"
    },
    {
      "relation": "chapters",
      "name": "chapters_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "chapters",
      "name": "chapters_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "chapters",
      "name": "chapters_order_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b938cce79fadcd5b71a501eb3ddd0e1e97792e4a40fec8052a1e8351f7d115f7"
    },
    {
      "relation": "chapters",
      "name": "chapters_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "chapters",
      "name": "chapters_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9c92339bf5b4c254e77e15e9e9c524f6be5c256e979d44f7d09037a675565ad0"
    },
    {
      "relation": "chapters",
      "name": "chapters_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "chapters",
      "name": "chapters_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "chapters",
      "name": "chapters_version_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "736415a195f08a4248373da5ce66ccf827e081def78b0d8b4c203dbc5c2a3be2"
    },
    {
      "relation": "chapters",
      "name": "chapters_work_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "bab4f4dfe4ecf249f316e2aa690b4acf99306de1a6301f7bf057192afd29f445"
    },
    {
      "relation": "chapters",
      "name": "chapters_work_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "63e6d529ddeccdab60d7097269a9b70357913b4b61fec9709126c03e8ad4f801"
    },
    {
      "relation": "chapters",
      "name": "chapters_work_id_order_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "4c9a2140aa0ea37705af398cc30b18f6fa7caf49bd29465f8f820bdde95eb90a"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_angle_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "c39c568b9cf27b3b74cf18e8f44584a49f4a0b2b10f81e5ac20c844d258b37b1"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_category_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "0ce3a57a89552a46de937b11c81f9285828a05c283b8783c68b05f3217c867ba"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_composition_prompt_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "5f55298a1a1abae2fd5bc45f7001b290c69e4975ebf8561f875b3e16931b6f09"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_entity_count_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b0dcb34a4c65ddb69a7902b88e5f9a7815a6151ff9d28881388b8900a57a1e26"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_name_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2de18fe30b89709c9ff79c7f93fabe08ce27ba81484cce0371766fa6549377a4"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_preview_cdn_url_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e8d191f5dd5f5afe83a32df748c20bb545c9ab6ce4fc0a58158372ceecd9a43f"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_preview_s3_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "087ef85417a698a34ead18530c4c9467a020b3030a0e7cbe375b9483dea1a2e9"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_shot_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1fdd97145c5a8df1a8afd8187147fb2796e7937ccaeea071ef81ea6445fe3c99"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_monthly_credits_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "d885efc67fc2fcdfff00bd9cdd55d42c684873fd2cdb0d6816483745878b2419"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_monthly_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "745c995ac1b3284cbb215733990820c7eaaa6933e3e30a6c8766e716dc8546a7"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "44756d887704fc88d8d0adc5c0c431103c555b4f8e6a4ddef6f7a7f6b4110606"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_purchased_credits_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "0f1c2e0f1393a2a8e12b8c94733dacce091a4d2e5e6af113b5c41a1bc4b01607"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_purchased_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "89ed5a543d274ae1a9758cf413b65849180fae9496d6f82de387d741f70e2048"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_amount_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "744cd3d0489a1d42538eeccd28066540d9f5e20a54b09615914dbc0b11c1ebaf"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_amount_sign_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "d1f459f1ac29c5bfa349617921dca6dcbe832c9fc67b59434ce9417fbe010e4a"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_bucket_delta_pair_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "c7379bce9eb10ccf1d4f0ce46a2b87bad5134a93afd279d1141273d7e2160b5e"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_monthly_after_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "8af9f4bbcdacdb18fbaa3a26588039412240d3e405e2f0893a89489903abb743"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_monthly_after_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e101e9d6eeea2824933178ef00f9f2444575af10c1d2afabc0bd0e01a0cce915"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c0d2d180942757cb8561f78063eb9de21e80198593c79dfd1244100f0f460843"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_purchased_after_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "2faa17978d6bb99e45039b0f7d031eb66c15e4846d428161092531eef856792d"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_purchased_after_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "0881daaa434bca3babf891822af1d302decd6f3a7d166188bfd8c53c0965d931"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_scope_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "10d58b7bf62b40175937eb56d2e2c945e55111cc5d30f58f50a1b0ae2ebf4f32"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_type_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "f114bbe7a9a802eeeda75fddffa4ae40b125f9efff23731e41ffa1697c0671a6"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "a6f5184d947950ff46e8990b714cfde1d302953b9db07729723c5555d52ea01d"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "35bba6df01802e7850bd1a753b95ff643a2a01ec56aa476981cbe9dc42705cf3"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_invitation_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "4840580d7ccf77df70d6716e2de2b324ccd271a143742c525e82f336d121e14d"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c0d2d180942757cb8561f78063eb9de21e80198593c79dfd1244100f0f460843"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_provider_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "91d7c22e18bf07c69e1a867d6ca28599116c2ecd41d6c86dcc8528c0e592bcee"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_provider_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1501ac962b50546ee355afb75ab6b4b2b31067cf477093c6f3b8a7d89ec4d5f6"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_recipient_email_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "bb1e2584f4dc7a3a5f5dd5d16fec4ff550385bbc29b5e470473942958c3c6eef"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_recipient_email_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "9a6d9806f60dd6fc36559522f65fca612eb483e0661087890fc6cfde51fd1b49"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "49434179e681fe659597c12f6b6bddeda7490dcc72533ef85c1c483e5566ccfc"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_template_key_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "f306ca39c657ef0d427c642f0d5eead47a6c5e3a6ab9938b3a2a7a86d47884f4"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_template_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f4b318f454eac1550c1d2aaa98c29706a1fe00d2c71664886d64aed39c4bb604"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "entities",
      "name": "entities_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "entities",
      "name": "entities_entity_type_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "612a44562b2f270753c45e18b9ca5e7f411330bb22fcc391763afcdebb37158e"
    },
    {
      "relation": "entities",
      "name": "entities_entity_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "c0661db5e2f2521532a264231325173cd6b77a4424ed09f2dad4457ad79d34ea"
    },
    {
      "relation": "entities",
      "name": "entities_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "entities",
      "name": "entities_name_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2de18fe30b89709c9ff79c7f93fabe08ce27ba81484cce0371766fa6549377a4"
    },
    {
      "relation": "entities",
      "name": "entities_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "entities",
      "name": "entities_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "bdb5f5db7b28ae16bbca2221ca38c299df0c9a5281c7d4b2432ff6a7bfbb65c5"
    },
    {
      "relation": "entities",
      "name": "entities_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "entities",
      "name": "entities_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "entities",
      "name": "entities_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "35bba6df01802e7850bd1a753b95ff643a2a01ec56aa476981cbe9dc42705cf3"
    },
    {
      "relation": "entities",
      "name": "entities_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "entities",
      "name": "entities_work_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "bab4f4dfe4ecf249f316e2aa690b4acf99306de1a6301f7bf057192afd29f445"
    },
    {
      "relation": "entities",
      "name": "entities_work_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "63e6d529ddeccdab60d7097269a9b70357913b4b61fec9709126c03e8ad4f801"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_entity_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "d5fc59754b8a1b7dc99205899a55248985d973e182c3ac6114fdd120b9678702"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_expires_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "329142b25e122eb9bffaebec0ddb2fa7d97b2fd540f53264567c6bf9a1c10526"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_expiry_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "d954a0a91623efbd20c6652f5a3a774a3c1e6e5f517d248db867ee5ae1e3c3cf"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_hash_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "6418938fa71791bf48fb69cc910ad5a060b566911fa51d13f9c91459ad890943"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_mime_type_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "31bd2261c8c6414afbf996d190aae2bd78e50f8500099a0efe843a6de3c86bdb"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_mime_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "973c3873d5bb49faf2949261b6fc95caa7d0e80a1c58dc01e40ce8e1bb5675fe"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "9a88181960ceedd5237067694f62582050c8c8c703e49d32fb67bf416273decb"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_purpose_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "cce3c7fc4247a77c29a076a06cf874017064602b4b6dbce6381fb364e74bba7e"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_purpose_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "9afb8812f20e282633f716f9662ab64a83f95ab15dfdf69e26052d67a1528b5b"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_s3_key_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "71a4f2527129767e55f6fee214d2234b2f6669a866bfb50aa3d4198a539787cc"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_s3_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "974915faff4aa8106e1f6bf9ae24dd67d3e7f5247bc5cfd0f5536f846085e065"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_size_bytes_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b8925ab5ebeea3ffad50d9f7ea12cf2470911cb657b415b394488b762cb1a3d1"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_size_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "6ed82a482d41c72b87ab19e43dfc12d10d3e0cabf9de3a9114d9fd3c2a8e1d27"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_tmp_key_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "a7f042cac100346f2cb9570fd80ab0b9d1ddf18fccf6b9a0cc2abd0f48e6726e"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_token_hash_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "928f8d2df4232819f067434231351fd4c8582dad25e2cc52b69de9ffa747890c"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_token_hash_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "40a276cf83adfca12a75fd129a63acafa8cde0a297d146fcae8da6e96a936243"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "entity_states",
      "name": "entity_states_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "entity_states",
      "name": "entity_states_entity_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "d5fc59754b8a1b7dc99205899a55248985d973e182c3ac6114fdd120b9678702"
    },
    {
      "relation": "entity_states",
      "name": "entity_states_entity_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "365a8c4bfd4a4fac9c98e69f300eb839c4e8835db20f8005eabfb0c3151d0c69"
    },
    {
      "relation": "entity_states",
      "name": "entity_states_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "entity_states",
      "name": "entity_states_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "entity_states",
      "name": "entity_states_scene_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "45817a54a0a021ee6dcbd50f9138843e0605f2997ccc3bd45f68275036f8aed1"
    },
    {
      "relation": "episodes",
      "name": "episodes_chapter_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "f7bac2a17dfaf23325ab2fdfa126fdd0eac98550039660e7c2e7c8ff9f7b5f92"
    },
    {
      "relation": "episodes",
      "name": "episodes_chapter_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1e58501610795da4e78d0c5b8f2d7093417bdf07c8f2e651e66fec3c24962d2c"
    },
    {
      "relation": "episodes",
      "name": "episodes_chapter_id_order_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "f7dbe66d8068eed1997ece422ff0a614d5fd511ee0e38187391aaa2f3e0dc874"
    },
    {
      "relation": "episodes",
      "name": "episodes_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "episodes",
      "name": "episodes_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "episodes",
      "name": "episodes_order_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b938cce79fadcd5b71a501eb3ddd0e1e97792e4a40fec8052a1e8351f7d115f7"
    },
    {
      "relation": "episodes",
      "name": "episodes_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "episodes",
      "name": "episodes_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9c92339bf5b4c254e77e15e9e9c524f6be5c256e979d44f7d09037a675565ad0"
    },
    {
      "relation": "episodes",
      "name": "episodes_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "episodes",
      "name": "episodes_story_input_mode_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9120f87e32e26425dc54ff341861fa7522a86f9b3c39d6db83d8851aa8a74588"
    },
    {
      "relation": "episodes",
      "name": "episodes_story_input_mode_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "42da9ce37769655685fc972d150819ac2bcfba9da518d0b4bb990951bebbc376"
    },
    {
      "relation": "episodes",
      "name": "episodes_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "episodes",
      "name": "episodes_version_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "736415a195f08a4248373da5ce66ccf827e081def78b0d8b4c203dbc5c2a3be2"
    },
    {
      "relation": "export_job_outbox",
      "name": "export_job_outbox_attempts_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "b17f9785cfe75114380238cc6a6da4566df7392fa6231d69b98dfb4cdc72bb0f"
    },
    {
      "relation": "export_job_outbox",
      "name": "export_job_outbox_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "export_job_outbox",
      "name": "export_job_outbox_dispatch_attempts_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b5eebdd8b46cd2baa8aaa1bccc8084d2cf29732a198a9db8c3c656da993d6d33"
    },
    {
      "relation": "export_job_outbox",
      "name": "export_job_outbox_export_job_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "3547bdaac12f2fca19d6fe89ac3365bca64998ce356436622594fe134bf8cee5"
    },
    {
      "relation": "export_job_outbox",
      "name": "export_job_outbox_export_job_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fd7ec5c0771e7feda2f3aac959c30d0a4d2435470fbdc84f023bff8dfb91b1a0"
    },
    {
      "relation": "export_job_outbox",
      "name": "export_job_outbox_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "0b7a7a88af73afd8d2613da0e394b596071d5160e55ccdba10c82b2b81447124"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_artifact_size_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "a57dc5bab4c0ad31e8906d4c22e355ac15d401d62e1acb129dc28a0ff4976dd3"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_completed_artifact_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "76986200a779a9b557f4613cc41c2f8c5c879ec812be1338bccd895adcbf7b3c"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_episode_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "e021534f54d393e2ce46160e663cde1514e1f5d211520adc4b52ebb7620d3e7c"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_episode_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "64e02164410581cd2752d6edf9baeed4531c6362078c04d88ffa94292e3cce4a"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_expires_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "329142b25e122eb9bffaebec0ddb2fa7d97b2fd540f53264567c6bf9a1c10526"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_expiry_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "d954a0a91623efbd20c6652f5a3a774a3c1e6e5f517d248db867ee5ae1e3c3cf"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_filename_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "05f3bbe48d5f210e8e69fa7fda8ea4245a822b19b5c631c1f1c2ae099b63ddac"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_filename_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e48e51bf55af3c9f6a43901412ae55dbd4d54434bb116bdc05c5768c893d0e92"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_format_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "26126a51ccb07c245857a438cc8847cb7680d2ff5af765f2618c597eac341a5a"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_format_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "a2ef50520b2e85602941fe3ce4260967e11e3c5c534f518b5bac868bdebf8668"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_idempotency_key_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "4f65fb663f8b0b72d6efe585feb668c082fc329ca5e8e2ebbb07204c5dab6bc5"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_idempotency_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "53e75a382ba3fd6c80cbdc54ccb3af7788e30cad564c87f01b014cdfd647ddbd"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "9a88181960ceedd5237067694f62582050c8c8c703e49d32fb67bf416273decb"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_page_ids_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "74b9b32c86e3d5cd6c1b970a66d87ce243577a12a5ac33ad4207a07e7f2b40a3"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_page_ids_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "332363f4b25e1a24b35df43d25d8f4f47fe62c1c37677e122658495d969f8154"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_page_snapshot_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "9eebacce4c2e044dcda7bf7502e5f06b9cc8d036525d13708eb864862cb4fb0b"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_progress_percent_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "24cb8c332ee3b4f9ab8aa4a179e1dd20fc266faca7e031c767336cace91f6c93"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_progress_percent_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b8a231b1b6fc90c5762beac1df2097bddfa549846a0708c44c7a6db60a127622"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_progress_stage_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "d544dca4fc849d3c998a9a33d414ce4b20a407321df786da16f178a9460a0ebf"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_request_fingerprint_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "cb0eef9b4c2e929fa447de04597281de7d4a255a62191f001e60867649d601dd"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "f1a24c781995032040c440a2ec385bdc1daf97bedfb7f6964017e53401173b0d"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "generation_job_history_hides",
      "name": "generation_job_history_hides_generation_job_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "49e1cbe6abd5686f5c2ac4ec4067f0f6610320c69759f736fdbfb4762a46255b"
    },
    {
      "relation": "generation_job_history_hides",
      "name": "generation_job_history_hides_generation_job_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "03ebdb32fe4edd4b6b6cd8daf77363cfc9de46245dfd1025e90fec4e09514e5a"
    },
    {
      "relation": "generation_job_history_hides",
      "name": "generation_job_history_hides_hidden_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "71f9c0cc3f9b0ba59f6de2ffddafe8ad866d1f4c271802e70129c5cfecb29fa1"
    },
    {
      "relation": "generation_job_history_hides",
      "name": "generation_job_history_hides_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "91db7611906c30e4e721e426dada627984acccf27d01e5849d852c1cc882fbbc"
    },
    {
      "relation": "generation_job_history_hides",
      "name": "generation_job_history_hides_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "generation_job_history_hides",
      "name": "generation_job_history_hides_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_cancel_request_metadata_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "4b94388e8c169d214b53468e221efface3e4cb4e53cf05d000e751264bfb9128"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_cancel_requested_by_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "50dc5a1847162f2e1ceeebdb860e87141b87c43aee82aebb85402808df18864b"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_credit_cost_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "6008a3d5453c6d64900005f903ba6f4187a723c397c2d8952d5d7953e2a29db7"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_credit_cost_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f185e57282d88265c1dd4a41bd1961ddd0e74a1a5c3914babf380ce4b6467acb"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_generation_mode_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "d52b26458eba81c29d417e8eaa77c9308781039f3ea8596098754c8afddcbfb3"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_job_type_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "b1f0401eb8172a75459dac7fcc1d1b1a68bf9c68548278bcd879a680362713b3"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_job_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ff7614da46983d71e1ec877a5d7d9bec4fe60071a82f02d9b69c7edeb0b9e21d"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c0d2d180942757cb8561f78063eb9de21e80198593c79dfd1244100f0f460843"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_params_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "88fedd790f2f38506f6bc89d3932563d4d934ee509717d3d8e8b5131ccd8495e"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_retry_count_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "c695e280e496d34e48071d61680678280acdea0c26b26b1fab9d72e92c44584e"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "2f61d9914cb9e98f0a14d31435d8ef48d61b8d7283972487bbfbcfd36b0bc613"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "35bba6df01802e7850bd1a753b95ff643a2a01ec56aa476981cbe9dc42705cf3"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_attempt_count_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "189ec2932074e91bd1a50fea372d058602d0f10422f1d894f41463017df01a4e"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_attempt_count_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f16c3276b8155d8167632a8ffd1c6d8205edf5a8ce51fba561f4b6aaf53c2fbb"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_available_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2062e3c9bb60899d5d530a139da6f769d8138912d6da2c24623f40ebbcef35f1"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_error_code_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "3b3b6310e4da905c11532c7eb8c2522fc50d54fa3c644f1465cfa611c10ee426"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_outbox_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "f9dff104794e6b765cc076a05f7a8ed1debcf220c543b7a2f677d53800aa8cba"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_outbox_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "7062dc1b3362282088d312a4f7cc2419031ec8fdf09df1bf6e4cfdf396c2bcac"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_outbox_id_push_token_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "71cb357a846de06ba75e25d640e18d2afd67548599bd1505514e08a427ad41f1"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_push_token_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "2c38864503247667bf0c3556c3d4ecaf6eb68da087d6a52c212204815d2a22d9"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "22d126e1e60d9934b8cba31126d39d0a28f61ef431c5557038b2cf28f662466f"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_generation_job_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "49e1cbe6abd5686f5c2ac4ec4067f0f6610320c69759f736fdbfb4762a46255b"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_generation_job_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "d0acf0a1d15a06276f708546d96b53a8b5e8234181594e09aaa5874ff505b17d"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_generation_job_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "03ebdb32fe4edd4b6b6cd8daf77363cfc9de46245dfd1025e90fec4e09514e5a"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_terminal_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "7b70f41509cca875045cb0ddb3be2113d8069c0da0e45c22bc43fd37110a81fe"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_terminal_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "c74b335ded042135f8b049e477c0a61854d5ac1c5e141691c966a51498d6b1a9"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_ciphertext_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "3ae168f3b7dde17e14cb5cfcd8495c56195bf7213bb93012cc45914ec4e10912"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_encryption_key_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2bfe049606dce2e12eec5784cf548e42697c5692db157986bc9718b97b91b8f4"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_installation_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "be0bfa27dec54e42651c2a101cfad2d41becadda9556be5dd07c4b13ea6a9657"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_key_id_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "ccad46c4794a6d77f98ad68b32887409871b8d63a81e5194d77d7c5ff005ff4c"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_locale_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "2fe3617f5db53bc447845bc05b13e9193530f8b4969bd0ff05ea920e37cdbe75"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_locale_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6761252d7832de424933395399ea59c6e1d8ae379202be0df24d62fe98c26858"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_platform_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "f437e0ae56e3199eb8323b793fb8229290fb0068d7d13249073b463f0e12b86e"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_platform_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b1989dc6e1fddfbed9ee7760e0ec81a7520bff0be1ffc202661cb7e5d6cb6e7c"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_token_ciphertext_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ac9d10ae85471f27203e4d72b2389bf9eb6e79a288f19540c5a206207725aaf0"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_token_hash_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "928f8d2df4232819f067434231351fd4c8582dad25e2cc52b69de9ffa747890c"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_token_hash_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9b07968c2637ddbaa3344c311ad564e9678dfbe3afc9668d108f0c5a44ccfa33"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_token_hash_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "40a276cf83adfca12a75fd129a63acafa8cde0a297d146fcae8da6e96a936243"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_user_id_installation_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "5a42badaa0e9644af9ff3700e1a59df06ef734b658f9691f4e41d8b4dc89b30b"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_event_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2a1e20a2d4bde91a9e12be7d54d28e92c89b578a25fddf2fb6d0fd8601753641"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_metadata_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "4771358cdab745ff66775c758b856a001d005b60277d8815851e7ebe85b6c150"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_occurred_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "95027c5dbdb9df59b94aebfb227d22fef232ccf8700b003697b890ac36a73f57"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_operation_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "cbf4eb512a0c7946fb1b6d44857386575046cb19fcd3728db3c4669e8eeb34d8"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_operation_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6c8870b65cd9f5c67aa31916e091c4be15d2f8709757ded77e541ec20850352e"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_provider_event_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "633a96be67ca9f4c7c865fe93446e2686d5b0688356e71facaa107142b668886"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_purchase_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "3f7184cd9c9844531a934f264887768ab92a8a938e26e2a6094e9162c910d07c"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_state_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "b44c576807b0278f9cb79838822fe485350df52bf5db2053ca1e40a9d731e298"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_state_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "087f2291aec917662587fb55465b09400ba4647aa6e357ab1995522613c3722b"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_store_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "922f5224b9260bca3abe5ad6a0ec50c7deca04167e5e84efdfb5c806da0bb9be"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_store_event_key_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "6621655160664f1fb0db13131c3ac30337ff59ac0086ed5a26afa8a9459f24d1"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_store_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "64cda10fa5662077257064fbaaf97965527c8e1914a00f826f04ad9b1cca628f"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_store_transaction_key_operatio_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "410f7970c6d69f8daf6d80c453a8a5359d97fefab05fab87d8b70895e8fe5087"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "e36ad502ea3e8280c1901528f59a8aca6df1ee632fcfebd8d3c07410589e5b02"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_check1",
      "type": "c",
      "validated": true,
      "definitionSha256": "5b2773ae637dfdcf21d06f22e23411b6f8bfdc2f23e69edd87949c006a6b2972"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_environment_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "6ed098900a437dbfc19d305ce7404a604681ad2947403112a3dd719085d988c3"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_environment_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "7ece77d00fb6c23e00eb3df2dc90373d0195b137c1955b60e4dd78d9b2cc69c2"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_external_purchase_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "171b251ab5aefe87827d5ae1b6f635e1f4cda1a1ec8bc40b082162f7b0651509"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_granted_credits_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "8f1cede584bb9e8897d597a33edf83d44b5b886300485604a2f2280408cd35b8"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_granted_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ed6384c4d96f63969052561f1cb2f46884119be597688e07bf9d2164c63dcef8"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_kind_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "655136cef8540acbbddbfebcc8de87085c5dabe6820ff2bd82c446bed29017e4"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_kind_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fad9a10b91a3fbeafe30a0577b442553c1986b3244368a78ac1323ce02015690"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_last_observed_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "a35010a3f992500f72679d262d8136082bbf92744ffd0602792e12a119c2de10"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_product_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "be0158f4d1866610d1699b23e3b111839b0116e535080960c0736bc7c4a89a94"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_reversed_credits_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "5f782f38c1e95c331eccaf06806b599e8f5e7648835f540d58f3974417ae8e74"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_reversed_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "28c59b87a61e3f31f876c604400c1a012974f5267cddacc42f130d0fbf5d141f"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_scheduled_plan_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "b01e3cfe9f8cf0ed7a2e5eaad051b35783c2b8ab0b2a9140e161344cc9c2640d"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_state_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "b44c576807b0278f9cb79838822fe485350df52bf5db2053ca1e40a9d731e298"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_state_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "087f2291aec917662587fb55465b09400ba4647aa6e357ab1995522613c3722b"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_store_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "922f5224b9260bca3abe5ad6a0ec50c7deca04167e5e84efdfb5c806da0bb9be"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_store_external_purchase_key_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "a3ec4c470910e768920001d645b2b15702cce22084a5746ff26bfd0e1a389f99"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_store_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "64cda10fa5662077257064fbaaf97965527c8e1914a00f826f04ad9b1cca628f"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_action_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "663c3df4bc7c1e563df9b743743198af29fa0846137a1a1aafd9fd76a14ca85a"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_action_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b8e99fafefea6ffae702c62443d31b63116fa3ac64169f7bd6e4e99f8b96133d"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_actor_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "a7f2908e4248181bb301059f70912590f556a2a3ea096783cc307c3dbab7b1e0"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_metadata_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "4771358cdab745ff66775c758b856a001d005b60277d8815851e7ebe85b6c150"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "9a88181960ceedd5237067694f62582050c8c8c703e49d32fb67bf416273decb"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_organization_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "31691fd729c9f8187a85c53a9996903057f97d647d15b576accf02d37fb18db3"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_target_type_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "46e84d1e4f1773cdd96722087e0fecf135a409c02d9ddef4b4fed7a105f77f21"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_target_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "c878d1d74d312d56bac1e6e017b6cb2cdd08ffbada409fd55603b93673e5615c"
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_credit_balances_monthly_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "745c995ac1b3284cbb215733990820c7eaaa6933e3e30a6c8766e716dc8546a7"
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_credit_balances_nonnegative_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9766124263ca8572ba5319d17af7a1a6df1f3aad60b9ae749cfc60f9d02d89ad"
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_credit_balances_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "9a88181960ceedd5237067694f62582050c8c8c703e49d32fb67bf416273decb"
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_credit_balances_organization_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "31691fd729c9f8187a85c53a9996903057f97d647d15b576accf02d37fb18db3"
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_credit_balances_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "b56cabea1aae3f504ebde09570a40229dec5618bcd10de570b28734a260d84c4"
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_credit_balances_purchased_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "89ed5a543d274ae1a9758cf413b65849180fae9496d6f82de387d741f70e2048"
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_credit_balances_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_accepted_by_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "b8e9e5cbf9bbf7878600fae39c50e76e436cbf1050ee1f958a62c31f6f269d1a"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_email_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "82c807d7dd7a12102cfc6822c31cff674b706693b5eb87b62663d85507de2dcf"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_email_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "cfd44c66f5260638ba3129908bc5db3337488a548feab81611478fc0c586b9fa"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_expires_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "329142b25e122eb9bffaebec0ddb2fa7d97b2fd540f53264567c6bf9a1c10526"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_invited_by_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "662de4c61e406eb6d91cb257e0373cad5f58ea4c7650147892928579d7d5a451"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_invited_by_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "68dbd6e4e0f8cd0ab600e507f0c888b1643d6a7c1d51e227a14421a2738c275b"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "9a88181960ceedd5237067694f62582050c8c8c703e49d32fb67bf416273decb"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_organization_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "31691fd729c9f8187a85c53a9996903057f97d647d15b576accf02d37fb18db3"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_resend_count_nonnegative_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "50b1cd792baf095770cd9d2e82dd3894562cf61b88780addc2bdad073daec5a2"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_resend_count_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1e6228f79dd163e239c6795895a2759d0116896e487911320e3e81190169c7f8"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_revoked_by_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "42a1a4f999e02643666fb6360f2f5c1314790332620488789287571ab46968f3"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_role_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9f94f34a584b065ed9b896f047b51ffd0e7b0f6de2d8288feecd26f5448c6773"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_role_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f5dd5e5d89d953e01e5c994b000b122c448a771a6cfa92c44dc91e4c38771cb6"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_send_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "fd94e81b7c52a58c03caa89fb8dab16ff0b8eafe6c87589a32fc3a8d36f78ea7"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_send_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "3c9b4b922cad7de101843f6ae8ecafcc65031ee4c8c6b3607c4e1e9e73aef037"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "ec0d5916dec86764b39e27e30548abda90208909582c26f25b72876f0ceb6244"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_token_hash_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "928f8d2df4232819f067434231351fd4c8582dad25e2cc52b69de9ffa747890c"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_token_hash_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "40a276cf83adfca12a75fd129a63acafa8cde0a297d146fcae8da6e96a936243"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_invited_by_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "3b85b66c46e0140de1bf70e03983a9689bc8d64c9fe8424b81403f320f16a7b4"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "9a88181960ceedd5237067694f62582050c8c8c703e49d32fb67bf416273decb"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_organization_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "31691fd729c9f8187a85c53a9996903057f97d647d15b576accf02d37fb18db3"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_organization_id_user_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "012f761daabb93bc53e6edac1d3a36ba90128c738314d8ee98bc5dbababfd0f8"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_role_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9f94f34a584b065ed9b896f047b51ffd0e7b0f6de2d8288feecd26f5448c6773"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_role_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f5dd5e5d89d953e01e5c994b000b122c448a771a6cfa92c44dc91e4c38771cb6"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "35f966bfee67097f0c56282c2ceefffad149b271510759d09352b095838c4cfb"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_credit_amount_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ca5e6ca4810fa1d17f3ebecab10c6bc13436e06a9ba2ab2291e70cb084ab5bb6"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_credit_nonnegative_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "99ba3dce4cd52362b981d3d273adf89d34ff8bb6fa8f0eae867dd319d561a912"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_event_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "73e5d6b3bc3ae11adb2611a869136ec76456d8c8082965702d45b39c3b3bf6f8"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_generation_job_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "2b532a868df592534248ad39b0d7cae5907a8e7dc8adfa15017f73e3055e9aef"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_metadata_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "4771358cdab745ff66775c758b856a001d005b60277d8815851e7ebe85b6c150"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "9a88181960ceedd5237067694f62582050c8c8c703e49d32fb67bf416273decb"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_organization_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "31691fd729c9f8187a85c53a9996903057f97d647d15b576accf02d37fb18db3"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_type_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "197552050c0ecbb64dcb24cee70af013a73c47c2421407c5e7ca4d4b4ced8757"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "8ebf15b0f574e6eb387627b7b676ac919ead3900f82636c92f4660c52f0d9e82"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_work_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "5f46eb941c40d194f1fec368bceb7536a338e65c50fabc168da6d4c5f95a0430"
    },
    {
      "relation": "organizations",
      "name": "organizations_billing_email_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "6f82859cbe8e4405ba736871e343669b95820ed7763ca51b6faa5e12b0a2e3f3"
    },
    {
      "relation": "organizations",
      "name": "organizations_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "organizations",
      "name": "organizations_created_by_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "e1f932304aa5ebcc2dfbc76c8208da376823ee231499d5bc4027569b1a739451"
    },
    {
      "relation": "organizations",
      "name": "organizations_created_by_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "a453b437290d985c2777046495810ae2071f76bac6372b620f52f3045e83bc94"
    },
    {
      "relation": "organizations",
      "name": "organizations_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "organizations",
      "name": "organizations_legal_name_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "14af33d920f0af5e12e94500bb4eb023e093779dc44af8992256ceac04998e6f"
    },
    {
      "relation": "organizations",
      "name": "organizations_name_length_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "2402f0f8f852d0351e65c0a2eed234bef98fb2fbf94b9cc5fd4d4889bb7c6b84"
    },
    {
      "relation": "organizations",
      "name": "organizations_name_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2de18fe30b89709c9ff79c7f93fabe08ce27ba81484cce0371766fa6549377a4"
    },
    {
      "relation": "organizations",
      "name": "organizations_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "organizations",
      "name": "organizations_plan_key_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "701ef090be80cfe18271a306eeef1e231c54bfff1672055a4da4dc835a929310"
    },
    {
      "relation": "organizations",
      "name": "organizations_plan_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "5f521b4af6adce1aa00f5bc2d6ff76eb9816bc59bf322db0a03577e202d152c3"
    },
    {
      "relation": "organizations",
      "name": "organizations_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "ec39bb0c7f5a6324c8ca09dc4b3165b8f18acd2b745ba58e80d20b2c4cc0b68b"
    },
    {
      "relation": "organizations",
      "name": "organizations_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "organizations",
      "name": "organizations_stripe_customer_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "8087d6799612952a9d418d216fb8eeeef134c0cf3b7129985f12485d48c62736"
    },
    {
      "relation": "organizations",
      "name": "organizations_stripe_subscription_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "39ef9651b03d005e3330140046439018e677f72abb05af6cac739d178a5a4164"
    },
    {
      "relation": "organizations",
      "name": "organizations_type_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "0dd842c4ee169f530424da2b1e6b74ebeb1bc306a0b253e127050d0e2a8577b9"
    },
    {
      "relation": "organizations",
      "name": "organizations_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "a6f5184d947950ff46e8990b714cfde1d302953b9db07729723c5555d52ea01d"
    },
    {
      "relation": "organizations",
      "name": "organizations_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "pages",
      "name": "pages_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "pages",
      "name": "pages_dialogue_mode_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "261b1a10872f4de197cb36bd14fbea5d2792c888630dc899210331d50de43fe6"
    },
    {
      "relation": "pages",
      "name": "pages_dialogue_mode_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f7438885ec82f990682094644bda40ee0521ccf5e753efad03a0932f2b5ac0d9"
    },
    {
      "relation": "pages",
      "name": "pages_episode_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "e021534f54d393e2ce46160e663cde1514e1f5d211520adc4b52ebb7620d3e7c"
    },
    {
      "relation": "pages",
      "name": "pages_episode_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "64e02164410581cd2752d6edf9baeed4531c6362078c04d88ffa94292e3cce4a"
    },
    {
      "relation": "pages",
      "name": "pages_episode_id_page_number_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "819cbc27cbdc1d9fe57854985c639bfa355efe47003c4c0c30d00d927f0bf7e9"
    },
    {
      "relation": "pages",
      "name": "pages_generation_mode_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "d52b26458eba81c29d417e8eaa77c9308781039f3ea8596098754c8afddcbfb3"
    },
    {
      "relation": "pages",
      "name": "pages_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "pages",
      "name": "pages_layout_config_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ba4ebcc312b1c6b2dab92c1eb766726f8ed3822a8dc27762fd89d4cd6fd0ddc4"
    },
    {
      "relation": "pages",
      "name": "pages_page_dialogue_toggle_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "65ab4cf73043b65dc2318cbf76620064aec4e0bf1821198932c990786f6018d4"
    },
    {
      "relation": "pages",
      "name": "pages_page_number_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "dadafe7a849a4cea9447bdc4e8e091eedd26e4da51b2b36998f67e1d34cf7fb9"
    },
    {
      "relation": "pages",
      "name": "pages_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "pages",
      "name": "pages_scene_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "aa686e47bb031ef893ccafe68d47633809fa073b150d6ee92cd4af1435f4e393"
    },
    {
      "relation": "pages",
      "name": "pages_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "036e812a2e191e728ed7753e6455ef4caac60002e6ddae506d986f96541ee923"
    },
    {
      "relation": "pages",
      "name": "pages_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "pages",
      "name": "pages_story_source_scene_ids_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f8ee0f4943a17a7ac9ae192d4976357d2ce67a314ea9900d68efd9ec0ceab6f8"
    },
    {
      "relation": "pages",
      "name": "pages_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_border_style_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "373b91a3b50d4ec7f1698668d54c154d2e3a36d32e064026d6a668d17448e15e"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_page_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "e0a662c6e736eb18e0b68dc781b2cf2b14596a83f6a3e3bc2d5703edda31f819"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_page_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1488d1384b9b9048291c2f1c3b255c969cda56de7dc7543c2c8d03c1e16c99b9"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_panel_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "4ca7d4a78c78094866f681fced1d74f59ef54fe7aae3210dd756a0efeabe3cf5"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_reading_order_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "917bb3831b237bae0868db81ab1289a72a6f894daf7d1abc6a800328908f57fc"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_vertices_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f8049f8ba571d5d84d87fa9d96577685c7cda21556e2bc2df60f0ac53c2447dc"
    },
    {
      "relation": "panels",
      "name": "panels_composition_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b0e9be703150c9050831e8dc091716ad6d9fdf9c4b1cd51fa3e6ed22feace8d5"
    },
    {
      "relation": "panels",
      "name": "panels_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "panels",
      "name": "panels_dialogue_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "24a2aff3b4b2cedeffa9d129b9c90ae70b8d5e473f43f04534e70f38f6048a00"
    },
    {
      "relation": "panels",
      "name": "panels_entities_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e8a795229cd692ef0864da2e1aeab48923416104a7c0139e8f98b3e95ba146f3"
    },
    {
      "relation": "panels",
      "name": "panels_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "panels",
      "name": "panels_order_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b938cce79fadcd5b71a501eb3ddd0e1e97792e4a40fec8052a1e8351f7d115f7"
    },
    {
      "relation": "panels",
      "name": "panels_page_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "e0a662c6e736eb18e0b68dc781b2cf2b14596a83f6a3e3bc2d5703edda31f819"
    },
    {
      "relation": "panels",
      "name": "panels_page_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1488d1384b9b9048291c2f1c3b255c969cda56de7dc7543c2c8d03c1e16c99b9"
    },
    {
      "relation": "panels",
      "name": "panels_page_id_order_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "f1a87efd034c8d68145f59fca75426a2e8c29cd988102c5e5706da5d8bbe1c18"
    },
    {
      "relation": "panels",
      "name": "panels_panel_role_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "ede9a585a6fabad705c3a329e3987826bb73a34cdcd8f7e64b9a56f13f5ca9e7"
    },
    {
      "relation": "panels",
      "name": "panels_panel_size_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "4c92c2efb66a7ddd188fa63660301eab56a7a15cfa8cccfe3763fbed0fae9546"
    },
    {
      "relation": "panels",
      "name": "panels_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "panels",
      "name": "panels_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_amount_jpy_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "82c4d8dd8622c384042b22f13e943fdd997c90abdefe9f8f8d817efe5ab24cbb"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_amount_jpy_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e329c9f3003e115a097d48ace1fe070433e9d42289fa846e0f2fedf3d8588150"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_exactly_one_external_id_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "4e8e7612e38be13bb0e33ea9b86530eb9173293aedd76e119eb070e1cca7428f"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_kind_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "aaa8bd6c03f817d6cefe2ceb8da8edec92b8ec39b261a70c7809ee61e5d288c7"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_kind_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fad9a10b91a3fbeafe30a0577b442553c1986b3244368a78ac1323ce02015690"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c0d2d180942757cb8561f78063eb9de21e80198593c79dfd1244100f0f460843"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_scope_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "10d58b7bf62b40175937eb56d2e2c945e55111cc5d30f58f50a1b0ae2ebf4f32"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "b7646e582cf1fd93cdbbd74a320dbed69d4c177060ab2ccf91de496c263766f0"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "35bba6df01802e7850bd1a753b95ff643a2a01ec56aa476981cbe9dc42705cf3"
    },
    {
      "relation": "processed_stripe_events",
      "name": "processed_stripe_events_event_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "73e5d6b3bc3ae11adb2611a869136ec76456d8c8082965702d45b39c3b3bf6f8"
    },
    {
      "relation": "processed_stripe_events",
      "name": "processed_stripe_events_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "760bd0fa45964e1abb26e8c541fe9152ca89c620165093a051bab0c46e88c260"
    },
    {
      "relation": "processed_stripe_events",
      "name": "processed_stripe_events_processed_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "8959abe3339455fd07234cffde43f54bd2c03b87cbca8c44904af1eac92de0f4"
    },
    {
      "relation": "processed_stripe_events",
      "name": "processed_stripe_events_stripe_event_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "c20107822a5a953b594c06f0af6d95cc0623553e1dc5d8559d07d93e2fc71d1d"
    },
    {
      "relation": "rate_limit_buckets",
      "name": "rate_limit_buckets_bucket_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "9b2a8eb0f60032669a374a62a03bfefd66e15a78261081b97ae3cd4dfba5e30e"
    },
    {
      "relation": "rate_limit_buckets",
      "name": "rate_limit_buckets_count_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9da0985479f488c53cfc8ebee68bc21fcd4e266e9538e3016e43499a8e175f9d"
    },
    {
      "relation": "rate_limit_buckets",
      "name": "rate_limit_buckets_count_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e9455c1e6a7b56d97f3162ab19080126f813663de335659c9b129252a93354d8"
    },
    {
      "relation": "rate_limit_buckets",
      "name": "rate_limit_buckets_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "df746f9d198b6587416ee6da1f20d01a18667b9cab93cdb68720e40522108fcf"
    },
    {
      "relation": "rate_limit_buckets",
      "name": "rate_limit_buckets_reset_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ea308557ce779d5898c3f9df883c31393c8eb75d7a3262de1c6d7709e5afd8bb"
    },
    {
      "relation": "rate_limit_buckets",
      "name": "rate_limit_buckets_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_entity_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "d5fc59754b8a1b7dc99205899a55248985d973e182c3ac6114fdd120b9678702"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_entity_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "7fd534b7bc9cba4c8bcc807d95eeb421da84e88b1f686609bee833780a606ce2"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_entity_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "365a8c4bfd4a4fac9c98e69f300eb839c4e8835db20f8005eabfb0c3151d0c69"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_reference_images_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "25f0f061d4279614ddc2c052490f9e8799b3e1469bb4311ce10ac10b3fa099a8"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "e7bd0ef0ba3bad96af07f968fe5ed628b97062f0a1a37cb5caafaa614ebd5181"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "scenes",
      "name": "scenes_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "scenes",
      "name": "scenes_episode_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "e021534f54d393e2ce46160e663cde1514e1f5d211520adc4b52ebb7620d3e7c"
    },
    {
      "relation": "scenes",
      "name": "scenes_episode_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "64e02164410581cd2752d6edf9baeed4531c6362078c04d88ffa94292e3cce4a"
    },
    {
      "relation": "scenes",
      "name": "scenes_episode_id_order_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "3ca846f0a76d63a475ca2e8fa4dd0798bfcb8bbd0bff4437d60eec9d3c58a673"
    },
    {
      "relation": "scenes",
      "name": "scenes_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "scenes",
      "name": "scenes_order_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b938cce79fadcd5b71a501eb3ddd0e1e97792e4a40fec8052a1e8351f7d115f7"
    },
    {
      "relation": "scenes",
      "name": "scenes_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "scenes",
      "name": "scenes_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9c92339bf5b4c254e77e15e9e9c524f6be5c256e979d44f7d09037a675565ad0"
    },
    {
      "relation": "scenes",
      "name": "scenes_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "scenes",
      "name": "scenes_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "schema_migration_locks",
      "name": "schema_migration_locks_locked_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e44ccae0bf37315eb5f828d8ac3793ddd4a0809e1cea1b23f5b4ec4eef04158c"
    },
    {
      "relation": "schema_migration_locks",
      "name": "schema_migration_locks_name_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2de18fe30b89709c9ff79c7f93fabe08ce27ba81484cce0371766fa6549377a4"
    },
    {
      "relation": "schema_migration_locks",
      "name": "schema_migration_locks_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "7bae5e355e1887ccfd39ef9956bbf61830ae3ddfc8fe194f52b0571adc084745"
    },
    {
      "relation": "schema_migrations",
      "name": "schema_migrations_applied_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "a366ec330a9beda4715748e878e7bf4286dee8de71c60f56ef0b9de35f1055bd"
    },
    {
      "relation": "schema_migrations",
      "name": "schema_migrations_filename_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e48e51bf55af3c9f6a43901412ae55dbd4d54434bb116bdc05c5768c893d0e92"
    },
    {
      "relation": "schema_migrations",
      "name": "schema_migrations_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "ae32828c73519f14977ddf1aa4164ff3882c49d832ec84e319b877b62f7b75a6"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c0d2d180942757cb8561f78063eb9de21e80198593c79dfd1244100f0f460843"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_plan_code_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "a808bc82b7c6a81bd63fdeb96be08baa9ac2ee22d175da0c215e3e42039e1091"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_plan_code_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6c22431e61b8da318a4c7b7e656fe606644034af852b0508785284cd72d2dc98"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_scope_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "10d58b7bf62b40175937eb56d2e2c945e55111cc5d30f58f50a1b0ae2ebf4f32"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "a41b799b49d87d00a5c655562791864f81611a12b208d251a652c9d40a459874"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_stripe_subscription_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "39ef9651b03d005e3330140046439018e677f72abb05af6cac739d178a5a4164"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_stripe_subscription_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "0648dd167c3e5c4b0e6f8102fd1778afc833c37600d40213eb009938d536d7a0"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "users",
      "name": "users_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "users",
      "name": "users_email_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "1d40c82d98714111dd53c279d299065411caaa45ac74a9580421fa43800e1432"
    },
    {
      "relation": "users",
      "name": "users_email_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "cfd44c66f5260638ba3129908bc5db3337488a548feab81611478fc0c586b9fa"
    },
    {
      "relation": "users",
      "name": "users_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "users",
      "name": "users_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "users",
      "name": "users_plan_code_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "a808bc82b7c6a81bd63fdeb96be08baa9ac2ee22d175da0c215e3e42039e1091"
    },
    {
      "relation": "users",
      "name": "users_plan_code_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6c22431e61b8da318a4c7b7e656fe606644034af852b0508785284cd72d2dc98"
    },
    {
      "relation": "users",
      "name": "users_stripe_customer_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "8087d6799612952a9d418d216fb8eeeef134c0cf3b7129985f12485d48c62736"
    },
    {
      "relation": "users",
      "name": "users_supabase_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "6a5281b44bc128cc76f31666028ff664019103420e7bbff1e101285ca47ef18d"
    },
    {
      "relation": "users",
      "name": "users_supabase_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1709f904d31f79433f3a0ada61f47cb71c376e2f272b66971737e892053cb37d"
    },
    {
      "relation": "users",
      "name": "users_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "works",
      "name": "works_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "works",
      "name": "works_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "works",
      "name": "works_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c0d2d180942757cb8561f78063eb9de21e80198593c79dfd1244100f0f460843"
    },
    {
      "relation": "works",
      "name": "works_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "works",
      "name": "works_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9c92339bf5b4c254e77e15e9e9c524f6be5c256e979d44f7d09037a675565ad0"
    },
    {
      "relation": "works",
      "name": "works_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "works",
      "name": "works_title_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "3b2515ee9ed81e849ceed5c50d5277e7c870fbc16845f2f4969d0f789426e739"
    },
    {
      "relation": "works",
      "name": "works_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "works",
      "name": "works_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "works",
      "name": "works_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "works",
      "name": "works_version_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "736415a195f08a4248373da5ce66ccf827e081def78b0d8b4c203dbc5c2a3be2"
    }
  ],
  "indexes": [
    {
      "relation": "account_deletion_requests",
      "name": "account_deletion_requests_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "628ba8d4ce4a0a2544af9b116c30ec3c8ff91d55ca4b9910195e4b50de20b9e1"
    },
    {
      "relation": "account_deletion_requests",
      "name": "idx_account_deletion_requests_pending",
      "unique": false,
      "valid": true,
      "definitionSha256": "b3a4bf4312f85c7d7f34bf30398659280c3b4a20870b5d9e8e0348eb9f4ec774"
    },
    {
      "relation": "balloons",
      "name": "balloons_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "balloons",
      "name": "idx_balloons_page",
      "unique": false,
      "valid": true,
      "definitionSha256": "3d2b4afd05adadd5063d4610374705b1e81a76559c3e256d650b9e80640da494"
    },
    {
      "relation": "chapters",
      "name": "chapters_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "chapters",
      "name": "chapters_work_id_order_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "9dc89f56db24c5768280056397d3b8af1332b280fd0fed358e937da711e83cb8"
    },
    {
      "relation": "composition_gallery",
      "name": "composition_gallery_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "credit_balances",
      "name": "credit_balances_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "628ba8d4ce4a0a2544af9b116c30ec3c8ff91d55ca4b9910195e4b50de20b9e1"
    },
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "credit_ledger",
      "name": "idx_credit_ledger_mobile_store_event_unique",
      "unique": true,
      "valid": true,
      "definitionSha256": "341c5c0e13427578f9e913d52142087d6a56d15454e30b21572d62d1c1019059"
    },
    {
      "relation": "credit_ledger",
      "name": "idx_credit_ledger_stripe_event_unique",
      "unique": true,
      "valid": true,
      "definitionSha256": "3c996d5a1ed433214ceb8f870d85f1cf6ae7182dd79b37faa1926c4bb9c42e74"
    },
    {
      "relation": "credit_ledger",
      "name": "idx_credit_ledger_user",
      "unique": false,
      "valid": true,
      "definitionSha256": "15d7ae6a11b5839a99c159a1eb921de7e858161c9643ae4f0c89ea40e0940e84"
    },
    {
      "relation": "credit_ledger",
      "name": "idx_credit_ledger_user_job_type",
      "unique": false,
      "valid": true,
      "definitionSha256": "ba4bc6fa2dd391f365eb568c14ceedf461758ab321b01df1828bf549859009c2"
    },
    {
      "relation": "email_delivery_logs",
      "name": "email_delivery_logs_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "email_delivery_logs",
      "name": "idx_email_delivery_logs_invitation_created",
      "unique": false,
      "valid": true,
      "definitionSha256": "dc772de3ff6e82f90861c7ef592b366eee960dfc138edc14d2c52277f2ced89f"
    },
    {
      "relation": "email_delivery_logs",
      "name": "idx_email_delivery_logs_organization_created",
      "unique": false,
      "valid": true,
      "definitionSha256": "c06eb712d16ca6fe9f3ec2d2666008e822ada5a35d75a79f96f433dcda8e9099"
    },
    {
      "relation": "entities",
      "name": "entities_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "entities",
      "name": "idx_entities_work",
      "unique": false,
      "valid": true,
      "definitionSha256": "5f54761e929a6aa49c16db5075281fe109545b8e11299806f2a2f14ed2c0b828"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_s3_key_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "9d7851b4eaedeb9f2956ca6f3ffb6c02bccc955543e31db6bcf7c75e5e6d6cbd"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "entity_reference_upload_tokens_token_hash_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "96975dc6bcdf1adbe30bc909d875f43f4c46a55812530170ffae8a7105575804"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "idx_entity_reference_upload_tokens_pending_expiry",
      "unique": false,
      "valid": true,
      "definitionSha256": "b432107f59acb4f90b9db40ea0938a4e1e825e93703211af0317ab28aff291ec"
    },
    {
      "relation": "entity_states",
      "name": "entity_states_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "entity_states",
      "name": "idx_entity_states_entity",
      "unique": false,
      "valid": true,
      "definitionSha256": "f1d18f39a500ee1aa475a91776f5e99e4f268fa8bee6311a87a06d25c8ca2932"
    },
    {
      "relation": "episodes",
      "name": "episodes_chapter_id_order_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "72c140aa4968f0c9dd9b4af280453fe1f49f2e2149210f706512bf596612b7c2"
    },
    {
      "relation": "episodes",
      "name": "episodes_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "export_job_outbox",
      "name": "export_job_outbox_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "6ed3a3abafaaed61ed0b70a50511ff89d74fcd30c0c36081fee2e6ca647f5107"
    },
    {
      "relation": "export_job_outbox",
      "name": "idx_export_job_outbox_pending",
      "unique": false,
      "valid": true,
      "definitionSha256": "a6113efe9123dce0b409195b104db5acd3b2726149440d1af0b7b1b9f9868bbc"
    },
    {
      "relation": "export_jobs",
      "name": "export_jobs_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "export_jobs",
      "name": "idx_export_jobs_active_duplicate",
      "unique": true,
      "valid": true,
      "definitionSha256": "500ced5538fe045184471944b6f3517835d5edc057852b2150143292251cdb52"
    },
    {
      "relation": "export_jobs",
      "name": "idx_export_jobs_expired_artifacts",
      "unique": false,
      "valid": true,
      "definitionSha256": "9a6b41d9a6713674d38ca7eefaa893d6ce6649edcb9d6c8b728e9315f1a9bed6"
    },
    {
      "relation": "export_jobs",
      "name": "idx_export_jobs_idempotency_scope",
      "unique": true,
      "valid": true,
      "definitionSha256": "8f504f41cb6301e31b6afe67b376407214a4676243db979d0f8a060e40cc6412"
    },
    {
      "relation": "export_jobs",
      "name": "idx_export_jobs_scope_created",
      "unique": false,
      "valid": true,
      "definitionSha256": "e16832ddddf3dfd13679d6c0e844d94cc233edb5d236c313903cbdc710b5563b"
    },
    {
      "relation": "generation_job_history_hides",
      "name": "generation_job_history_hides_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "9f4ca04a2aa6c21f3d39b04c98ac5f8a85c90261c76c4c57ecbf2a01c7cb226e"
    },
    {
      "relation": "generation_job_history_hides",
      "name": "idx_generation_job_history_hides_user_job",
      "unique": false,
      "valid": true,
      "definitionSha256": "f030b9ddf1efde29699b600b721a58de8da1cf744dd480bee63d765f4d9edcbc"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_generation_jobs_active_entity_resource",
      "unique": true,
      "valid": true,
      "definitionSha256": "7a9f5f67389d5c40caea06f5c526ba1e620e62737ce192e5ebb91a164d22f484"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_generation_jobs_active_episode_page_skeleton_resource",
      "unique": true,
      "valid": true,
      "definitionSha256": "26a68035d546ca6b82b7a4346fcf6bd74884379da748e87289581736eb033aa8"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_generation_jobs_active_episode_story_autofill_resource",
      "unique": true,
      "valid": true,
      "definitionSha256": "f94f3bba90e9d404ca2100f53eef71f48d457c7c2ba26aeec23b2b3e622f2ccd"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_generation_jobs_active_page_resource",
      "unique": true,
      "valid": true,
      "definitionSha256": "c19ff5964ea15052aa969b6581ba03850c5e10d9de23d91e0d0ea6167ea38847"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_generation_jobs_expired_terminal",
      "unique": false,
      "valid": true,
      "definitionSha256": "55301ae30e0a1f8b03aadde1e7ac495bb4fd873d5943ea2698b9ebbd642f065e"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_generation_jobs_organization",
      "unique": false,
      "valid": true,
      "definitionSha256": "2c5618925d224e7d7e8802e813f145628fa089a7fb070a29daa53dc6be63f403"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_generation_jobs_processing_cancellation_requested",
      "unique": false,
      "valid": true,
      "definitionSha256": "9b1c608a028fd638c624107b3efc8522fca3c27eb93eabd584a76d2ae7c81cbe"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_generation_jobs_scope_created",
      "unique": false,
      "valid": true,
      "definitionSha256": "e16832ddddf3dfd13679d6c0e844d94cc233edb5d236c313903cbdc710b5563b"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_jobs_status",
      "unique": false,
      "valid": true,
      "definitionSha256": "2b0f9f2252388d0eec262757053a030267d3abe8d6d62a674dcb9fe0920deff0"
    },
    {
      "relation": "generation_jobs",
      "name": "idx_jobs_user",
      "unique": false,
      "valid": true,
      "definitionSha256": "15d7ae6a11b5839a99c159a1eb921de7e858161c9643ae4f0c89ea40e0940e84"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "idx_mobile_push_notification_deliveries_claim",
      "unique": false,
      "valid": true,
      "definitionSha256": "4f02eac6b92665deee858c11a2f1fca810faf8bc0617774a278ab7c6be933b7c"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_outbox_id_push_token_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "b2b644599b99a886e39e508c5587627bc2d6143dad1a7a8303225006f4d4b562"
    },
    {
      "relation": "mobile_push_notification_deliveries",
      "name": "mobile_push_notification_deliveries_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "idx_mobile_push_notification_outbox_user_created",
      "unique": false,
      "valid": true,
      "definitionSha256": "15d7ae6a11b5839a99c159a1eb921de7e858161c9643ae4f0c89ea40e0940e84"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_generation_job_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "41489a6b0410b7c6dc38aa980cdc883bde230f57691f82d95c38fbc17d621b83"
    },
    {
      "relation": "mobile_push_notification_outbox",
      "name": "mobile_push_notification_outbox_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "idx_mobile_push_tokens_user_updated",
      "unique": false,
      "valid": true,
      "definitionSha256": "7d5204d508d45a2ce333b56cfd949a3c9e59f65125a96dc664818322f6e4f4cf"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_token_hash_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "96975dc6bcdf1adbe30bc909d875f43f4c46a55812530170ffae8a7105575804"
    },
    {
      "relation": "mobile_push_tokens",
      "name": "mobile_push_tokens_user_id_installation_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "9ba879e76c1915def7eb15bcbfab695d78b49921b57da3b5b6052836bda014b1"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "idx_mobile_store_purchase_events_purchase",
      "unique": false,
      "valid": true,
      "definitionSha256": "b09c817d5393fb8d64505b9ddc80b7c410dcc4df0b91e6b127a98b9a924ae22a"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_store_event_key_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "d4b646da63f624081bce8d5cd86b3928550dd3a4265cf1b8843eef0abddf5f3f"
    },
    {
      "relation": "mobile_store_purchase_events",
      "name": "mobile_store_purchase_events_store_transaction_key_operatio_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "eb9dff2355979bb0d6b27a13a345c205876c1b6f54264b8e3bde695122574380"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "idx_mobile_store_purchases_transaction",
      "unique": false,
      "valid": true,
      "definitionSha256": "5a1640fdae34632e0c91a20a96b0685564a9092a7271de9d94d4687446614b69"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "idx_mobile_store_purchases_user_state",
      "unique": false,
      "valid": true,
      "definitionSha256": "278fb8969c074a48f33e2c7a65d79c51a34e277d38dd33c8ee57eebfcb475d86"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "mobile_store_purchases",
      "name": "mobile_store_purchases_store_external_purchase_key_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "8753423b9090ca2453ea8c66af2fb11d5ec253f770e5143da95f90ea3e46dc7c"
    },
    {
      "relation": "organization_audit_logs",
      "name": "idx_organization_audit_logs_org_created",
      "unique": false,
      "valid": true,
      "definitionSha256": "c06eb712d16ca6fe9f3ec2d2666008e822ada5a35d75a79f96f433dcda8e9099"
    },
    {
      "relation": "organization_audit_logs",
      "name": "organization_audit_logs_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "organization_credit_balances",
      "name": "organization_credit_balances_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "db94b0c41ee882f36ecfdb30e3733f895df3530f9b9aaff73dc65e31a2f119b0"
    },
    {
      "relation": "organization_invitations",
      "name": "idx_organization_invitations_pending_email",
      "unique": true,
      "valid": true,
      "definitionSha256": "bdbcc85e7f36c056236c99858a37a7296ea89e2f8522e9f349196ec719a48673"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "organization_invitations",
      "name": "organization_invitations_token_hash_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "96975dc6bcdf1adbe30bc909d875f43f4c46a55812530170ffae8a7105575804"
    },
    {
      "relation": "organization_members",
      "name": "idx_organization_members_org",
      "unique": false,
      "valid": true,
      "definitionSha256": "4f370c3db68b183fbcb6e53b069b8cdfe216f60d3504699598f69344b8fccefe"
    },
    {
      "relation": "organization_members",
      "name": "idx_organization_members_user",
      "unique": false,
      "valid": true,
      "definitionSha256": "9ce7ae69e37ecb9655aa500fcedb97b73c7d7831609d74459b5973f79e7d8fb5"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_organization_id_user_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "7a992e0baac7517bcb3bc34f212f29fdedaf13115aaf234450931592aea353e8"
    },
    {
      "relation": "organization_members",
      "name": "organization_members_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "organization_usage_events",
      "name": "idx_organization_usage_events_org_created",
      "unique": false,
      "valid": true,
      "definitionSha256": "c06eb712d16ca6fe9f3ec2d2666008e822ada5a35d75a79f96f433dcda8e9099"
    },
    {
      "relation": "organization_usage_events",
      "name": "organization_usage_events_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "organizations",
      "name": "organizations_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "organizations",
      "name": "organizations_stripe_customer_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "87cb0bc264dc04c6b9ff10cd229641ae4aead17842cbd03f76a170b8fd0790f6"
    },
    {
      "relation": "organizations",
      "name": "organizations_stripe_subscription_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "3202e4483043629e4e684faaf85931a25123a6745dc202f851c530ccf5a341ab"
    },
    {
      "relation": "pages",
      "name": "idx_pages_episode",
      "unique": false,
      "valid": true,
      "definitionSha256": "22bce513199bbafd5c6f12f19321c1dd76c51ab0aaab81fba50dfb4002df4d4b"
    },
    {
      "relation": "pages",
      "name": "pages_episode_id_page_number_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "22bce513199bbafd5c6f12f19321c1dd76c51ab0aaab81fba50dfb4002df4d4b"
    },
    {
      "relation": "pages",
      "name": "pages_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "panel_frames",
      "name": "panel_frames_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "panels",
      "name": "panels_page_id_order_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "618848472908966dd6c025be0adc5ca56687252f1cca453771e35253d22292a7"
    },
    {
      "relation": "panels",
      "name": "panels_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "payment_records",
      "name": "idx_payment_records_checkout_session_kind_status_unique",
      "unique": true,
      "valid": true,
      "definitionSha256": "8e3ffd326c2e78fd2eb8c1b01277b2ccfe07bc08b4b30b113d2755b2a26129a4"
    },
    {
      "relation": "payment_records",
      "name": "idx_payment_records_invoice_kind_status_unique",
      "unique": true,
      "valid": true,
      "definitionSha256": "0dc2f587fc79d10ae3098729d8afbf944f61eee520df39b253823595d565b822"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "processed_stripe_events",
      "name": "processed_stripe_events_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "9d549f8364889ea8198cecb637f59d4a99587b7b0f0737c025ce001566c35daa"
    },
    {
      "relation": "rate_limit_buckets",
      "name": "idx_rate_limit_buckets_reset_at",
      "unique": false,
      "valid": true,
      "definitionSha256": "af2e72ec28f8926d495d95c1252567c325c02bd9855793e30e0e3417d9e11ce8"
    },
    {
      "relation": "rate_limit_buckets",
      "name": "rate_limit_buckets_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "f90e1a867fe04cc911bc43cd6f189bd76a8d88725c99a56ff015cc73bb386cb0"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_entity_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "f1d18f39a500ee1aa475a91776f5e99e4f268fa8bee6311a87a06d25c8ca2932"
    },
    {
      "relation": "reference_sets",
      "name": "reference_sets_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "scenes",
      "name": "scenes_episode_id_order_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "a91acd9df4340ec4f2a9a9009249209ad45d1b115219997028b6e3897af861ca"
    },
    {
      "relation": "scenes",
      "name": "scenes_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "schema_migration_locks",
      "name": "schema_migration_locks_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "777add16e215e3a010b4646d71287c75f59b9194069011b7b85179d11e02e2ac"
    },
    {
      "relation": "schema_migrations",
      "name": "schema_migrations_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "758125b5ec8db0f3eba30f90049d1d9a8b87c971640b5938329da3cb042dbfc5"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "subscriptions",
      "name": "subscriptions_stripe_subscription_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "3202e4483043629e4e684faaf85931a25123a6745dc202f851c530ccf5a341ab"
    },
    {
      "relation": "users",
      "name": "idx_users_supabase_id",
      "unique": false,
      "valid": true,
      "definitionSha256": "9d374073418f0dba941c80d987f39a12407a5267938bcdb2a3489eca864cc21e"
    },
    {
      "relation": "users",
      "name": "users_email_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "4925fecf6bf2989decdc7887d43d46bdfcce8ab807c1a98fe850b521c5dbb7cc"
    },
    {
      "relation": "users",
      "name": "users_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "users",
      "name": "users_stripe_customer_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "87cb0bc264dc04c6b9ff10cd229641ae4aead17842cbd03f76a170b8fd0790f6"
    },
    {
      "relation": "users",
      "name": "users_supabase_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "9d374073418f0dba941c80d987f39a12407a5267938bcdb2a3489eca864cc21e"
    },
    {
      "relation": "works",
      "name": "idx_works_organization_updated",
      "unique": false,
      "valid": true,
      "definitionSha256": "3987a530a13fe8663e171b7b94ebec63f67e2b61a5b1d54ef08ad01f7ac1428b"
    },
    {
      "relation": "works",
      "name": "idx_works_user",
      "unique": false,
      "valid": true,
      "definitionSha256": "15d7ae6a11b5839a99c159a1eb921de7e858161c9643ae4f0c89ea40e0940e84"
    },
    {
      "relation": "works",
      "name": "works_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    }
  ],
  "triggers": [
    {
      "relation": "credit_ledger",
      "name": "generation_job_late_consume_refund",
      "functionName": "refund_late_canceled_generation_job_consume",
      "enabled": "O",
      "definitionSha256": "dcb58d5b83a08ff84b991f2d8f3de9e8a91f2c42eefa12488f7375ba84cf21f8"
    },
    {
      "relation": "generation_jobs",
      "name": "generation_jobs_enqueue_mobile_push_notification",
      "functionName": "enqueue_mobile_push_notification_for_terminal_job",
      "enabled": "O",
      "definitionSha256": "99e73d8d082b2d95a9ab7d164e43d8f94439d7e8fd4e8024cf0501a48047cd28"
    }
  ],
  "functions": [
    {
      "name": "enqueue_mobile_push_notification_for_terminal_job",
      "identityArguments": "",
      "returnType": "trigger",
      "language": "plpgsql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "677e1186f0c8a0b599d1421e8bd9e6a624d1a658d5091ad891c48be496d76133",
      "kind": "function",
      "volatility": "volatile",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    },
    {
      "name": "refund_late_canceled_generation_job_consume",
      "identityArguments": "",
      "returnType": "trigger",
      "language": "plpgsql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "d73051b3f9692018e2232b845442c06f695a3e2ca1d335be2e41af93de1275a6",
      "kind": "function",
      "volatility": "volatile",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    }
  ]
};
