import { describe, expect, it } from 'vitest';

import {
  buildPageImageCacheKey,
  resolvePageImageDelivery,
  withPageImageRevision
} from '../src/domain/pageImageCache';

describe('page image cache identity', () => {
  it('user、workspace、page、revision をすべて cache key に含める', () => {
    expect(
      buildPageImageCacheKey({
        sessionKey: 'user-1',
        organizationId: 'org-1',
        pageId: 'page-1',
        revision: '2026-07-25T00:00:00.000Z'
      })
    ).toBe('page-image:full:user-1:org-1:page-1:2026-07-25T00%3A00%3A00.000Z');
  });

  it('personal workspace と organization workspace を分離する', () => {
    const personal = buildPageImageCacheKey({
      sessionKey: 'user-1',
      organizationId: null,
      pageId: 'page-1',
      revision: 'rev-1'
    });
    const organization = buildPageImageCacheKey({
      sessionKey: 'user-1',
      organizationId: 'org-1',
      pageId: 'page-1',
      revision: 'rev-1'
    });
    expect(personal).not.toBe(organization);
  });

  it('authenticated URL に revision query を安全に追加する', () => {
    expect(
      withPageImageRevision(
        'https://app.lyra-editor.com/api/pages/page-1/export-image?organization_id=org-1',
        '2026-07-25T00:00:00.000Z',
        'page-image:user-1:org-1:page-1:revision-1'
      )
    ).toMatch(
      /^https:\/\/app\.lyra-editor\.com\/api\/pages\/page-1\/export-image\?organization_id=org-1&image_revision=2026-07-25T00%3A00%3A00\.000Z&image_scope=[0-9a-f]{8}$/
    );
  });

  it('一覧の署名済みCDN URLを加工せずに優先する', () => {
    const signedUrl = 'https://cdn.lyra.test/page.png?Policy=signed&Signature=value';

    expect(
      resolvePageImageDelivery({
        cdnUrl: signedUrl,
        authenticatedFallbackUrl: 'https://api.lyra.test/api/pages/page-1/export-image'
      })
    ).toEqual({
      uri: signedUrl,
      requiresAuthentication: false
    });
  });

  it('CDN URLがない場合だけ認証付きexport URLへ戻る', () => {
    expect(
      resolvePageImageDelivery({
        cdnUrl: null,
        authenticatedFallbackUrl: 'https://api.lyra.test/api/pages/page-1/export-image'
      })
    ).toEqual({
      uri: 'https://api.lyra.test/api/pages/page-1/export-image',
      requiresAuthentication: true
    });
  });
});
