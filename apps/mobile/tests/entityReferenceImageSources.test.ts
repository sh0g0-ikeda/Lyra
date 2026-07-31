import { describe, expect, it } from 'vitest';
import { buildEntityReferenceImageSources } from '../src/domain/entityReferenceImageSources';

const baseInput = {
  apiBaseUrl: 'https://api.example.com/',
  authorizationHeader: 'Bearer private-token',
  cdnUrl: 'https://cdn.example.com/reference.png?Signature=base-signed',
  entityId: 'entity/with space',
  organizationId: 'organization/with space',
  refId: 'reference/with space',
  revision: '2026-08-01T00:00:00.000Z',
  sessionKey: 'user/private',
};

describe('Entity reference image sources', () => {
  it('HTTPS署名URLを優先し、認証付きexportをfallbackにする', () => {
    const sources = buildEntityReferenceImageSources({
      ...baseInput,
      cdnUrl: 'https://cdn.example.com/reference.png?Signature=signed-secret',
    });

    expect(sources.publicSource).toEqual({
      cacheKey: expect.stringContaining('entity-reference-image:'),
      uri: 'https://cdn.example.com/reference.png?Signature=signed-secret',
    });
    expect(sources.protectedSource).toEqual(expect.objectContaining({
      headers: { Authorization: 'Bearer private-token' },
      uri: 'https://api.example.com/api/entities/entity%2Fwith%20space/reference/reference%2Fwith%20space/image?organization_id=organization%2Fwith+space',
    }));
    expect(sources.identity).not.toContain('private-token');
    expect(sources.identity).not.toContain('signed-secret');
    expect(sources.publicSource?.cacheKey).not.toContain('signed-secret');
  });

  it('空・HTTP・不正なCDN URLは使わず認証付きsourceだけを残す', () => {
    for (const cdnUrl of [undefined, '', 'http://cdn.example.com/image.png', 'not a url']) {
      const sources = buildEntityReferenceImageSources({
        ...baseInput,
        cdnUrl,
        organizationId: null,
      });

      expect(sources.publicSource).toBeNull();
      expect(sources.protectedSource?.uri).toBe(
        'https://api.example.com/api/entities/entity%2Fwith%20space/reference/reference%2Fwith%20space/image',
      );
    }
  });

  it('認証headerがない場合はprotected endpointを裸で公開しない', () => {
    const sources = buildEntityReferenceImageSources({
      ...baseInput,
      authorizationHeader: null,
      cdnUrl: undefined,
    });

    expect(sources).toEqual(expect.objectContaining({
      publicSource: null,
      protectedSource: null,
    }));
  });

  it('session・workspace・Entity・reference・revisionをcache identityで分離する', () => {
    const identity = buildEntityReferenceImageSources(baseInput).identity;
    const variants = [
      { sessionKey: 'another-user' },
      { organizationId: null },
      { entityId: 'another-entity' },
      { refId: 'another-reference' },
      { revision: '2026-08-02T00:00:00.000Z' },
    ];

    for (const variant of variants) {
      const sources = buildEntityReferenceImageSources({ ...baseInput, ...variant });
      expect(sources.identity).not.toBe(identity);
      expect(sources.publicSource?.cacheKey).not.toBe(
        buildEntityReferenceImageSources(baseInput).publicSource?.cacheKey,
      );
    }
  });
});
