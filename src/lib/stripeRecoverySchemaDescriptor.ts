// Generated from PostgreSQL 18.3 isolated actual44 + reviewed forward migrations.
export const STRIPE_RECOVERY_SCHEMA = {
  "columns": [
    {
      "relation": "credit_ledger",
      "name": "stripe_payment_recovery_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "granted_credits",
      "type": "integer",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "credit_bucket",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "payment_records",
      "name": "grant_expires_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "recovery_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "provider_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "provider_object_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "amount_jpy",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "last_stripe_event_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "payment_record_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_intent_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_charge_id",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "currency",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "credit_bucket",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "granted_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "grant_expires_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "observed_refunded_amount_jpy",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "target_reversal_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "reversed_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "unrecovered_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "payment_record_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_payment_intent_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_charge_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "provider_type",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "provider_object_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "amount_jpy",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "observed_refunded_amount_jpy",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "last_stripe_event_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "resolved_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    }
  ],
  "constraints": [
    {
      "relation": "credit_ledger",
      "name": "credit_ledger_stripe_payment_recovery_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "220ce3ca9299c3b4685700c754deee3c5b37e5c02119d96b3c5e2ee366e77248"
    },
    {
      "relation": "payment_records",
      "name": "payment_records_credit_grant_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "eed64a4a5f07b2805657de8b9ab0e4de7f2366d72ca555e3bde6ab1ec82cc7be"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_obj_provider_type_provider_object_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "dcf7559484ccc4a74b1150a60d4165bc85bb16285935f7a4e64c97fee21faebb"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_amount_jpy_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "82c4d8dd8622c384042b22f13e943fdd997c90abdefe9f8f8d817efe5ab24cbb"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_amount_jpy_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e329c9f3003e115a097d48ace1fe070433e9d42289fa846e0f2fedf3d8588150"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_last_stripe_event_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "c2c4333c14ed26db74efe6ca55757b3ada262dcd8447715b7d26b381bf2f3d4b"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_last_stripe_event_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "d7d6dc7c6fbcfd1c2b3b760d09ff6b0e9052a09032035d4b65ebc1b424fa739c"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_provider_object_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "4bc21997a4ab3add3c587bb8205c83b1b07d9983c966c9f239c7b1b8096ed5c2"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_provider_type_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "47f105337e0b418034adea954b6c288e1defef90c338b591937c39931782b516"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_provider_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "040c0ffdac5826ce924007abbea56202ec172b965436696d83eeae3681f7f04a"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_recovery_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6b27e1a882909af3885a90e11d2d1fb0622a372c351056cc0ceb493b2943968"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_recovery_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "0bc8aef5bf39a14bc11872dac885a78cd07a853bc4e76221e7defb48acd38c9c"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9a88694767fbc7cd3d858857f7ea82a55c926f6fde54501b91493aa471eb524e"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_credit_bucket_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "8937b5f41d4945729afc9f795367d98461b63c784c0ec05d9c7fd5c3986cb6b7"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_credit_bucket_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "0c7cf1b01bfe8868819bf1327e561ca527dfa5de8c8c6738e1623df2620bc2a7"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_credit_totals_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "3f7de80d5d8950fc78ffc751d9394fea50c2e70dca32af030a9d88274a6eb4c2"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_currency_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "982a0ed4bab2d283d9c856cd9b268544ab54ed9ad594b1f8e3d308643bec4f29"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_currency_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "0f0d0b468c0f2e8996428df2c68c24368fec691128300260fa2a0f62eb062c23"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_granted_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ed6384c4d96f63969052561f1cb2f46884119be597688e07bf9d2164c63dcef8"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_monthly_period_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "2a80c1a9b7c8e2060ed981646cd01877bf1949bec7d7566bb5a2ff43bd8d7249"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_observed_refunded_amount_jpy_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "4621e5ea02b7b5366d781476d9cef32d8b85e81eeff814cc8777be124fca0054"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_payment_record_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "8a06e567c6604da9510b2c8baa1ce3e1ae465b5d5d3702a53037c9370ccf1faf"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_payment_record_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "fa92497d840db37359664f83957576de09f5b89bfd6985932e879ac1b9d6c90c"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_payment_record_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e5a20900eea7543a37ef5b33df36efce26e37f15b50d2116d51a2ac630b83a6f"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_refund_amount_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "c16cc1b3a65f691da5e6ddd3b52cab4e047f8a4b0783bbbe0e7d6b560d5e4be2"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_reversed_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "28c59b87a61e3f31f876c604400c1a012974f5267cddacc42f130d0fbf5d141f"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_stripe_charge_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "b3db802e5972817bd5bc74de6ef0e2d7b3581c928ef07d897b4dc9d4d160f34d"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_stripe_payment_intent_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "c407563dba37ec393651fd2dffba53aa40bd9d56f9369ce403e3263b888dcdaf"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_stripe_payment_intent_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "dc8404f346524c64c4eb4a205b97d29e20ec9344e5bb50cdda4d59d9468de2ec"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_target_reversal_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "12d14fc9aa2a2917c8162a9ee5aa9090a7d0daf1c4b1aad0e0950c681d27907b"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_unrecovered_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "242a712d0fcaebe39ed41656374b8f901c055675b7b9a95b8f4ff17cf432dd1a"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_a_observed_refunded_amount_j_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "4621e5ea02b7b5366d781476d9cef32d8b85e81eeff814cc8777be124fca0054"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_ad_observed_refunded_amount_jpy_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "c16cc1b3a65f691da5e6ddd3b52cab4e047f8a4b0783bbbe0e7d6b560d5e4be2"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adj_provider_type_provider_object_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "dcf7559484ccc4a74b1150a60d4165bc85bb16285935f7a4e64c97fee21faebb"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adj_stripe_payment_intent_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "dc8404f346524c64c4eb4a205b97d29e20ec9344e5bb50cdda4d59d9468de2ec"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustm_last_stripe_event_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "d7d6dc7c6fbcfd1c2b3b760d09ff6b0e9052a09032035d4b65ebc1b424fa739c"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustmen_provider_object_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "4bc21997a4ab3add3c587bb8205c83b1b07d9983c966c9f239c7b1b8096ed5c2"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustment_payment_record_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e5a20900eea7543a37ef5b33df36efce26e37f15b50d2116d51a2ac630b83a6f"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_amount_jpy_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "82c4d8dd8622c384042b22f13e943fdd997c90abdefe9f8f8d817efe5ab24cbb"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_amount_jpy_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e329c9f3003e115a097d48ace1fe070433e9d42289fa846e0f2fedf3d8588150"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_last_stripe_event_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "c2c4333c14ed26db74efe6ca55757b3ada262dcd8447715b7d26b381bf2f3d4b"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_payment_record_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "8a06e567c6604da9510b2c8baa1ce3e1ae465b5d5d3702a53037c9370ccf1faf"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_provider_type_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "47f105337e0b418034adea954b6c288e1defef90c338b591937c39931782b516"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_provider_type_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "040c0ffdac5826ce924007abbea56202ec172b965436696d83eeae3681f7f04a"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9a88694767fbc7cd3d858857f7ea82a55c926f6fde54501b91493aa471eb524e"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_stripe_charge_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ba78018973fb0185028203201bf878788e861d7d85d127ab60e23fca37d57f81"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    }
  ],
  "indexes": [
    {
      "relation": "credit_ledger",
      "name": "idx_credit_ledger_stripe_payment_recovery",
      "unique": false,
      "valid": true,
      "definitionSha256": "f85932881ff1a14a86a4c28ca0b2af7ea8a6b56cac80c18ca3096ad6c10c198f"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "idx_stripe_payment_adjustment_objects_recovery_status",
      "unique": false,
      "valid": true,
      "definitionSha256": "bfa062240c3a0418c386aacfac4bed6228d2356469b81705ea2b5323be925e97"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_obj_provider_type_provider_object_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "39da9a24e5ec3fdf274fd8a930a6eee4449da9a3685144522535c520a706183a"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_last_stripe_event_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "1021a0003019e0eb39147dc65db96ee1f09bded74055a644b32466935bc34fcb"
    },
    {
      "relation": "stripe_payment_adjustment_objects",
      "name": "stripe_payment_adjustment_objects_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_payment_record_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "68599e37e717c88cb9139a4504db9c405e244428ac9ecbdbb8b6c34ab3b5356c"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_stripe_charge_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "deaf5219f072e8225b5318bc40cacf6de60f607b945fb8fa1de53f49bc4dbf93"
    },
    {
      "relation": "stripe_payment_recoveries",
      "name": "stripe_payment_recoveries_stripe_payment_intent_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "d8ed9e432c66372238cfa109395a241f1b436b93c3c7ed64eda5435d41fb6b61"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "idx_stripe_unresolved_payment_adjustments_payment",
      "unique": false,
      "valid": true,
      "definitionSha256": "d83a449f43d383b5155b85a38ba00146dc0e3a04f21b3693672854a3d3e5418d"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adj_provider_type_provider_object_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "39da9a24e5ec3fdf274fd8a930a6eee4449da9a3685144522535c520a706183a"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_last_stripe_event_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "1021a0003019e0eb39147dc65db96ee1f09bded74055a644b32466935bc34fcb"
    },
    {
      "relation": "stripe_unresolved_payment_adjustments",
      "name": "stripe_unresolved_payment_adjustments_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    }
  ]
} as const;
