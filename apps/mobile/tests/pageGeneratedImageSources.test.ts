import { describe, expect, it } from 'vitest';
import {
  buildPageGeneratedImageSources,
  refreshPageGeneratedImageSource,
} from '../src/domain/pageGeneratedImageSources';

const baseInput = {
  apiBaseUrl: 'https://api.example.com/',
  authorizationHeader: 'Bearer secret-token',
  cdnUrl: 'https://cdn.example.com/page.png?Policy=signed',
  episodeId: '11111111-1111-4111-8111-111111111111',
  generatedAt: '2026-08-01T01:00:00.000Z',
  organizationId: '22222222-2222-4222-8222-222222222222',
  pageId: '33333333-3333-4333-8333-333333333333',
  sessionKey: 'session-user',
};

describe('pageGeneratedImageSources', () => {
  it('signed HTTPSと認証付きPage exportを同じresource identityへ構築する', () => {
    const sources = buildPageGeneratedImageSources(baseInput);

    expect(sources.publicSource).toEqual({
      cacheKey: `${sources.identity}:public`,
      uri: baseInput.cdnUrl,
    });
    expect(sources.protectedSource).toEqual({
      cacheKey: sources.identity,
      headers: { Authorization: 'Bearer secret-token' },
      uri: `https://api.example.com/api/pages/${baseInput.pageId}/export-image?organization_id=${baseInput.organizationId}`,
    });
    expect(sources.identity).not.toContain('secret-token');
  });

  it('非HTTPS CDN URLを使わず認証付きexportへ限定する', () => {
    const sources = buildPageGeneratedImageSources({
      ...baseInput,
      cdnUrl: 'http://cdn.example.com/page.png',
    });

    expect(sources.publicSource).toBeNull();
    expect(sources.protectedSource?.uri).toContain('/export-image');
  });

  it('session・workspace・Episode・Page・生成revisionごとにcache identityを分離する', () => {
    const identity = buildPageGeneratedImageSources(baseInput).identity;
    for (const variant of [
      { sessionKey: 'other-session' },
      { organizationId: null },
      { episodeId: '44444444-4444-4444-8444-444444444444' },
      { pageId: '55555555-5555-4555-8555-555555555555' },
      { generatedAt: '2026-08-01T02:00:00.000Z' },
    ]) {
      expect(buildPageGeneratedImageSources({ ...baseInput, ...variant }).identity).not.toBe(identity);
    }
    expect(buildPageGeneratedImageSources({
      ...baseInput,
      authorizationHeader: 'Bearer rotated-token',
    }).identity).toBe(identity);
  });

  it('認証更新時はURIを変えずheaderとmemory cache keyだけを更新する', () => {
    const protectedSource = buildPageGeneratedImageSources(baseInput).protectedSource;
    expect(protectedSource).not.toBeNull();

    expect(refreshPageGeneratedImageSource(protectedSource!, 'Bearer refreshed-token')).toEqual({
      ...protectedSource,
      cacheKey: `${protectedSource!.cacheKey}:refreshed`,
      headers: { Authorization: 'Bearer refreshed-token' },
    });
  });
});
