import { describe, expect, it } from 'vitest';
import { buildEntityReferenceCandidateImageSource } from '../src/domain/entityReferenceCandidateImageSources';

const input = {
  apiBaseUrl: 'https://api.example.com/',
  authorizationHeader: 'Bearer private-token',
  candidateToken: 'opaque/token?secret=value',
  entityId: 'entity/with space',
  organizationId: 'organization/with space',
  revision: 'candidate-1',
  sessionKey: 'user/private',
};

describe('Entity reference candidate image source', () => {
  it('candidate tokenをURL encodeして認証付きpreviewを作る', () => {
    const source = buildEntityReferenceCandidateImageSource(input);

    expect(source.protectedSource).toEqual({
      cacheKey: source.identity,
      headers: { Authorization: 'Bearer private-token' },
      uri: 'https://api.example.com/api/entities/entity%2Fwith%20space/reference-candidate-image?candidate_token=opaque%2Ftoken%3Fsecret%3Dvalue&organization_id=organization%2Fwith+space',
    });
  });

  it('cache identityへtokenとAuthorizationを含めずscopeとrevisionを分離する', () => {
    const base = buildEntityReferenceCandidateImageSource(input);
    const variants = [
      { sessionKey: 'other-user' },
      { organizationId: null },
      { entityId: 'other-entity' },
      { revision: 'candidate-2' },
      { candidateToken: 'another-secret-token' },
    ];

    expect(base.identity).not.toContain('private-token');
    expect(base.identity).not.toContain('opaque');
    for (const variant of variants.slice(0, 4)) {
      expect(buildEntityReferenceCandidateImageSource({ ...input, ...variant }).identity)
        .not.toBe(base.identity);
    }
    expect(buildEntityReferenceCandidateImageSource({
      ...input,
      ...variants[4],
    }).identity).toBe(base.identity);
  });

  it('認証headerまたは有効なAPI URLがない場合はpreview sourceを作らない', () => {
    expect(buildEntityReferenceCandidateImageSource({
      ...input,
      authorizationHeader: null,
    }).protectedSource).toBeNull();
    expect(buildEntityReferenceCandidateImageSource({
      ...input,
      apiBaseUrl: 'not a url',
    }).protectedSource).toBeNull();
  });
});
