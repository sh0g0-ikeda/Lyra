import { describe, expect, it } from 'vitest';

import type { PageRecord } from '@/domain/types';
import {
  buildFullPageImageSource,
  buildFullPageImageSources,
  buildPageThumbnailImageSource,
  buildPageThumbnailImageSources,
} from '@/domain/pageImageSources';

const page: PageRecord = {
  id: 'page-1',
  episode_id: 'episode-1',
  page_number: 1,
  layout_config: {},
  story_source_scene_ids: [],
  story_page_purpose: null,
  story_continuity_note: null,
  dialogue_mode: 'image_baked',
  page_dialogue_toggle: true,
  generation_mode: 'standard',
  generated_image: {
    generation_mode: 'standard',
    generated_at: '2026-07-25T00:00:00.000Z',
    cdn_url: 'https://cdn.lyra.test/full-page.png?Signature=signed',
  },
  status: 'generated',
  panel_count: 4,
  frame_count: 4,
  balloon_count: 0,
  created_at: '2026-07-25T00:00:00.000Z',
  updated_at: '2026-07-25T00:00:00.000Z',
};

describe('page image sources', () => {
  it('原寸画像はCDN、認証付き原寸、認証付きサムネイルの順で候補を返す', () => {
    const sources = buildFullPageImageSources({
      apiBaseUrl: 'https://app.lyra-editor.com',
      authorizationHeader: 'Bearer token',
      organizationId: 'organization-1',
      page,
      sessionKey: 'user-1',
    });

    expect(sources).toHaveLength(3);
    expect(sources[0]).toMatchObject({
      uri: 'https://cdn.lyra.test/full-page.png?Signature=signed',
    });
    expect(sources[0]?.headers).toBeUndefined();
    expect(sources[1]?.uri).toContain('/api/pages/page-1/export-image?organization_id=organization-1');
    expect(sources[1]?.headers).toEqual({ Authorization: 'Bearer token' });
    expect(sources[2]?.uri).toContain('/api/pages/page-1/thumbnail?organization_id=organization-1');
    expect(sources[2]?.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('一覧画像は認証付きサムネイル失敗時にCDNと原寸APIへ退避できる', () => {
    const sources = buildPageThumbnailImageSources({
      apiBaseUrl: 'https://app.lyra-editor.com',
      authorizationHeader: 'Bearer token',
      organizationId: null,
      page,
      sessionKey: 'user-1',
    });

    expect(sources).toHaveLength(3);
    expect(sources[0]?.uri).toContain('/api/pages/page-1/thumbnail?');
    expect(sources[0]?.headers).toEqual({ Authorization: 'Bearer token' });
    expect(sources[1]).toMatchObject({
      uri: 'https://cdn.lyra.test/full-page.png?Signature=signed',
    });
    expect(sources[2]?.uri).toContain('/api/pages/page-1/export-image?');
    expect(sources[2]?.headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('選択ページのfull画像だけ署名済みCDN URLを使う', () => {
    const source = buildFullPageImageSource({
      apiBaseUrl: 'https://app.lyra-editor.com',
      authorizationHeader: 'Bearer token',
      organizationId: 'organization-1',
      page,
      sessionKey: 'user-1',
    });

    expect(source).toEqual({
      uri: 'https://cdn.lyra.test/full-page.png?Signature=signed',
      cacheKey:
        'page-image:full:user-1:organization-1:page-1:2026-07-25T00%3A00%3A00.000Z',
    });
  });

  it('一覧thumbnailはCDN原画像ではなく専用認証endpointを使う', () => {
    const source = buildPageThumbnailImageSource({
      apiBaseUrl: 'https://app.lyra-editor.com/',
      authorizationHeader: 'Bearer token',
      organizationId: 'organization-1',
      page,
      sessionKey: 'user-1',
    });

    expect(source.uri).toMatch(
      /^https:\/\/app\.lyra-editor\.com\/api\/pages\/page-1\/thumbnail\?organization_id=organization-1&image_revision=2026-07-25T00%3A00%3A00\.000Z&image_scope=[0-9a-f]{8}$/u,
    );
    expect(source.uri).not.toContain('full-page.png');
    expect(source.headers).toEqual({ Authorization: 'Bearer token' });
    expect(source.cacheKey).toBe(
      'page-image:thumbnail:user-1:organization-1:page-1:2026-07-25T00%3A00%3A00.000Z',
    );
  });

  it('CDN URLがないfull画像はexport endpointへ安全にfallbackする', () => {
    const source = buildFullPageImageSource({
      apiBaseUrl: 'https://app.lyra-editor.com',
      authorizationHeader: 'Bearer token',
      organizationId: null,
      page: {
        ...page,
        generated_image: {
          ...page.generated_image!,
          cdn_url: null,
        },
      },
      sessionKey: 'user-1',
    });

    expect(source.uri).toContain('/api/pages/page-1/export-image?image_revision=');
    expect(source.headers).toEqual({ Authorization: 'Bearer token' });
  });
});
