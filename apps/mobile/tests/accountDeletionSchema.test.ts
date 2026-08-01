import { describe, expect, it } from 'vitest';

import {
  accountDeletionPreviewSchema,
  accountDeletionResultSchema
} from '@/domain/apiSchemas';

const organizationId = '11111111-1111-4111-8111-111111111111';

describe('account deletion schemas', () => {
  it('現行previewの個人・store・asset・active job summaryだけを受け入れる', () => {
    expect(
      accountDeletionPreviewSchema.safeParse({
        personal_data: {
          account: 'anonymized',
          personal_works: 'deleted',
          organization_memberships: 'removed',
          billing_records: 'retained_for_legal_and_security'
        },
        unique_owner_organizations: [{ id: organizationId, name: 'Lyra Studio' }],
        active_personal_stripe_subscription_count: 1,
        active_store_subscriptions: [
          {
            store: 'apple',
            expires_at: '2026-08-31T00:00:00.000Z',
            auto_renew_enabled: true,
            manage_url: 'https://apps.apple.com/account/subscriptions'
          }
        ],
        personal_asset_count: 3,
        active_personal_job_count: 1
      }).success
    ).toBe(true);
  });

  it('旧preview fieldを混在させず、billing summaryとactive job summaryを必須にする', () => {
    expect(
      accountDeletionPreviewSchema.safeParse({
        personal_data: {
          account: 'anonymized',
          personal_works: 'deleted',
          organization_memberships: 'removed'
        },
        unique_owner_organizations: [],
        active_personal_subscription_count: 1,
        active_stripe_subscription_count: 1,
        active_mobile_store_subscription_count: 0,
        confirmed_personal_asset_count: 3
      }).success
    ).toBe(false);
  });

  it('現行blockerとrecovery statusをstrictに受け入れる', () => {
    const blocked = accountDeletionResultSchema.safeParse({
      status: 'blocked',
      blockers: [
        { code: 'ACTIVE_PERSONAL_JOB', job_count: 1 },
        { code: 'ACTIVE_STORE_SUBSCRIPTION', subscription_count: 1 },
        { code: 'PERSONAL_ASSETS', asset_count: 3 }
      ]
    });
    const pending = accountDeletionResultSchema.safeParse({
      status: 'pending_external_action',
      blockers: [],
      next_action: 'delete_personal_assets'
    });

    expect(blocked.success).toBe(true);
    expect(pending.success).toBe(true);
  });
});
