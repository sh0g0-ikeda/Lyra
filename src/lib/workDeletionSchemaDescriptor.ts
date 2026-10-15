// Generated from isolated PostgreSQL 18.3 with migration 050; never copied from production.
export const WORK_DELETION_SCHEMA = {
  "relations": [
    {
      "name": "work_deletion_assets",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "work_deletion_prefixes",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "work_deletion_requests",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "work_deletion_resources",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "work_resource_ownership",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "work_storage_operations",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    }
  ],
  "columns": [
    {
      "relation": "work_deletion_assets",
      "name": "request_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_assets",
      "name": "s3_key",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_assets",
      "name": "key_hash",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_assets",
      "name": "kind",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_assets",
      "name": "deleted_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "request_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "prefix",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "key_marker",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "version_marker",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "scan_complete",
      "type": "boolean",
      "nullable": false,
      "defaultExpressionSha256": "fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "owner_user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "requested_by",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "a89df8d14a00b7bd2ead7e86414dcd5232bff306786856171b38584e153bb73f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "processing_token",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "lease_expires_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "blocker_code",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "retry_count",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "next_retry_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "completed_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_requests",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_resources",
      "name": "request_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_resources",
      "name": "kind",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_deletion_resources",
      "name": "resource_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_resource_ownership",
      "name": "kind",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_resource_ownership",
      "name": "resource_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_resource_ownership",
      "name": "work_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_storage_operations",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": "eea9a3e7c2abe43835e2a6fdf92a7d1e6f145ad6dfbfd243fc5d395e5b390a33",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_storage_operations",
      "name": "work_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_storage_operations",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "ddc9fef1818aedbeff43be7bb67ff9faaf3c3aaf73931999e9781ba1217171e8",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_storage_operations",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "work_storage_operations",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "works",
      "name": "deletion_started_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    }
  ],
  "constraints": [
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_copy_v2_image_receipt",
      "type": "c",
      "validated": true,
      "definitionSha256": "0418ca3e9d2c21b1f02840a7dbfef98eab8009f3c9341ce3871c512c7b739c6f"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_copy_v2_marker_receipt",
      "type": "c",
      "validated": true,
      "definitionSha256": "bcfd168c04655da86c1bb365d3b791acd6621914b853d28ff323f70e76767bbd"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_copy_v2_scope_shape",
      "type": "c",
      "validated": true,
      "definitionSha256": "9c24b61d08dc626a0326337ff1fcafc15c9fca44250a244ed9aac148781551fd"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_copy_v2_state_evidence",
      "type": "c",
      "validated": true,
      "definitionSha256": "7e5f3c121894608dd16284c9aec67058221bed7d92168cc5e38296ca38b4c2c7"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_attempt_token_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "dbaf31aa3088967c088cb18bfc54925e42813b71bb134e0dd030a7dd484d8c15"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "b0ec0820f83cf2cd660c6f1e730ca2b8ea8882f4057a6439a2aac2224c480ba4"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_check1",
      "type": "c",
      "validated": true,
      "definitionSha256": "1b2dcf1d81641813800fc021bb49d8154d14708922244fc2610998ed5ca2fa3e"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_check2",
      "type": "c",
      "validated": true,
      "definitionSha256": "b818885030be4ef6248214b056378154e7098eef54e65307798cdf71911338f5"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_fencing_reason_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "2fe9ac868aa3309bc6630652e5188f27743f044e7ca1555f2849cc01db533961"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "169a317a0b8ec4ed6bcab364195d48bed8590cec41e2ac967e6bab7b879a5303"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_protocol_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "72ab1240deea31faab9559326b2726f8c5a34591c0f1c97ea83377b6ff00eba3"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_protocol_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6ffb7863c7d4bbab3a5b6e47b4f55a1e72e287c49244dcb58b3a07266943daf6"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_s3_key_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "71a4f2527129767e55f6fee214d2234b2f6669a866bfb50aa3d4198a539787cc"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_s3_key_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "974915faff4aa8106e1f6bf9ae24dd67d3e7f5247bc5cfd0f5536f846085e065"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_state_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "13d310fd7d6add8c8dbd1d37ad17480c9ef337d746f706a207a0faecc5e36b8f"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_state_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "087f2291aec917662587fb55465b09400ba4647aa6e357ab1995522613c3722b"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "state_reference_copy_attempts_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "work_deletion_assets",
      "name": "work_deletion_assets_key_hash_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1ed5fb4af14981da45abeb22889337955581cda9612b1f4f9151a97f2561ffe3"
    },
    {
      "relation": "work_deletion_assets",
      "name": "work_deletion_assets_kind_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "79a27204e5c0e08282aa791747a28b1591034ea1e6a03b766a4a080c969cbe9a"
    },
    {
      "relation": "work_deletion_assets",
      "name": "work_deletion_assets_kind_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fad9a10b91a3fbeafe30a0577b442553c1986b3244368a78ac1323ce02015690"
    },
    {
      "relation": "work_deletion_assets",
      "name": "work_deletion_assets_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "2c8e88ae0b0ed79bc86eddcb3dc6146d1dc67df6790bc21297aaeb36d38c5272"
    },
    {
      "relation": "work_deletion_assets",
      "name": "work_deletion_assets_request_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "fb0e155a01088643ac2b909b10d77d1167c7137a5a6dc74ba170d0be388196e5"
    },
    {
      "relation": "work_deletion_assets",
      "name": "work_deletion_assets_request_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "d62eb6a4b7b60ac041c25388db804db30030bb8ca67d5e8bde593e582cf5f033"
    },
    {
      "relation": "work_deletion_assets",
      "name": "work_deletion_assets_s3_key_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "86662300240b13fdec1917b43dc37ee9004b6ab8e1e202fd5d796d0ca333f5fc"
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "work_deletion_prefixes_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "5101f1b6f5cd3c410ca19693198a983548ac22da0a6c8926fb5f075f12a94b60"
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "work_deletion_prefixes_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "6802299913e24dcf37bab95253789c6206de4c0fd1792d70030abd214de035b4"
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "work_deletion_prefixes_prefix_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "6f07f1eacda00aa9345f573be43b7412711fcaef9d6867d385455c6e90cecf0a"
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "work_deletion_prefixes_prefix_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "9791ef5ceac6c3318b5ed2363607c26e1e589777908c2312fd358a3ed5bedae5"
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "work_deletion_prefixes_request_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "fb0e155a01088643ac2b909b10d77d1167c7137a5a6dc74ba170d0be388196e5"
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "work_deletion_prefixes_request_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "d62eb6a4b7b60ac041c25388db804db30030bb8ca67d5e8bde593e582cf5f033"
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "work_deletion_prefixes_scan_complete_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "4165bc94bea298699161679be247e0e35087f2e49344667b6db2e5f6b739bccd"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "79b33e5417b98a7f9e0400bbeb755486c85d519d093a8ea17b7410c2784b663a"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_check1",
      "type": "c",
      "validated": true,
      "definitionSha256": "07a3093e544bf14ffbcc8c8221ee119ab9d7394fca46f5f78be567803e9d94b6"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "2f9addcdd9d1e069954a53471202703fa2d13fd2931d316c9fa9d708ce1cfa10"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_owner_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "64a0de038177806c4f81441cf553f53953caa81efa5f692a2d29d5c3a3dfc3db"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_owner_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e50ea5c692101355405df95757a14e47a441680dc09d37f5a0bff9ba5d7a9b51"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_requested_by_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "631a500a3cf6a8a2139f39d10503b5a0db5450d546f5e86e6fc163fa8f799555"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_requested_by_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "d37b682e8996e2104b14bed200b1e13a33f0bed3a95f820d2fd4dc3cded5657e"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_retry_count_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "63a5687700f073cf0074e6e69097d05b005ee28cdeb849cfc9d9fbc4e460ce7e"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_retry_count_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "c695e280e496d34e48071d61680678280acdea0c26b26b1fab9d72e92c44584e"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "9500e37db2c22beeb68e2e5bb98b9dba47d82e0c390080fda579a8e09c4bbd1f"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_work_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "54f254ea3ef26639ea14fcee0189f42a672368ccbe224403c6a1377654b700f8"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_work_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "63e6d529ddeccdab60d7097269a9b70357913b4b61fec9709126c03e8ad4f801"
    },
    {
      "relation": "work_deletion_resources",
      "name": "work_deletion_resources_kind_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "6c573e470d1a927a022e834d93a34927299aeea4fe458c7b34fe55f7a5f38efc"
    },
    {
      "relation": "work_deletion_resources",
      "name": "work_deletion_resources_kind_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fad9a10b91a3fbeafe30a0577b442553c1986b3244368a78ac1323ce02015690"
    },
    {
      "relation": "work_deletion_resources",
      "name": "work_deletion_resources_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "d3585b62831b7e4542d5e879c92c8241d39af93019c1e7a186a762d5cc40ecf3"
    },
    {
      "relation": "work_deletion_resources",
      "name": "work_deletion_resources_request_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "fb0e155a01088643ac2b909b10d77d1167c7137a5a6dc74ba170d0be388196e5"
    },
    {
      "relation": "work_deletion_resources",
      "name": "work_deletion_resources_request_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "d62eb6a4b7b60ac041c25388db804db30030bb8ca67d5e8bde593e582cf5f033"
    },
    {
      "relation": "work_deletion_resources",
      "name": "work_deletion_resources_resource_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e9686b4aa537d9917a102abaf86f728990ca161ff582a47a46dd0e5811202726"
    },
    {
      "relation": "work_resource_ownership",
      "name": "work_resource_ownership_kind_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "6128d79f675350e28cbc8994a69239818dd97c178de48137b1fa413d71fb3048"
    },
    {
      "relation": "work_resource_ownership",
      "name": "work_resource_ownership_kind_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fad9a10b91a3fbeafe30a0577b442553c1986b3244368a78ac1323ce02015690"
    },
    {
      "relation": "work_resource_ownership",
      "name": "work_resource_ownership_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "78699093590b6005b08fddaba3d03a8ed7d2ea6a395468209b1acd100e898039"
    },
    {
      "relation": "work_resource_ownership",
      "name": "work_resource_ownership_resource_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e9686b4aa537d9917a102abaf86f728990ca161ff582a47a46dd0e5811202726"
    },
    {
      "relation": "work_resource_ownership",
      "name": "work_resource_ownership_work_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "63e6d529ddeccdab60d7097269a9b70357913b4b61fec9709126c03e8ad4f801"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "884a8a156675c0f2872a1821bb8a58355f9c57a2ea2d584bf7af4419d658498c"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_work_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "bab4f4dfe4ecf249f316e2aa690b4acf99306de1a6301f7bf057192afd29f445"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_work_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "63e6d529ddeccdab60d7097269a9b70357913b4b61fec9709126c03e8ad4f801"
    }
  ],
  "indexes": [
    {
      "relation": "work_deletion_assets",
      "name": "work_deletion_assets_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "bd2c8f1a980b8b97846f5f17b2253f685d922899efbab6cbe7264d48c8c0634d"
    },
    {
      "relation": "work_deletion_prefixes",
      "name": "work_deletion_prefixes_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "8bbfa4b0d18ffe3ee1dd4c34d4d11415fd0bd460f311d194c45de0cf43ae80db"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_recovery",
      "unique": false,
      "valid": true,
      "definitionSha256": "609e9bf242e3b91659ab1697a9ad23ed677b16d07dc428e2e42bc8ba033f950b"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "work_deletion_requests",
      "name": "work_deletion_requests_work_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "5f54761e929a6aa49c16db5075281fe109545b8e11299806f2a2f14ed2c0b828"
    },
    {
      "relation": "work_deletion_resources",
      "name": "work_deletion_resources_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "7dbe24a6f3c913092dcb24080e01559037b3b82fd27494752a612ebe1295829b"
    },
    {
      "relation": "work_resource_ownership",
      "name": "work_resource_ownership_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "8160951bc25b244c92c80f6f2e52b99009716b6b8adff5b4db0430350ab0cd60"
    },
    {
      "relation": "work_resource_ownership",
      "name": "work_resource_ownership_work",
      "unique": false,
      "valid": true,
      "definitionSha256": "5f54761e929a6aa49c16db5075281fe109545b8e11299806f2a2f14ed2c0b828"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "work_storage_operations",
      "name": "work_storage_operations_unsettled",
      "unique": false,
      "valid": true,
      "definitionSha256": "8f8a6b1f15daf5efeca3b982b4ff3af4ec60dcf7e07584d7d99ef4550c8a64e9"
    }
  ],
  "triggers": [
    {
      "relation": "balloons",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "ceb44a33ee7cc8c74d3cf6a2f5027e21ba0487091497ad44e088013ebbbc0341"
    },
    {
      "relation": "chapters",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "473872a47eab73888065d47abafd12b0c0cdf4ecc7ca68db5e4ba0379d1b9b57"
    },
    {
      "relation": "chapters",
      "name": "work_resource_ownership",
      "functionName": "lyra_record_work_resource_ownership",
      "enabled": "O",
      "definitionSha256": "16bb8a072f709ffd95dc00c9f3a30deca7b5ea1115782dd2f8de03b57de934d8"
    },
    {
      "relation": "entities",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "a8353136984db73b3ac8a2016f50fd82c225676a3a858363e0477e4f2d0a6a2b"
    },
    {
      "relation": "entities",
      "name": "work_resource_ownership",
      "functionName": "lyra_record_work_resource_ownership",
      "enabled": "O",
      "definitionSha256": "41fcd757b509c37c310a36d879a892a9b9a8449a805e359bc37f7731054eebff"
    },
    {
      "relation": "entity_reference_upload_tokens",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "2e27310259b96a41a8ed684a8e9d14a745cec47f405f9c9dadf2f0089eb8b5b6"
    },
    {
      "relation": "entity_states",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "03c8158cb9a8a1d8d8e1c124316ee91e6280decf053d9ef5f9b5f3d7f309843e"
    },
    {
      "relation": "episode_export_jobs",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "80d51208d230f39c78fedd76321e5c48f39ef530eec230944e7486aff15d797d"
    },
    {
      "relation": "episodes",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "34c355dcb283aa35f6a094a85bd4b337cff82f2f1b94dbdcdf7bd2a2d42150a9"
    },
    {
      "relation": "episodes",
      "name": "work_resource_ownership",
      "functionName": "lyra_record_work_resource_ownership",
      "enabled": "O",
      "definitionSha256": "ec7e7f94ecdacbac3c5f5fd87dbbe73c5d0b48ae14c37a7d8920fffe66525634"
    },
    {
      "relation": "generation_jobs",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "52a7dc1ca6174d08ecf128c058040c9886ff074e8fc787836fdadc1c56b52b66"
    },
    {
      "relation": "generation_quotes",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "e9567a6bce932651bf5da408978689506511dd2faeee720c684a25ba6002c262"
    },
    {
      "relation": "pages",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "97e76b0e52d6075eb1f5413bf091d299d8f12e6c70ec50aff0779890d7c286e3"
    },
    {
      "relation": "pages",
      "name": "work_resource_ownership",
      "functionName": "lyra_record_work_resource_ownership",
      "enabled": "O",
      "definitionSha256": "895d75f4e4b171a356c38ca117bb24e147d83ba853adc9771820a2f956ee5538"
    },
    {
      "relation": "panel_frames",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "ba56bf47bd7925b4fb8333f67bf77095932dfc66792378da127382b399028332"
    },
    {
      "relation": "panels",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "82a7ba29eebc14510ab79e35895979dbd4af8fad4a1289a67dcb60957efdcbce"
    },
    {
      "relation": "reference_sets",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "82a594b9e33a4a7bdb3770a7b0c9c34daa601e19de214fb696bc8c7899ca04f5"
    },
    {
      "relation": "scenes",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "4870818d6c8511748a4390a80e83a3376cc56a4b07df91db1ab9eaddd889d7f6"
    },
    {
      "relation": "state_reference_copy_attempts",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "feb77f7c07f038a27145c0202f5b6af7eb1a8595eef26b6223926538fc7dad09"
    },
    {
      "relation": "works",
      "name": "work_deletion_write_guard",
      "functionName": "lyra_guard_work_deletion",
      "enabled": "O",
      "definitionSha256": "af2c6fd481359cbf83952aa11f7826ba04e7a439f7e341b97f8153bc3d76eabd"
    }
  ],
  "functions": [
    {
      "name": "lyra_guard_state_copy_v2_journal",
      "identityArguments": "",
      "returnType": "trigger",
      "language": "plpgsql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "741993d64dc0f966c3595b8d21c90a1f729a6e9f64d3deb633f77f03240acbcf",
      "kind": "function",
      "volatility": "volatile",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    },
    {
      "name": "lyra_guard_work_deletion",
      "identityArguments": "",
      "returnType": "trigger",
      "language": "plpgsql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "6ad426ca25f873c8ff7cc286df86cbd538ec9b40ed85013382ff84b61ca85887",
      "kind": "function",
      "volatility": "volatile",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    },
    {
      "name": "lyra_record_work_resource_ownership",
      "identityArguments": "",
      "returnType": "trigger",
      "language": "plpgsql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "18eb85a42a00a6cdffcf04845029de21a79553fe5881f9b974b8a19bb0d30ac1",
      "kind": "function",
      "volatility": "volatile",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    },
    {
      "name": "lyra_resource_work_id",
      "identityArguments": "relation_name text, document jsonb",
      "returnType": "uuid",
      "language": "plpgsql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "24c20abce8f1b67dc06fb4fede1f5eaf035c1240e73f40055d83f0853ea7eb77",
      "kind": "function",
      "volatility": "stable",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    },
    {
      "name": "lyra_work_asset_hash",
      "identityArguments": "",
      "returnType": "trigger",
      "language": "plpgsql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "b5506ab8f9d5c1fadd4d906489e69094433b3f7fc21d2edbe34f440e7dd7e525",
      "kind": "function",
      "volatility": "volatile",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    },
    {
      "name": "lyra_work_deletion_claim_allows",
      "identityArguments": "target_work uuid",
      "returnType": "boolean",
      "language": "sql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "26cb51c0408468410b410ad8c36eacbcd22d6e06e885d8416fb981442215935f",
      "kind": "function",
      "volatility": "stable",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    },
    {
      "name": "lyra_work_resource_uuid",
      "identityArguments": "value text",
      "returnType": "uuid",
      "language": "sql",
      "securityDefiner": false,
      "settings": [],
      "bodySha256": "2c59757402a38a7dc0815021a5480768b93c75249ae19326a953e345e34687fc",
      "kind": "function",
      "volatility": "immutable",
      "strict": false,
      "parallel": "unsafe",
      "leakproof": false
    }
  ]
} as const;
