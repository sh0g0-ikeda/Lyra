import { describe, expect, it } from 'vitest';
import { currentSessionSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validSessionPayload = {
  user: {
    id: 'user-1',
    email: 'owner@example.com',
    display_name: 'Owner',
    plan_code: 'standard',
  },
  personal_credits: {
    monthly_credits: 30,
    purchased_credits: 12,
    total_credits: 42,
    monthly_expires_at: '2026-07-31T00:00:00.000Z',
  },
  organizations: [
    {
      id: 'org-1',
      name: 'Lyra Studio',
      status: 'active',
      plan_key: 'enterprise_a',
      role: 'owner',
      membership_status: 'active',
      monthly_credits: 500,
      purchased_credits: 40,
      total_credits: 540,
      monthly_expires_at: null,
    },
  ],
};

describe('currentSessionSchema', () => {
  it('現行のpersonalとorganization session payloadを受理する', () => {
    expect(currentSessionSchema.safeParse(validSessionPayload).success).toBe(true);
  });

  it('optional serviceが未設定のsession payloadを受理する', () => {
    expect(
      currentSessionSchema.safeParse({
        ...validSessionPayload,
        personal_credits: null,
        organizations: [],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['不正email', { user: { ...validSessionPayload.user, email: 'not-an-email' } }],
    [
      '負数personal credit',
      {
        personal_credits: {
          ...validSessionPayload.personal_credits,
          monthly_credits: -1,
        },
      },
    ],
    [
      '未知organization role',
      {
        organizations: [
          {
            ...validSessionPayload.organizations[0],
            role: 'super-admin',
          },
        ],
      },
    ],
    [
      '未知organization status',
      {
        organizations: [
          {
            ...validSessionPayload.organizations[0],
            status: 'deleted',
          },
        ],
      },
    ],
  ])('%sを拒否する', (_caseName, override) => {
    expect(
      currentSessionSchema.safeParse({
        ...validSessionPayload,
        ...override,
      }).success,
    ).toBe(false);
  });
});
