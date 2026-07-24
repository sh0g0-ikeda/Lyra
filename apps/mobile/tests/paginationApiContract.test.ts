import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  organizationAuditLogsResponseSchema,
  organizationInvitationsResponseSchema,
  organizationMembersResponseSchema,
  organizationUsageResponseSchema,
  worksResponseSchema,
} from '@/domain/apiSchemas';
import { LyraMobileApiClient } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('paginated API contract', () => {
  it('cursorをnullable文字列として検証し、旧レスポンスはnullへ正規化する', () => {
    expect(worksResponseSchema.parse({ works: [] })).toEqual({
      works: [],
      next_cursor: null,
    });
    expect(() => worksResponseSchema.parse({ works: [], next_cursor: 1 })).toThrow();
    expect(organizationMembersResponseSchema.parse({ members: [], next_cursor: null }))
      .toMatchObject({ next_cursor: null });
    expect(organizationInvitationsResponseSchema.parse({ invitations: [], next_cursor: null }))
      .toMatchObject({ next_cursor: null });
    expect(
      organizationUsageResponseSchema.parse({
        usage_events: [],
        next_cursor: null,
        summary: {
          current_month_total_credits: 0,
          by_member: [],
          by_work: [],
          by_generation_type: [],
        },
      }),
    ).toMatchObject({ next_cursor: null });
    expect(organizationAuditLogsResponseSchema.parse({ audit_logs: [], next_cursor: null }))
      .toMatchObject({ next_cursor: null });
  });

  it('全一覧APIでlimit・cursor・organization scopeを安全に構築する', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const common = { next_cursor: 'next-page' };
      let body: unknown;
      if (url.includes('/members')) {
        body = { ...common, members: [] };
      } else if (url.includes('/invitations')) {
        body = { ...common, invitations: [] };
      } else if (url.includes('/usage')) {
        body = {
          ...common,
          usage_events: [],
          summary: {
            current_month_total_credits: 0,
            by_member: [],
            by_work: [],
            by_generation_type: [],
          },
        };
      } else if (url.includes('/audit-logs')) {
        body = { ...common, audit_logs: [] };
      } else if (url.includes('/entities')) {
        body = { ...common, entities: [] };
      } else if (url.includes('/pages')) {
        body = { ...common, pages: [] };
      } else {
        body = { ...common, works: [] };
      }
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');
    const page = { cursor: 'opaque/cursor', limit: 40 };

    await expect(
      client.getWorksPage({ ...page, organizationId: 'organization-1' }),
    ).resolves.toMatchObject({ next_cursor: 'next-page' });
    await client.getEntitiesPage('work-1', { ...page, organizationId: 'organization-1' });
    await client.getPagesPage('episode-1', { ...page, organizationId: 'organization-1' });
    await client.getOrganizationMembersPage('organization-1', page);
    await client.getOrganizationInvitationsPage('organization-1', page);
    await client.getOrganizationUsagePage('organization-1', page);
    await client.getOrganizationAuditLogsPage('organization-1', page);

    expect(fetchMock).toHaveBeenCalledTimes(7);
    for (const call of fetchMock.mock.calls) {
      const url = new URL(String(call[0]), 'https://api.lyra.test');
      expect(url.searchParams.get('limit')).toBe('40');
      expect(url.searchParams.get('cursor')).toBe('opaque/cursor');
    }
    expect(new URL(String(fetchMock.mock.calls[0]?.[0]), 'https://api.lyra.test').searchParams.get('organization_id'))
      .toBe('organization-1');
    expect(new URL(String(fetchMock.mock.calls[1]?.[0]), 'https://api.lyra.test').searchParams.get('organization_id'))
      .toBe('organization-1');
    expect(new URL(String(fetchMock.mock.calls[2]?.[0]), 'https://api.lyra.test').searchParams.get('organization_id'))
      .toBe('organization-1');
  });
});
