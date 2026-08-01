import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';
import {
  organizationAuditLogsQueryKey,
  organizationBillingQueryKey,
  organizationInvitationsQueryKey,
  organizationMembersQueryKey,
  organizationUsageQueryKey,
  organizationWorkspaceQueryKey
} from '@/lib/queryKeys';

const organizationId = '11111111-1111-4111-8111-111111111111';

const workspaceResponse = {
  organization: {
    id: organizationId,
    type: 'business',
    name: 'Lyra Studio',
    legal_name: 'Lyra Studio Inc.',
    status: 'active',
    plan_key: 'enterprise_a',
    billing_email: 'billing@example.test',
    created_by_user_id: 'user-1',
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z'
  },
  membership: {
    id: 'member-1',
    organization_id: organizationId,
    user_id: 'user-1',
    email: 'owner@example.test',
    display_name: 'Owner',
    role: 'owner',
    status: 'active',
    invited_by_user_id: null,
    joined_at: '2026-07-25T00:00:00.000Z',
    created_at: '2026-07-25T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z'
  },
  balance: {
    organization_id: organizationId,
    monthly_credits: 100,
    purchased_credits: 10,
    total_credits: 110,
    monthly_expires_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-07-25T00:00:00.000Z'
  }
} as const;

describe('organization management API contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an organization through the authenticated API and validates the returned workspace', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(workspaceResponse), {
        headers: { 'Content-Type': 'application/json' },
        status: 201
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.createOrganization({ name: 'Lyra Mobile Studio' })).resolves.toMatchObject({
      organization: { id: organizationId, name: 'Lyra Studio' },
      membership: { role: 'owner' }
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/organizations');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ name: 'Lyra Mobile Studio' });
  });

  it('現在の組織だけをパスに含めて管理情報をruntime検証する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(workspaceResponse), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getOrganizationWorkspace(organizationId)).resolves.toMatchObject({
      organization: { name: 'Lyra Studio', plan_key: 'enterprise_a' },
      membership: { role: 'owner' },
      balance: { total_credits: 110 }
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/api/organizations/${organizationId}`);
  });

  it('組織請求のcheckout URLはruntime検証し、返却だけを行う', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ session_id: 'session-1', url: 'https://billing.example.test/checkout' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 201
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.createOrganizationSubscriptionCheckout(organizationId, { plan_code: 'enterprise_a' })).resolves.toEqual({
      session_id: 'session-1',
      url: 'https://billing.example.test/checkout'
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `/api/organizations/${organizationId}/billing/checkout/subscription`
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ plan_code: 'enterprise_a' });
  });

  it('組織の壊れたメンバー応答を安全な契約エラーとして拒否する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ members: [{ id: 'member-1', role: 'not-a-role' }] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        })
      )
    );
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getOrganizationMembers(organizationId)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502
    });
  });

  it('組織管理query keyはセッションと法人スコープを分離する', () => {
    const sessionKey = 'session-a';
    expect(organizationWorkspaceQueryKey(sessionKey, organizationId)).not.toEqual(
      organizationWorkspaceQueryKey('session-b', organizationId)
    );
    expect(organizationMembersQueryKey(sessionKey, organizationId)).not.toEqual(
      organizationInvitationsQueryKey(sessionKey, organizationId)
    );
    expect(organizationBillingQueryKey(sessionKey, organizationId)).not.toEqual(
      organizationUsageQueryKey(sessionKey, organizationId)
    );
    expect(organizationAuditLogsQueryKey(sessionKey, organizationId)).not.toEqual(
      organizationUsageQueryKey(sessionKey, organizationId)
    );
  });
});
