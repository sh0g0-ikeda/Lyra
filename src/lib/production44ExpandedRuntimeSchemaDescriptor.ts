// Exact PG18 actual44 + forward additions; local-only fixture rebuild.
export const PRODUCTION44_EXPANSION_MIGRATIONS = [
  {
    "filename": "040_add_entity_state_variants.sql",
    "sha256": "d918c657ec41bd4a7179c58d2691e307c2b55418ae57cae264d4194dc551e22f"
  },
  {
    "filename": "041_add_episode_starting_entity_states.sql",
    "sha256": "ae96958e42ecf6cafa6366e749e620a47c95b98bde2108131b2ffebe22414dba"
  },
  {
    "filename": "042_add_generation_quotes.sql",
    "sha256": "1e7fb0392e4a4f833d47cd60114a37713f9e6b6df70c51323ec52242606c2c43"
  },
  {
    "filename": "043_add_quoted_import_analysis_jobs.sql",
    "sha256": "78c65d6985c0c9be19ef594300b508c3032f3e0dcacb8fadab20855c7df77633"
  },
  {
    "filename": "044_add_google_identity_link_challenges.sql",
    "sha256": "bfc1db62d6e78d5f5fc65d7c1506caf1f964f82e9f15249f82cf6439c156f42e"
  },
  {
    "filename": "045_add_mobile_subscription_scheduled_plan_compatibility.sql",
    "sha256": "063e7f19315fa7598d032da40146af0468e0c2e2ebf4d95854315d013f481ff9"
  },
  {
    "filename": "047_add_state_reference_copy_attempts.sql",
    "sha256": "237895e0b53d67ad1f6cc2cf911f4ebcf758a901b28c922b565715ef6fb58edb"
  },
  {
    "filename": "048_advance_entity_state_revision_for_legacy_writers.sql",
    "sha256": "d7553c0f6b7cc5416d1735fd3396942cd49d9b1251e410cf406ec984ffc362c0"
  },
  {
    "filename": "049_add_stripe_credit_recovery.sql",
    "sha256": "74af9b0ab85ff01eb7920fc293a17c71a1532a74db829b01e6a064c73beae855"
  },
  {
    "filename": "050_add_work_deletion.sql",
    "sha256": "890aad36e5aaa2b743ffc671205b5d07cb9802b70f59b05391c03f96b42ae0b4"
  }
] as const;
export const PRODUCTION44_EXPANSION_CHECKPOINTS = [
  {
    "migrationFilenames": "051fb45aae678725ac4a0910753977a72e06273d3f561eb5ceaf4fa19ea330d1",
    "relations": "3c1d535b0ce6e2a73b0a653514308e4d7cd5dfb8f81a53612a9cc61b9eaaada2",
    "namespaceArtifacts": "c8ba636537b52f6977eaa0d445d12a9c4d2937633d177471c8c158ea58a6b889",
    "columns": "bcb489b391369c6db3267afffa3a7b33c0079d0c9eb7a8e0aa8ec189b94c8b91",
    "constraints": "9f7d2650a249e32d769238a99908ff07d81b5b4c2066847dc11089f3c4b76953",
    "indexes": "ea3780f7aabed2c4a469c390aaa715c3c5146d32eab584a3ce7355a172ee80a1",
    "triggers": "1b3ebf9cb148b88fc84fbf4b3ba890d8bc55c21393fb565ecc926e957c86fabd",
    "functions": "0968c652abf99765ba6949f7aaf9f09c5508cb4c3220b74f1a89f2ee030bfeeb"
  },
  {
    "migrationFilenames": "3f85d850f0511210c3e84095559884b749d7e207673eb1de38b8cbe143783023",
    "relations": "3c1d535b0ce6e2a73b0a653514308e4d7cd5dfb8f81a53612a9cc61b9eaaada2",
    "namespaceArtifacts": "c8ba636537b52f6977eaa0d445d12a9c4d2937633d177471c8c158ea58a6b889",
    "columns": "aee25a959bb273bc4cd6649092da4a469727da885b1265ac8366eac5da596c34",
    "constraints": "7391599b8af477d9a030f091e59ac4afc9a6bd89cac61fba1600d6a57fb881ef",
    "indexes": "ea3780f7aabed2c4a469c390aaa715c3c5146d32eab584a3ce7355a172ee80a1",
    "triggers": "1b3ebf9cb148b88fc84fbf4b3ba890d8bc55c21393fb565ecc926e957c86fabd",
    "functions": "0968c652abf99765ba6949f7aaf9f09c5508cb4c3220b74f1a89f2ee030bfeeb"
  },
  {
    "migrationFilenames": "d129ef0a8efdb308d96314702e26e555ad671e9d17ce2fb977637fb5fbb32306",
    "relations": "3c1d535b0ce6e2a73b0a653514308e4d7cd5dfb8f81a53612a9cc61b9eaaada2",
    "namespaceArtifacts": "c8ba636537b52f6977eaa0d445d12a9c4d2937633d177471c8c158ea58a6b889",
    "columns": "399b1ca9c60fc9c5f8ebd124c6f51600ed887903816b11b267d1f32b98315b36",
    "constraints": "1ecd1dd7de5dc2506850a7b8f280f5cb9b76498c672590ac417d7207d0b18428",
    "indexes": "ea3780f7aabed2c4a469c390aaa715c3c5146d32eab584a3ce7355a172ee80a1",
    "triggers": "1b3ebf9cb148b88fc84fbf4b3ba890d8bc55c21393fb565ecc926e957c86fabd",
    "functions": "0968c652abf99765ba6949f7aaf9f09c5508cb4c3220b74f1a89f2ee030bfeeb"
  },
  {
    "migrationFilenames": "f32779db013ba9cdbc6adf4bb38b3986480bde7a95be7e5582611ae1cbb6574b",
    "relations": "a80141ee5e38b2f7c888f7ef7f37cf51a1913479090403ccfcdd12538145eed8",
    "namespaceArtifacts": "c8ba636537b52f6977eaa0d445d12a9c4d2937633d177471c8c158ea58a6b889",
    "columns": "18a07b74c8fb976ddfb0938c1e604ea4558dbb64a7448950e7a0a37da6d999c6",
    "constraints": "e30eec1c7cbe934e50c3096561960d0fb9da3a22ed0a660548869724d93809a5",
    "indexes": "8500bc9c9c4b17ff66e1699de1a21d95003303a102454e6ffcc7bf57bd5d2cea",
    "triggers": "1b3ebf9cb148b88fc84fbf4b3ba890d8bc55c21393fb565ecc926e957c86fabd",
    "functions": "0968c652abf99765ba6949f7aaf9f09c5508cb4c3220b74f1a89f2ee030bfeeb"
  },
  {
    "migrationFilenames": "c991340ce06cf5ca75124a588e53a744e71fc9d03896ef32be3073cdbe32f277",
    "relations": "a80141ee5e38b2f7c888f7ef7f37cf51a1913479090403ccfcdd12538145eed8",
    "namespaceArtifacts": "c8ba636537b52f6977eaa0d445d12a9c4d2937633d177471c8c158ea58a6b889",
    "columns": "18a07b74c8fb976ddfb0938c1e604ea4558dbb64a7448950e7a0a37da6d999c6",
    "constraints": "9e642faee93693ebb701dce5434c3ec20c8aedd48904cfee52247ba696c54159",
    "indexes": "8500bc9c9c4b17ff66e1699de1a21d95003303a102454e6ffcc7bf57bd5d2cea",
    "triggers": "1b3ebf9cb148b88fc84fbf4b3ba890d8bc55c21393fb565ecc926e957c86fabd",
    "functions": "0968c652abf99765ba6949f7aaf9f09c5508cb4c3220b74f1a89f2ee030bfeeb"
  },
  {
    "migrationFilenames": "5c0ce2a2565243dd3257baca466c2e693b44a9e6bcaec907c6bf77e86cc58afd",
    "relations": "449790d55f76937c788493d707f394a002bd9a3f75f0c3e54b056c9412e6189f",
    "namespaceArtifacts": "167968b38a08242b997f99dc2ef0110a0c9387ad30db9fdc87d474e04ecd19a2",
    "columns": "085a9b8531b699955a014fea8004ed92d6f8220acf997ded7b91f8cf1b94f5eb",
    "constraints": "8ef7b78ba0ad1da91366ce1590d455ec3ad342d4160766311f80ce7738fea00b",
    "indexes": "1e99aca45d8b5691a4013b09896692a2f998e7eb294787da7322afa846ade9af",
    "triggers": "aba4f87aec6b1cd98a66e55cbedcb1ead356506ef936521e9b45ad11f2edb31e",
    "functions": "f6f5a05f3d6c5ecc417acc5b56eb1a8994dfb5060543bf089023d1c614846c79"
  },
  {
    "migrationFilenames": "01e4d30b7371efd07beb5037caf6286f3f209175663ec6cd819a457d2ce6d426",
    "relations": "449790d55f76937c788493d707f394a002bd9a3f75f0c3e54b056c9412e6189f",
    "namespaceArtifacts": "167968b38a08242b997f99dc2ef0110a0c9387ad30db9fdc87d474e04ecd19a2",
    "columns": "085a9b8531b699955a014fea8004ed92d6f8220acf997ded7b91f8cf1b94f5eb",
    "constraints": "8ef7b78ba0ad1da91366ce1590d455ec3ad342d4160766311f80ce7738fea00b",
    "indexes": "1e99aca45d8b5691a4013b09896692a2f998e7eb294787da7322afa846ade9af",
    "triggers": "aba4f87aec6b1cd98a66e55cbedcb1ead356506ef936521e9b45ad11f2edb31e",
    "functions": "f6f5a05f3d6c5ecc417acc5b56eb1a8994dfb5060543bf089023d1c614846c79"
  },
  {
    "migrationFilenames": "2dcc464365e626bb971efc3549083b3df18f017cb65f9b011ef08c43e09d3e27",
    "relations": "d231fc4abc72e4760c1dee6af5362e6beb8eb0d05949c80d84df31d43d268467",
    "namespaceArtifacts": "7eb9b86ba4a3d9d7c9aec3b006813ae042adf2258178a04c15026b40f4a0d853",
    "columns": "8157b5e46aeed72054ee77fbe246dd83a18109e5b5ef88e6f5c053cb401a74ab",
    "constraints": "51f751a05663142a0ba0ec4b9be352168337bee5ff558b1a4a68b65c53209e70",
    "indexes": "f481d845bb32ef6bd5c7475e3afe1e7d4eeacc2033a11267b0a6c442d452c4be",
    "triggers": "4a7174dc18311820cf88432e5005b059409a375cf9e39d518c64b2cc621eee36",
    "functions": "b02ab45044d12ff56bd3706db24ac6279f300d2dd428feb3e82a4107542f37da"
  },
  {
    "migrationFilenames": "c04bc9165800fff85a6be5de3dd0f6ffad859bd8bb2657c4c13afd6aea9f398d",
    "relations": "d231fc4abc72e4760c1dee6af5362e6beb8eb0d05949c80d84df31d43d268467",
    "namespaceArtifacts": "ff065c4c1f98c7f1a7c6f63c010026d79233ab35cdcaaf993cf1ecf9f6fb758d",
    "columns": "8157b5e46aeed72054ee77fbe246dd83a18109e5b5ef88e6f5c053cb401a74ab",
    "constraints": "51f751a05663142a0ba0ec4b9be352168337bee5ff558b1a4a68b65c53209e70",
    "indexes": "f481d845bb32ef6bd5c7475e3afe1e7d4eeacc2033a11267b0a6c442d452c4be",
    "triggers": "0cb560a9a2008aa602fa4a9032d92b9e601c6df954c87935b070a72ce907d344",
    "functions": "7a23857e36eb5babb8b37f88bbced5f3d29e2771564e8e927a607ab171c16b1c"
  },
  {
    "migrationFilenames": "483aed9bd3ee6fb970486e3f34d789a9d3a70ac34453cd59bd6882733e58a16b",
    "relations": "085b53cff10331708b44f58798f5d481e20067abbddf07f3aa2eb2150b8ebb93",
    "namespaceArtifacts": "ff065c4c1f98c7f1a7c6f63c010026d79233ab35cdcaaf993cf1ecf9f6fb758d",
    "columns": "1775e17bc4512494864452d35d60b8c7ac736f77b4a511d70f7551f70d0b23ea",
    "constraints": "202ee17152d87031af48380ff63e066c660e2588168f61ab51d0b7d04347af16",
    "indexes": "90c71972db007893dfc763f83e1bcf9ca8046602081e4fe78730e53dad95527f",
    "triggers": "0cb560a9a2008aa602fa4a9032d92b9e601c6df954c87935b070a72ce907d344",
    "functions": "7a23857e36eb5babb8b37f88bbced5f3d29e2771564e8e927a607ab171c16b1c"
  },
  {
    "migrationFilenames": "204ecda344c3cfbd3af019ee7e5a200965aa7cc575fe2863f197e40a36418d20",
    "relations": "f150850d5587f56107331c7eff5a9dee592a77e000af7ab565597f4a57571a7e",
    "namespaceArtifacts": "c8b1385850ce1082bebdacdafa1db3d1fddffd4d2bacd0c1c052622716fc3294",
    "columns": "a731e65053c5bc27a9ac898e80e4041d812fd9e7776805c68675e972d71a36ce",
    "constraints": "5e8542900469dfc800a7059ca2bb53b12e351574f930754de910e7fbc187bcf0",
    "indexes": "5de38037ad90b7e0482ecf546a2d635ff9fdbd0c9a4c5838e94ebaf4e552c328",
    "triggers": "59c52163f89e91834d5e98ca0c165686f0c91cf665f332de382c1d96bed3ea1c",
    "functions": "60fc9377b0b895615316b9b2da975bb2f394493bfb197cb50b4b3fa80e4265a5"
  }
] as const;
