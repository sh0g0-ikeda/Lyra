import { describe, expect, it } from 'vitest';
import { ensureAllowedReferenceSourceKey } from '../../../../src/services/entity/EntityReferenceSourceKeyPolicy.js';

describe('ensureAllowedReferenceSourceKey', () => {
  it('allows owned temporary import images', () => {
    expect(() =>
      ensureAllowedReferenceSourceKey('tmp/user-1/entities/imports/source.png', 'user-1', 'entity-1'),
    ).not.toThrow();
  });

  it('rejects parent directory segments even under an allowed prefix', () => {
    expect(() =>
      ensureAllowedReferenceSourceKey('tmp/user-1/entities/imports/../source.png', 'user-1', 'entity-1'),
    ).toThrow('selected_s3_keys contains an invalid image source');
  });

  it('rejects Windows path separators even under an allowed prefix', () => {
    expect(() =>
      ensureAllowedReferenceSourceKey('session/user-1/entities/entity-1/..\\source.png', 'user-1', 'entity-1'),
    ).toThrow('selected_s3_keys contains an invalid image source');
  });
});
