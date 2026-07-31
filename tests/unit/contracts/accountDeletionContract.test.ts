import { describe, expect, it } from 'vitest';
import {
  accountDeletionPreviewResponseSchema,
  accountDeletionResultResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

describe('account deletion response contract', () => {
  it('previewは外部IDやS3 keyを含まないstrict summaryだけを受ける', () => {
    const payload = {
      personal_data: {
        account: 'anonymized',
        personal_works: 'deleted',
        organization_memberships: 'removed',
        billing_records: 'retained_for_legal_and_security',
      },
      unique_owner_organizations: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Studio',
        },
      ],
      active_personal_stripe_subscription_count: 1,
      active_store_subscriptions: [
        {
          store: 'apple',
          expires_at: '2026-08-31T00:00:00.000Z',
          auto_renew_enabled: true,
          manage_url: 'https://apps.apple.com/account/subscriptions',
        },
      ],
      personal_asset_count: 3,
      active_personal_job_count: 0,
    };

    expect(accountDeletionPreviewResponseSchema.safeParse(payload).success).toBe(
      true,
    );
    expect(
      accountDeletionPreviewResponseSchema.safeParse({
        ...payload,
        s3_keys: ['private/key'],
      }).success,
    ).toBe(false);
  });

  it('blocked・pending・completedをdiscriminated unionで固定する', () => {
    expect(
      accountDeletionResultResponseSchema.safeParse({
        status: 'blocked',
        blockers: [
          {
            code: 'ACTIVE_STORE_SUBSCRIPTION',
            subscription_count: 1,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      accountDeletionResultResponseSchema.safeParse({
        status: 'pending_external_action',
        blockers: [],
        next_action: 'delete_personal_assets',
      }).success,
    ).toBe(true);
    expect(
      accountDeletionResultResponseSchema.safeParse({
        status: 'completed',
        blockers: [],
        provider_error: 'secret',
      }).success,
    ).toBe(false);
  });
});
