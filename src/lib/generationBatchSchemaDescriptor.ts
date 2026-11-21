// Exact additive migration 055 footprint verified on PostgreSQL 18.
export const GENERATION_BATCH_SCHEMA = {
  "relations": [
    {
      "name": "generation_batch_items",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    },
    {
      "name": "generation_batches",
      "kind": "r",
      "rowSecurity": false,
      "forceRowSecurity": false
    }
  ],
  "columns": [
    {
      "relation": "generation_batch_items",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "batch_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "position",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "kind",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "label",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "target_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "entity_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "depends_on_item_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "a89df8d14a00b7bd2ead7e86414dcd5232bff306786856171b38584e153bb73f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "approved_request",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "approved_input",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "input_revision",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "operation",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "image_model",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "provider_model_id",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "render_style",
      "type": "text",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "amount_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "pricing_version",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "child_quote_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "job_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "confirmation",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "blocker",
      "type": "jsonb",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "started_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "completed_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batch_items",
      "name": "updated_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "user_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "organization_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "work_id",
      "type": "uuid",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "episode_id",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "kind",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "status",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": "b2cc9ef2daee7d1da9c724e41b3464085d87fabf141133888b08cd58dbba9159",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "selection",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "render_style",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "image_model",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "pricing_version",
      "type": "text",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "maximum_credits",
      "type": "integer",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "auto_confirm",
      "type": "boolean",
      "nullable": false,
      "defaultExpressionSha256": "fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "approved_plan",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "blockers",
      "type": "jsonb",
      "nullable": false,
      "defaultExpressionSha256": "3fad7390b7bffb3cf2f50703d5e74be1cd9c8738608b6702cfea68f9d98e02bb",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "expires_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "request_key",
      "type": "uuid",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "accepted_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "cancel_requested_at",
      "type": "timestamp with time zone",
      "nullable": true,
      "defaultExpressionSha256": null,
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": false,
      "defaultExpressionSha256": "28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f",
      "identityGeneration": null,
      "generatedExpressionSha256": null
    },
    {
      "relation": "generation_batches",
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
      "relation": "generation_batch_items",
      "name": "generation_batch_item_shape",
      "type": "c",
      "validated": true,
      "definitionSha256": "fd969dba94fcee1cd8216ac2f48c111dcdb5e46dabe2d1f91aa7d7e7e69336fb"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_amount_credits_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "097402faf643bbcfc70978a78e2180336f6d68933ea63201c3dc6e7dfe4748f2"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_amount_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "02df0de87fe159d807ef689e16ffe8faffed6018971a81d54371f3003070fe13"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_approved_input_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "ced1d5686484247f75210bd78b90932ed7a7e2770d60ca0af38e3ce6a9f57b99"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_approved_input_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "7201dcdec67ce584f8d1b9220f5a80930bb695364eb6261b5f511dbca5f0f98e"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_approved_request_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "8b4478feaf939f951f27faf20b3d8a966865d2946316395b614c2ab9ef3e9780"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_approved_request_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ffb41ad909a775f927484a24ec1a578d7b1fdae2d6e88a3a5485381eb052b773"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_batch_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "3cd47bfbdc66719c9a0e286e76b88e1086f60fbd16f2d9087059cbb709742cc0"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_batch_id_kind_target_id_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "fda93afc07abbc6422bef6c9d4bf0162fe75af7d7892bee753e4e7f4cd60709d"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_batch_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "99fafc54dbdf05cf0298952dada8301c8ea4758d820af2b9b76d9930312d74a3"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_batch_id_position_key",
      "type": "u",
      "validated": true,
      "definitionSha256": "7cd66f299d5dc51d29790f69ef5a970de57c64fa2a9569062f658a4cee7b4e86"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_child_quote_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "029c146193d8be1c5e71abac4081b92eda30d174dc5c4a30aa67fb16023a54ec"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_depends_on_item_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "dc4bae9a18f9a94239d3fb80ed1d2e2ed37171f1dc68c3125b5cea8c18631d12"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_image_model_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b787010322811f6e143383eb8c166d34effd73274267b8dad799f4d6e25020ef"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_input_revision_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "1f973f218ffaccfe8147e2fd12270f2a23911431c86ff686a64aa84a9d9d82dd"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_job_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "0bf2c75702405e29d9ec0e495d4280c88621f292ea032932f1bd40a2cc6ca881"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_kind_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "0658ebce260df35133fe5f80799f0d7c4d0b680faa718bd772147e7fc6dc985a"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_kind_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fad9a10b91a3fbeafe30a0577b442553c1986b3244368a78ac1323ce02015690"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_label_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "09f8d4aea4548b568aa1713d08e06e93d0c50445b452ae930ac640135e84cab5"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_label_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fd24fc72517ff63e6be761816bf0dde72255027b9ab34c878f3aae4a1b059464"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_operation_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "f849d0189f50545f936c21c79c4f36553875158d2d6ad26832b958b32e31a6a7"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_operation_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6c8870b65cd9f5c67aa31916e091c4be15d2f8709757ded77e541ec20850352e"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_position_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "568cfd2aad5ee5417c3dba4c839a6297b6a15b2d73b043f0b19263f567e4cf93"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_position_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "e00193a4ee5abba80d598608e9062bfbfaf1a0d42a93f9d0c02a843726d21e2b"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_pricing_version_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "a306db7e833937df7891bd9a525ab7331a9e0421caeb8bc3edd66490c6fa749b"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_provider_model_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ee1d82a09bfbfd497a061663e7205c8a8905fafe732a94d6e87588503c050dd8"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "1eb22b60677fee981940d43f643cdaabf2b58eaad65393a1ac4fe471f92560db"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_target_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "41a48fcc611b820569e5eb0d6b16567def90ade9a0a2f82a8228708ea11be298"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batch_acceptance_consistent",
      "type": "c",
      "validated": true,
      "definitionSha256": "cbd6df5b3eb1c0fda653298ca1c5b97ad2f8772241a8227994a45f271c390f9d"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batch_kind_scope",
      "type": "c",
      "validated": true,
      "definitionSha256": "c4599cf6471f0cf3d2ca113fe72d77819ec87f41a495d2081e92d2987d1bed0b"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_approved_plan_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "8b0e141069b864a3d373c9d9cb3fc443949b4806de232f2e0ac185525ba7950c"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_approved_plan_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ff4f3c854a93ef066e60b5e1a533c625a62bed6849d24987baf149dfe3f1547b"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_auto_confirm_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "500ed135a64ef3f0480ae2db1f08ad9a5de2dc16f6d8af41fcb52e7f5aca4e69"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_blockers_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "7fb9a8507427bd2a2acc93bcdbb4f02af230c819d20ad0af672ae2a7ea06d756"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_blockers_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "ffb9053956dd42b049c829649c3589724f7064abe91dda8f803305ac5d311fb9"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_created_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_episode_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "e021534f54d393e2ce46160e663cde1514e1f5d211520adc4b52ebb7620d3e7c"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_expires_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "329142b25e122eb9bffaebec0ddb2fa7d97b2fd540f53264567c6bf9a1c10526"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "6d7506d8233cbea9d9fe6b8d8f27f360db0fbffb967f9b95f57bf6ecda6cbe3a"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_image_model_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "b787010322811f6e143383eb8c166d34effd73274267b8dad799f4d6e25020ef"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_kind_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "dfd3ee286655f8f7c7893643c43da9b85c03667c2ecd4b074c9a1fd8b5abcf15"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_kind_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "fad9a10b91a3fbeafe30a0577b442553c1986b3244368a78ac1323ce02015690"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_maximum_credits_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "91c2599dff9b40472867aac1ccc4c505a84ea34dffcd96d4d0499bc578a4650b"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_maximum_credits_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "66ef7852bac54ea16f96c567492821cebf6cf2bd9f387b6079ea6f9496e46467"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_organization_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "9a88181960ceedd5237067694f62582050c8c8c703e49d32fb67bf416273decb"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_pkey",
      "type": "p",
      "validated": true,
      "definitionSha256": "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_pricing_version_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "a306db7e833937df7891bd9a525ab7331a9e0421caeb8bc3edd66490c6fa749b"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_render_style_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "cd51410a62e7107cefd06d5b0676e559827e03182cbea7952a92bf14190bd46e"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_render_style_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "70489198c1fd8f281e387d1209b9939d0fa95ab82ad65582c8a62e4ad650eff0"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_selection_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "184a066c0f84aedba211aa4776a45322dc6447e499edd92e865d49fb46b95ca7"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_selection_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "0ed3401d5b41ef95e96f1662da5d9c053ad67cadfe2990e2fd01c0ee180451d7"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_status_check",
      "type": "c",
      "validated": true,
      "definitionSha256": "5eb0abff21c0869a595cbff6212ad92cc09065a9a99a4c536d5b8726bee51ac0"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_status_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "777d325c7cfc2c75fd337658016e00da904d9de1198da80cc973f0654a473621"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_updated_at_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "85acee4d0e8f8bc395e6bac7d6c61b52547b7b9a33e62132df1d5ddaa61479c8"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_user_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "c6ea7ac3cce8e09c29b2d03a17cc56938d74bc153c4036c40eb2b7a6b0bb1e14"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_user_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "f1e5efd48d38e86b3914417bf450892b9182426168f134abb361ddd83dc0a746"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_work_id_fkey",
      "type": "f",
      "validated": true,
      "definitionSha256": "bab4f4dfe4ecf249f316e2aa690b4acf99306de1a6301f7bf057192afd29f445"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_work_id_not_null",
      "type": "n",
      "validated": true,
      "definitionSha256": "63e6d529ddeccdab60d7097269a9b70357913b4b61fec9709126c03e8ad4f801"
    }
  ],
  "indexes": [
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_batch_id_kind_target_id_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "fa8f33adb550d7e94e7979bd210642ffdec9e23c2b4cb4cf3a722f0fd92788a5"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_batch_id_position_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "a89dc028a82078b44ab2080c498a3641d028d90945ac76dae48ae18f7426b0ce"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_job",
      "unique": false,
      "valid": true,
      "definitionSha256": "13efb0e6d6c0f2571138d78f9e1efd7745265466366e1ff0cba910ed6b7a9f8b"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_next",
      "unique": false,
      "valid": true,
      "definitionSha256": "942d8c32deef67e6c3b60298dd7e1538bb577032312813e41edad7101e9dd5c8"
    },
    {
      "relation": "generation_batch_items",
      "name": "generation_batch_items_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_pkey",
      "unique": true,
      "valid": true,
      "definitionSha256": "55a464b837187b5adb9560fe4bd2be09e05ba4be6c64ce385fa08a6947b2c4d8"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_reconcile",
      "unique": false,
      "valid": true,
      "definitionSha256": "f4b1152e03c5c0bf5f56880c6594d60c74b6179f0c04c352dd832691b4137d86"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_request_key",
      "unique": true,
      "valid": true,
      "definitionSha256": "591e4ca9818271d9b7f2f86e297c44649fa320ff07cfedb86809bd3b29b170fa"
    },
    {
      "relation": "generation_batches",
      "name": "generation_batches_scope_created",
      "unique": false,
      "valid": true,
      "definitionSha256": "d2cd7e4a429d23d9b0a77194c0db13496634a95c88849834dcd2d752960a07fb"
    }
  ]
} as const;
