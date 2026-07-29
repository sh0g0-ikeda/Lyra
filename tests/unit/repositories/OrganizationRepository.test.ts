import { encodeListCursor } from '../../../src/domain/pagination.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresOrganizationRepository } from '../../../src/repositories/OrganizationRepository.js';
import { describe, expect, it } from 'vitest';

const organizationId = '550e8400-e29b-41d4-a716-446655440000';
const firstMemberId = '550e8400-e29b-41d4-a716-446655440001';
const secondMemberId = '550e8400-e29b-41d4-a716-446655440002';

describe('PostgresOrganizationRepository cursor pagination', () => {
  it('members are keyset-paginated by created_at and id without an offset', async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return {
          rows: [
            buildMemberRow(firstMemberId, '2026-07-10T00:00:00.000Z'),
            buildMemberRow(secondMemberId, '2026-07-09T00:00:00.000Z'),
          ],
        };
      },
    } as unknown as DatabaseClient;
    const repository = new PostgresOrganizationRepository(client, buildTransactionRunner());

    const page = await repository.listMembersPage(organizationId, { limit: 1, cursor: null });

    expect(page.items.map((member) => member.id)).toEqual([firstMemberId]);
    expect(page.nextCursor).toBe(
      encodeListCursor('organization-members', '2026-07-10T00:00:00.000Z', firstMemberId),
    );
    expect(queries[0]?.text).toContain('organization_members.organization_id = $1');
    expect(queries[0]?.text).toContain('organization_members.created_at DESC, organization_members.id DESC');
    expect(queries[0]?.text).not.toMatch(/OFFSET/i);
    expect(queries[0]?.values).toEqual([organizationId, 2]);
  });

  it('members use both created_at and id after a cursor boundary', async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return { rows: [buildMemberRow(secondMemberId, '2026-07-10T00:00:00.000Z')] };
      },
    } as unknown as DatabaseClient;
    const repository = new PostgresOrganizationRepository(client, buildTransactionRunner());

    const page = await repository.listMembersPage(organizationId, {
      limit: 1,
      cursor: { sort: '2026-07-10T00:00:00.000Z', id: firstMemberId },
    });

    expect(page.items.map((member) => member.id)).toEqual([secondMemberId]);
    expect(page.nextCursor).toBeNull();
    expect(queries[0]?.text).toMatch(/created_at < \$2[\s\S]*created_at = \$2[\s\S]*id < \$3/);
    expect(queries[0]?.values).toEqual([
      organizationId,
      '2026-07-10T00:00:00.000Z',
      firstMemberId,
      2,
    ]);
  });

  it('invitation, usage, and audit pages scope the organization before cursor predicates', async () => {
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const client = {
      query: async (text: string, values: unknown[]) => {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as unknown as DatabaseClient;
    const repository = new PostgresOrganizationRepository(client, buildTransactionRunner());
    const cursor = { sort: '2026-07-10T00:00:00.000Z', id: firstMemberId };

    await repository.listInvitationsPage(organizationId, { limit: 1, cursor });
    await repository.listUsageEventsPage(organizationId, { limit: 1, cursor });
    await repository.listAuditLogsPage(organizationId, { limit: 1, cursor });

    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.text.indexOf('organization_id = $1')).toBeGreaterThanOrEqual(0);
      expect(query.text.indexOf('organization_id = $1')).toBeLessThan(query.text.indexOf('created_at < $2'));
      expect(query.text).toContain('ORDER BY created_at DESC, id DESC');
      expect(query.text).not.toMatch(/OFFSET/i);
      expect(query.values).toEqual([organizationId, cursor.sort, cursor.id, 2]);
    }
  });

  it('usage summaries aggregate the complete organization scope instead of a page', async () => {
    const queries: string[] = [];
    const client = {
      query: async (text: string) => {
        queries.push(text);
        return {
          rows: [
            {
              current_month_total_credits: '12',
              by_member: [{ key: 'member-1', credits: '8' }],
              by_work: [{ key: 'work-1', credits: '12' }],
              by_generation_type: [{ key: 'page.generate', credits: '12' }],
            },
          ],
        };
      },
    } as unknown as DatabaseClient;
    const repository = new PostgresOrganizationRepository(client, buildTransactionRunner());

    await expect(repository.summarizeUsageEvents(organizationId)).resolves.toEqual({
      currentMonthTotalCredits: 12,
      byMember: [{ key: 'member-1', credits: 8 }],
      byWork: [{ key: 'work-1', credits: 12 }],
      byGenerationType: [{ key: 'page.generate', credits: 12 }],
    });
    expect(queries[0]).toContain('WHERE organization_id = $1');
    expect(queries[0]).not.toContain('LIMIT');
  });
});

function buildTransactionRunner(): TransactionRunner {
  return {
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> =>
      work({} as DatabaseClient),
  };
}

function buildMemberRow(id: string, createdAt: string): Record<string, unknown> {
  return {
    id,
    organization_id: organizationId,
    user_id: '550e8400-e29b-41d4-a716-446655440099',
    email: 'member@example.com',
    display_name: 'Member',
    role: 'editor',
    status: 'active',
    invited_by_user_id: null,
    joined_at: createdAt,
    created_at: new Date(createdAt),
    updated_at: new Date(createdAt),
  };
}
