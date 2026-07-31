import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type {
  DatabaseClient,
  TransactionRunner,
} from '../../../src/lib/db.js';
import {
  PostgresOrganizationRepository,
  type OrganizationListCursor,
} from '../../../src/repositories/OrganizationRepository.js';

const userId = '11111111-1111-4111-8111-111111111111';

describe('PostgresOrganizationRepository pagination', () => {
  it('active membershipを既存順・ID tie-breaker・limit+1で取得する', async () => {
    const client = new OrganizationPageClient();
    const repository = new PostgresOrganizationRepository(
      client,
      new NoopTransactionRunner(),
    );

    const page = await repository.listWorkspacesPageByUserId(
      userId,
      { limit: 2, cursor: null },
    );

    expect(client.sql).toContain('organization_members.user_id = $1::uuid');
    expect(client.sql).toContain("organization_members.status = 'active'");
    expect(client.sql).toContain('ORDER BY organizations.updated_at DESC,');
    expect(client.sql).toContain('organizations.created_at DESC,');
    expect(client.sql).toContain('organizations.id DESC');
    expect(client.values).toEqual([userId, null, null, null, 3]);
    expect(page.organizations).toHaveLength(2);
    expect(page.nextCursor).toEqual({
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      id: organizationId(2),
    });
  });

  it('cursor三項目とlimit+1をqueryへ渡す', async () => {
    const client = new OrganizationPageClient();
    const repository = new PostgresOrganizationRepository(
      client,
      new NoopTransactionRunner(),
    );
    const cursor: OrganizationListCursor = {
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
      id: organizationId(2),
    };

    await repository.listWorkspacesPageByUserId(
      userId,
      { limit: 25, cursor },
    );

    expect(client.values).toEqual([
      userId,
      cursor.updatedAt,
      cursor.createdAt,
      cursor.id,
      26,
    ]);
  });
});

class NoopTransactionRunner implements TransactionRunner {
  public async transaction<T>(
    work: (client: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    return work(new OrganizationPageClient());
  }
}

class OrganizationPageClient implements DatabaseClient {
  public sql = '';
  public values: readonly unknown[] | undefined;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.sql = text;
    this.values = values;
    return queryResult([
      workspaceRow(organizationId(1), '2026-07-31T00:00:00.000Z', '2026-07-30T00:00:00.000Z'),
      workspaceRow(organizationId(2), '2026-07-30T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
      workspaceRow(organizationId(3), '2026-07-29T00:00:00.000Z', '2026-07-28T00:00:00.000Z'),
    ]) as QueryResult<T>;
  }
}

function queryResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function workspaceRow(
  id: string,
  updatedAt: string,
  createdAt: string,
): QueryResultRow {
  return {
    org_id: id,
    org_type: 'business',
    org_name: 'Lyra Studio',
    org_legal_name: null,
    org_status: 'active',
    org_plan_key: 'enterprise_a',
    org_billing_email: null,
    org_stripe_customer_id: null,
    org_stripe_subscription_id: null,
    org_created_by_user_id: userId,
    org_created_at: new Date(createdAt),
    org_updated_at: new Date(updatedAt),
    member_id: id,
    member_organization_id: id,
    member_user_id: userId,
    member_email: 'owner@example.test',
    member_display_name: null,
    member_role: 'owner',
    member_status: 'active',
    member_invited_by_user_id: null,
    member_joined_at: new Date(createdAt),
    member_created_at: new Date(createdAt),
    member_updated_at: new Date(updatedAt),
    balance_organization_id: null,
    balance_monthly_credits: null,
    balance_purchased_credits: null,
    balance_monthly_expires_at: null,
    balance_updated_at: null,
  };
}

function organizationId(value: number): string {
  return `${String(value).padStart(8, '0')}-1111-4111-8111-111111111111`;
}
