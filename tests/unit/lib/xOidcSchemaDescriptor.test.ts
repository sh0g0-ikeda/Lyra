import { describe, expect, it } from 'vitest';
import { X_OIDC_SCHEMA } from '../../../src/lib/xOidcSchemaDescriptor.js';

describe('X OIDC schema descriptor', () => {
  it('052 migrationが所有するtable・列・制約・indexを過不足なく固定する', () => {
    expect(X_OIDC_SCHEMA.relations).toEqual([
      { name: 'x_oidc_artifacts', kind: 'r', rowSecurity: false, forceRowSecurity: false },
    ]);
    expect(X_OIDC_SCHEMA.columns.map(({ name }) => name)).toEqual([
      'kind',
      'token_hash',
      'binding_hash',
      'payload_ciphertext',
      'proof_hash',
      'attempts',
      'expires_at',
      'created_at',
    ]);
    expect(X_OIDC_SCHEMA.constraints.map(({ name }) => name)).toEqual([
      'x_oidc_artifacts_attempts_check',
      'x_oidc_artifacts_attempts_not_null',
      'x_oidc_artifacts_binding_hash_not_null',
      'x_oidc_artifacts_created_at_not_null',
      'x_oidc_artifacts_expires_at_not_null',
      'x_oidc_artifacts_kind_check',
      'x_oidc_artifacts_kind_not_null',
      'x_oidc_artifacts_payload_ciphertext_not_null',
      'x_oidc_artifacts_pkey',
      'x_oidc_artifacts_token_hash_check',
      'x_oidc_artifacts_token_hash_not_null',
    ]);
    expect(X_OIDC_SCHEMA.indexes.map(({ name }) => name)).toEqual([
      'x_oidc_artifacts_expiry_idx',
      'x_oidc_artifacts_pkey',
    ]);
  });
});
