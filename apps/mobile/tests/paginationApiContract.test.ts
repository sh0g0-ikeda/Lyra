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
  it('現行responseのcursor有無をstrictに検証する', () => {
    expect(worksResponseSchema.parse({ works: [] })).toEqual({ works: [] });
    expect(() => worksResponseSchema.parse({ works: [], next_cursor: 1 })).toThrow();
    expect(organizationMembersResponseSchema.parse({ members: [] })).toEqual({ members: [] });
    expect(organizationInvitationsResponseSchema.parse({ invitations: [] }))
      .toEqual({ invitations: [] });
    expect(
      organizationUsageResponseSchema.parse({
        usage_events: [],
        summary: {
          current_month_total_credits: 0,
          by_member: [],
          by_work: [],
          by_generation_type: [],
        },
      }),
    ).toMatchObject({ usage_events: [] });
    expect(organizationAuditLogsResponseSchema.parse({ audit_logs: [] }))
      .toEqual({ audit_logs: [] });
  });

  it('全一覧APIでlimit・cursor・organization scopeを安全に構築する', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const paginated = { next_cursor: 'next-page' };
      let body: unknown;
      if (url.includes('/members')) {
        body = { members: [] };
      } else if (url.includes('/invitations')) {
        body = { invitations: [] };
      } else if (url.includes('/usage')) {
        body = {
          usage_events: [],
          summary: {
            current_month_total_credits: 0,
            by_member: [],
            by_work: [],
            by_generation_type: [],
          },
        };
      } else if (url.includes('/audit-logs')) {
        body = { audit_logs: [] };
      } else if (url.includes('/entities')) {
        body = { ...paginated, entities: [] };
      } else if (url.includes('/pages')) {
        body = { ...paginated, pages: [] };
      } else {
        body = { ...paginated, works: [] };
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
    await expect(client.getOrganizationMembersPage('organization-1', page))
      .resolves.toMatchObject({ next_cursor: null });
    await expect(client.getOrganizationInvitationsPage('organization-1', page))
      .resolves.toMatchObject({ next_cursor: null });
    await expect(client.getOrganizationUsagePage('organization-1', page))
      .resolves.toMatchObject({ next_cursor: null });
    await expect(client.getOrganizationAuditLogsPage('organization-1', page))
      .resolves.toMatchObject({ next_cursor: null });

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
