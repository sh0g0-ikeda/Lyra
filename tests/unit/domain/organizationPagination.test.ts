import { describe, expect, it } from 'vitest';
import { decodeOrganizationCollectionCursor, encodeOrganizationCollectionCursor, ORGANIZATION_COLLECTION_KINDS } from '../../../src/domain/organizationPagination.js';
import { ValidationError } from '../../../src/domain/errors/index.js';
const id = '11111111-1111-4111-8111-111111111111';
const sort = '2026-10-01T00:00:00.000Z';
const encode = (payload: unknown): string => Buffer.from(JSON.stringify(payload)).toString('base64url');
describe('organization production-v1 cursor codec', () => {
  it.each(ORGANIZATION_COLLECTION_KINDS)('round trips the exact deployed %s payload', (kind) => {
    const encoded = encodeOrganizationCollectionCursor(kind, sort, id);
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString())).toEqual({ v: 1, k: kind, sort, id });
    expect(decodeOrganizationCollectionCursor(encoded, kind)).toEqual({ sort, id });
  });
  it('rejects malformed, other-endpoint, extra-field, and invalid timestamp boundaries', () => {
    const base = { v: 1, k: 'organization-usage', sort, id };
    const invalid = ['', 'INVALID', '='.repeat(20), 'a'.repeat(1025), encode(base) + '=',
      encode({ ...base, k: 'organization-members' }), encode({ ...base, k: 'works' }),
      encode({ ...base, v: 2 }), encode({ ...base, organization_id: id }), encode({ ...base, id: 'bad' }), encode({ ...base, id: '00000000-0000-0000-0000-000000000000' }),
      encode({ ...base, sort: 1 }), encode({ ...base, sort: '2026-10-01T00:00:00Z' }),
      encode({ ...base, sort: '2026-02-30T00:00:00.000Z' }), encode({ ...base, sort: 'infinity' }),
    ];
    for (const value of invalid) expect(() => decodeOrganizationCollectionCursor(value, 'organization-usage')).toThrow(ValidationError);
  });
});
