// Generated from isolated PostgreSQL 18.3 with migration 052; never copied from production.
export const X_OIDC_SCHEMA = {
  relations: [
    { name: 'x_oidc_artifacts', kind: 'r', rowSecurity: false, forceRowSecurity: false },
  ],
  columns: [
    { relation: 'x_oidc_artifacts', name: 'kind', type: 'text', nullable: false, defaultExpressionSha256: null, identityGeneration: null, generatedExpressionSha256: null },
    { relation: 'x_oidc_artifacts', name: 'token_hash', type: 'text', nullable: false, defaultExpressionSha256: null, identityGeneration: null, generatedExpressionSha256: null },
    { relation: 'x_oidc_artifacts', name: 'binding_hash', type: 'text', nullable: false, defaultExpressionSha256: null, identityGeneration: null, generatedExpressionSha256: null },
    { relation: 'x_oidc_artifacts', name: 'payload_ciphertext', type: 'text', nullable: false, defaultExpressionSha256: null, identityGeneration: null, generatedExpressionSha256: null },
    { relation: 'x_oidc_artifacts', name: 'proof_hash', type: 'text', nullable: true, defaultExpressionSha256: null, identityGeneration: null, generatedExpressionSha256: null },
    { relation: 'x_oidc_artifacts', name: 'attempts', type: 'smallint', nullable: false, defaultExpressionSha256: '5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9', identityGeneration: null, generatedExpressionSha256: null },
    { relation: 'x_oidc_artifacts', name: 'expires_at', type: 'timestamp with time zone', nullable: false, defaultExpressionSha256: null, identityGeneration: null, generatedExpressionSha256: null },
    { relation: 'x_oidc_artifacts', name: 'created_at', type: 'timestamp with time zone', nullable: false, defaultExpressionSha256: '28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f', identityGeneration: null, generatedExpressionSha256: null },
  ],
  constraints: [
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_attempts_check', type: 'c', validated: true, definitionSha256: 'f01bf385313798044e7a609bd77c550ddc611c1e858ac32f5823de522ae3dd56' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_attempts_not_null', type: 'n', validated: true, definitionSha256: '458f52eebb9bb2e71adeb5c6d49d48da03a609dd1b34a88901878b1a425c9d0c' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_binding_hash_not_null', type: 'n', validated: true, definitionSha256: '8475838bb42bbb1b7931ff23b7c7fc6f79ba648a1c7a2294ecdbdada4e4e74d2' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_created_at_not_null', type: 'n', validated: true, definitionSha256: '2af743a020ee4a6018285c0ec6165c67ece56507fc3276ac26cc9ac85ac9e55b' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_expires_at_not_null', type: 'n', validated: true, definitionSha256: '329142b25e122eb9bffaebec0ddb2fa7d97b2fd540f53264567c6bf9a1c10526' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_kind_check', type: 'c', validated: true, definitionSha256: '8b147d1738b3ab9e099653b3ac1bbb20306bce46bde33b3e033a4344cc626954' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_kind_not_null', type: 'n', validated: true, definitionSha256: 'fad9a10b91a3fbeafe30a0577b442553c1986b3244368a78ac1323ce02015690' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_payload_ciphertext_not_null', type: 'n', validated: true, definitionSha256: '557cf580fa58a9304f4823029c45149feb0983124b1e960c3a3dfa73b1760a01' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_pkey', type: 'p', validated: true, definitionSha256: '7f83f75b65dd247eb758ad77d9b5190a252f88c20bf7f4c5da02cf168fbe4334' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_token_hash_check', type: 'c', validated: true, definitionSha256: '2919afca2f09a97baba71c33a2a8a51e63c1565275b735ce2237468ebb57af5f' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_token_hash_not_null', type: 'n', validated: true, definitionSha256: '40a276cf83adfca12a75fd129a63acafa8cde0a297d146fcae8da6e96a936243' },
  ],
  indexes: [
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_expiry_idx', unique: false, valid: true, definitionSha256: 'a8cf4c1d18366a726e2e70fbf3977cb3be789a01bee786d40f5ed85a43432394' },
    { relation: 'x_oidc_artifacts', name: 'x_oidc_artifacts_pkey', unique: true, valid: true, definitionSha256: '96975dc6bcdf1adbe30bc909d875f43f4c46a55812530170ffae8a7105575804' },
  ],
} as const;
