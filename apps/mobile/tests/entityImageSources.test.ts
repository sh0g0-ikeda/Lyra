import { describe, expect, it } from 'vitest';

import { buildEntityReferenceImageSources } from '@/domain/entityImageSources';

describe('entity image sources', () => {
  it('確定画像は署名済みCDNから認証付きAPIへ退避する', () => {
    const sources = buildEntityReferenceImageSources({
      apiBaseUrl: 'https://app.lyra-editor.com',
      authorizationHeader: 'Bearer token',
      entityId: 'entity-1',
      organizationId: 'organization-1',
      reference: {
        ref_id: 'reference-1',
        cdn_url: 'https://cdn.lyra.test/reference.png?Signature=signed',
        source: 'generated',
        created_at: '2026-07-26T00:00:00.000Z'
      },
      revision: '2026-07-26T00:00:00.000Z',
      sessionKey: 'user-1'
    });

    expect(sources).toEqual([
      {
        uri: 'https://cdn.lyra.test/reference.png?Signature=signed'
      },
      {
        cacheKey:
          'entity-reference-image:user-1:organization-1:entity-1:reference-1:2026-07-26T00%3A00%3A00.000Z',
        uri: expect.stringMatching(
          /\/api\/entities\/entity-1\/reference\/reference-1\/image\?organization_id=organization-1&image_revision=.*&image_scope=[0-9a-f]{8}$/u
        ),
        headers: { Authorization: 'Bearer token' }
      }
    ]);
  });

  it('CDN URLがない場合も認証付きAPIを表示候補に残す', () => {
    const sources = buildEntityReferenceImageSources({
      apiBaseUrl: 'https://app.lyra-editor.com',
      authorizationHeader: null,
      entityId: 'entity-1',
      organizationId: null,
      reference: {
        ref_id: 'reference-1',
        source: 'upload',
        created_at: '2026-07-26T00:00:00.000Z'
      },
      revision: '2026-07-26T00:00:00.000Z',
      sessionKey: 'user-1'
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.uri).toContain(
      '/api/entities/entity-1/reference/reference-1/image?image_revision='
    );
    expect(sources[0]?.headers).toBeUndefined();
  });
});
