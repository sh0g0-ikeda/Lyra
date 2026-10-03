// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.
import { z } from 'zod';

const idSchema = z.string().min(1);
const nullableStringSchema = z.string().nullable();
const imageProvenanceFields = {
  image_model: z.string().min(1).max(200).nullable().optional(),
  provider_model_id: z.string().min(1).max(200).nullable().optional(),
  provider: z.string().min(1).max(200).nullable().optional(),
  mobile_access: z.enum(['available', 'web_only', 'unavailable']).optional(),
};
const timestampSchema = z.string().min(1);
const unknownRecordSchema = z.record(z.string(), z.unknown());
const storyStatusSchema = z.enum(['draft', 'reviewing', 'ready']);
const organizationRoleSchema = z.enum(['owner', 'admin', 'billing', 'editor', 'viewer']);
const organizationStatusSchema = z.enum([
  'active',
  'trialing',
  'past_due',
  'suspended',
  'canceled',
]);
const organizationPlanSchema = z.enum(['enterprise_a', 'enterprise_b', 'enterprise_c']);
const subscriptionPlanCodeSchema = z.enum([
  'free',
  'standard',
  'premium',
  'enterprise_a',
  'enterprise_b',
  'enterprise_c',
]);
const subscriptionStatusSchema = z.enum([
  'active',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'trialing',
  'unpaid',
]);
const creditPackageCodeSchema = z.enum(['credits_200', 'credits_1000', 'credits_3000']);
const organizationMembershipStatusSchema = z.enum([
  'invited',
  'active',
  'suspended',
  'removed',
]);

const episodeExportStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'canceled',
]);

export const episodeExportAcceptedResponseSchema = z
  .object({
    job_id: idSchema,
    status: episodeExportStatusSchema,
  })
  .strict();

export const episodeExportStatusResponseSchema = z
  .object({
    job_id: idSchema,
    status: episodeExportStatusSchema,
    progress: z
      .object({
        stage: z.string().min(1).max(80),
        percent: z.number().int().min(0).max(100),
      })
      .strict(),
    error: z
      .object({
        code: z.string().min(1).max(80),
        message: z.string().min(1).max(512),
      })
      .strict()
      .nullable(),
    created_at: timestampSchema,
    started_at: timestampSchema.nullable(),
    completed_at: timestampSchema.nullable(),
    expires_at: timestampSchema,
    download_ready: z.boolean(),
  })
  .strict();

// Deployed Mobile clients consume this default representation. The nested DTO above
// is available only with export_contract=v2; both stay strict at the HTTP boundary.
export const episodeExportLegacyStatusResponseSchema = z.object({
  id: idSchema.max(128),
  episode_id: idSchema.max(128),
  format: z.enum(['pdf', 'zip']),
  filename: z.string().min(1).max(160),
  status: episodeExportStatusSchema,
  progress_stage: z.string().min(1).max(100),
  progress_percent: z.number().int().min(0).max(100),
  error_code: z.string().min(1).max(128).nullable(),
  message_key: z.string().min(1).max(128).nullable(),
  expires_at: z.string().datetime({ offset: true }).max(64),
  completed_at: z.string().datetime({ offset: true }).max(64).nullable(),
  cancel_supported: z.literal(false),
  cancel_reason_code: z.literal('EXPORT_CANCEL_UNSUPPORTED'),
  download_url: z.string().url().max(2048).optional(),
}).strict().refine((value) => value.status === 'completed' || value.download_url === undefined, {
  message: 'download_url is only available after export completion', path: ['download_url'],
});

const creditBalanceSchema = z.object({
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableStringSchema,
});

const subscriptionPlanSchema = z.object({
  plan_code: z.enum(['standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c']),
  display_name_ja: z.string(),
  display_name_en: z.string(),
  monthly_credits: z.number().int().nonnegative(),
  amount_jpy: z.number().int().nonnegative(),
  minimum_contract_months: z.number().int().nonnegative(),
  trial_days: z.number().int().nonnegative(),
  is_enterprise: z.boolean(),
  configured: z.boolean(),
});

export const billingBalanceSchema = z.object({
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableStringSchema,
  plan_code: z.enum(['free', 'standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c']),
  current_period_end: nullableStringSchema,
  subscription_store: z.enum(['apple', 'google']).nullable().optional(),
  scheduled_plan_code: z.enum(['standard', 'premium']).nullable().optional(),
  scheduled_plan_effective_at: timestampSchema.nullable().optional(),
  cancel_at_period_end: z.boolean(),
  subscription_plans: z.array(subscriptionPlanSchema),
});

const mobileStoreSchema = z.enum(['apple', 'google']);
const mobileStorePurchaseStateSchema = z.enum([
  'pending',
  'active',
  'cancelled',
  'expired',
  'refunded',
  'revoked',
  'failed',
]);
const mobileStoreProductKindSchema = z.enum(['subscription', 'credit_pack']);

export const mobileStoreProductCatalogSchema = z
  .object({
    store: mobileStoreSchema,
    products: z
      .array(
        z
          .object({
            product_id: z.string().min(1).max(255),
            kind: mobileStoreProductKindSchema,
            plan_code: z.enum(['standard', 'premium']).nullable(),
            credit_package_code: creditPackageCodeSchema.nullable(),
          })
          .strict()
          .superRefine((value, context) => {
            if (
              (value.kind === 'subscription' &&
                (value.plan_code === null || value.credit_package_code !== null)) ||
              (value.kind === 'credit_pack' &&
                (value.plan_code !== null || value.credit_package_code === null))
            ) {
              context.addIssue({
                code: 'custom',
                message: 'Mobile store product mapping is inconsistent',
              });
            }
          }),
      )
      .max(20),
  })
  .strict();

export const mobilePurchaseAccountBindingSchema = z
  .object({
    apple_app_account_token: z.string().uuid(),
    google_obfuscated_account_id: z.string().min(32).max(64),
    subscription_purchase_allowed: z.boolean(),
  })
  .strict();

export const mobileStorePurchaseResultSchema = z
  .object({
    store: mobileStoreSchema,
    state: mobileStorePurchaseStateSchema,
    product_kind: mobileStoreProductKindSchema,
    plan_code: z.enum(['standard', 'premium']).nullable(),
    credit_package_code: creditPackageCodeSchema.nullable(),
    scheduled_plan_code: z.enum(['standard', 'premium']).nullable().optional(),
    scheduled_plan_effective_at: timestampSchema.nullable().optional(),
    credits_changed: z.number().int(),
    is_duplicate: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.product_kind === 'subscription' &&
        (value.plan_code === null || value.credit_package_code !== null)) ||
      (value.product_kind === 'credit_pack' &&
        (value.plan_code !== null || value.credit_package_code === null))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Mobile store purchase result is inconsistent',
      });
    }
  });

export const mobileStoreRestoreResultSchema = z
  .object({
    purchases: z.array(mobileStorePurchaseResultSchema).max(100),
  })
  .strict();

export const currentSessionSchema = z.object({
  // Older deployments omit this object. Never infer feature availability from
  // an app build or the presence of a state identifier.
  capabilities: z.object({
    generation_quotes: z.boolean().optional(),
    push_notifications: z.boolean().optional(),
    web_image_delivery: z.boolean().optional(),
    entity_state_reference_generation: z.boolean().default(false),
    episode_state_autofill_v1: z.boolean().default(false),
    entity_state_preview_credit_cost: z.number().int().nonnegative().optional(),
  }).optional(),
  user: z.object({
    id: idSchema,
    email: z.string().email(),
    display_name: nullableStringSchema,
    plan_code: z.string().min(1),
  }),
  personal_credits: creditBalanceSchema.nullable(),
  organizations: z.array(
    z.object({
      id: idSchema,
      name: z.string().min(1),
      status: organizationStatusSchema,
      plan_key: organizationPlanSchema,
      role: organizationRoleSchema,
      membership_status: organizationMembershipStatusSchema,
      monthly_credits: z.number().int().nonnegative(),
      purchased_credits: z.number().int().nonnegative(),
      total_credits: z.number().int().nonnegative(),
      monthly_expires_at: nullableStringSchema,
    }),
  ),
});

const accountDeletionPersonalDataSchema = z
  .object({
    account: z.literal('anonymized'),
    personal_works: z.literal('deleted'),
    organization_memberships: z.literal('removed'),
    billing_records: z.literal('retained_for_legal_and_security'),
  })
  .strict();

export const accountDeletionPreviewResponseSchema = z
  .object({
    personal_data: accountDeletionPersonalDataSchema,
    unique_owner_organizations: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().min(1).max(120),
          })
          .strict(),
      )
      .max(25),
    active_personal_stripe_subscription_count: z.number().int().nonnegative(),
    active_store_subscriptions: z
      .array(
        z
          .object({
            store: mobileStoreSchema,
            expires_at: timestampSchema.nullable(),
            auto_renew_enabled: z.boolean().nullable(),
            manage_url: z.string().url(),
          })
          .strict(),
      )
      .max(20),
    personal_asset_count: z.number().int().nonnegative(),
    active_personal_job_count: z.number().int().nonnegative(),
  })
  .strict();

const accountDeletionBlockerSchema = z.discriminatedUnion('code', [
  z
    .object({
      code: z.literal('UNIQUE_ORGANIZATION_OWNER'),
      organizations: z
        .array(
          z
            .object({
              id: idSchema,
              name: z.string().min(1).max(120),
            })
            .strict(),
        )
        .max(25),
    })
    .strict(),
  z
    .object({
      code: z.literal('ACTIVE_PERSONAL_JOB'),
      job_count: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      code: z.literal('ACTIVE_PERSONAL_SUBSCRIPTION'),
      subscription_count: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      code: z.literal('ACTIVE_STORE_SUBSCRIPTION'),
      subscription_count: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      code: z.literal('PERSONAL_ASSETS'),
      asset_count: z.number().int().positive(),
    })
    .strict(),
]);

const accountDeletionEmptyBlockersSchema = z.array(z.never()).max(0);

export const accountDeletionResultResponseSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        status: z.literal('blocked'),
        blockers: z.array(accountDeletionBlockerSchema).min(1).max(16),
      })
      .strict(),
    z
      .object({
        status: z.literal('in_progress'),
        blockers: accountDeletionEmptyBlockersSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal('pending_external_action'),
        blockers: accountDeletionEmptyBlockersSchema,
        next_action: z.enum([
          'cancel_personal_subscriptions',
          'delete_personal_assets',
          'anonymize_personal_data',
          'disable_identity',
          'delete_identity',
        ]),
      })
      .strict(),
    z
      .object({
        status: z.literal('completed'),
        blockers: accountDeletionEmptyBlockersSchema,
      })
      .strict(),
  ],
);

export const organizationSchema = z
  .object({
    id: idSchema,
    type: z.enum(['business', 'internal']),
    name: z.string().min(1),
    legal_name: nullableStringSchema,
    status: organizationStatusSchema,
    plan_key: organizationPlanSchema,
    billing_email: nullableStringSchema,
    created_by_user_id: idSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

export const organizationMemberSchema = z
  .object({
    id: idSchema,
    organization_id: idSchema,
    user_id: idSchema,
    email: z.string().min(1),
    display_name: nullableStringSchema,
    role: organizationRoleSchema,
    status: organizationMembershipStatusSchema,
    invited_by_user_id: nullableStringSchema,
    joined_at: timestampSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

export const organizationCreditBalanceSchema = z
  .object({
    organization_id: idSchema,
    monthly_credits: z.number().int().nonnegative(),
    purchased_credits: z.number().int().nonnegative(),
    total_credits: z.number().int().nonnegative(),
    monthly_expires_at: timestampSchema.nullable(),
    updated_at: timestampSchema,
  })
  .strict();

export const organizationWorkspaceSchema = z
  .object({
    organization: organizationSchema,
    membership: organizationMemberSchema,
    balance: organizationCreditBalanceSchema.nullable(),
  })
  .strict();

export const organizationCreditBalanceResponseSchema = organizationCreditBalanceSchema;

export const organizationBillingPlanSchema = z
  .object({
    plan_code: organizationPlanSchema,
    display_name_ja: z.string(),
    display_name_en: z.string(),
    monthly_credits: z.number().int().nonnegative(),
    amount_jpy: z.number().int().nonnegative(),
    minimum_contract_months: z.number().int().nonnegative(),
    trial_days: z.number().int().nonnegative(),
    is_enterprise: z.literal(true),
    configured: z.boolean(),
  })
  .strict();

export const organizationBillingPlansResponseSchema = z
  .object({
    subscription_plans: z.array(organizationBillingPlanSchema),
  })
  .strict();

export const organizationSubscriptionCheckoutResponseSchema = z
  .object({
    session_id: idSchema,
    url: z.string().min(1),
  })
  .strict();

export const organizationCreditCheckoutResponseSchema = z
  .object({
    session_id: idSchema,
    package_code: creditPackageCodeSchema,
    url: z.string().min(1),
  })
  .strict();

export const organizationCustomerPortalResponseSchema = z
  .object({
    url: z.string().min(1),
  })
  .strict();

export const billingSubscriptionCheckoutResponseSchema = organizationSubscriptionCheckoutResponseSchema;
export const billingCreditCheckoutResponseSchema = organizationCreditCheckoutResponseSchema;
export const billingCustomerPortalResponseSchema = organizationCustomerPortalResponseSchema;

export const organizationSubscriptionSummarySchema = z
  .object({
    organization_id: idSchema,
    plan_code: subscriptionPlanCodeSchema,
    status: subscriptionStatusSchema,
    current_period_start: timestampSchema.nullable(),
    current_period_end: timestampSchema.nullable(),
    cancel_at_period_end: z.boolean(),
  })
  .strict();

export const organizationBillingSummaryResponseSchema = z
  .object({
    workspace: organizationWorkspaceSchema,
    subscription: organizationSubscriptionSummarySchema.nullable(),
    subscription_plans: z.array(organizationBillingPlanSchema),
  })
  .strict();

export const organizationInvoiceSchema = z
  .object({
    id: idSchema,
    user_id: idSchema.nullable(),
    organization_id: idSchema,
    kind: z.enum(['subscription', 'credit_purchase']),
    amount_jpy: z.number().int().nonnegative(),
    status: z.enum(['paid', 'failed']),
    invoice_url: z.string().min(1).nullable(),
    created_at: timestampSchema,
  })
  .strict();

export const organizationInvoicesResponseSchema = z
  .object({
    invoices: z.array(organizationInvoiceSchema),
  })
  .strict();

export const organizationUsageEventSchema = z
  .object({
    id: idSchema,
    organization_id: idSchema,
    user_id: idSchema.nullable(),
    work_id: idSchema.nullable(),
    generation_job_id: idSchema.nullable(),
    event_type: z.string().min(1),
    credit_amount: z.number().int(),
    metadata: unknownRecordSchema,
    created_at: timestampSchema,
  })
  .strict();

const organizationUsageCreditGroupSchema = z
  .object({
    key: z.string().min(1),
    credits: z.number().int(),
  })
  .strict();

export const organizationUsageSummarySchema = z
  .object({
    current_month_total_credits: z.number().int(),
    by_member: z.array(organizationUsageCreditGroupSchema),
    by_work: z.array(organizationUsageCreditGroupSchema),
    by_generation_type: z.array(organizationUsageCreditGroupSchema),
  })
  .strict();

export const organizationUsageResponseSchema = z
  .object({
    usage_events: z.array(organizationUsageEventSchema),
    summary: organizationUsageSummarySchema,
    next_cursor: z.string().min(1).max(1024).nullable().optional(),
  })
  .strict();

export const organizationAuditLogSchema = z
  .object({
    id: idSchema,
    organization_id: idSchema,
    actor_user_id: idSchema.nullable(),
    action: z.string().min(1),
    target_type: z.string().min(1),
    target_id: idSchema.nullable(),
    metadata: unknownRecordSchema,
    created_at: timestampSchema,
  })
  .strict();

export const organizationAuditLogsResponseSchema = z
  .object({
    audit_logs: z.array(organizationAuditLogSchema),
    next_cursor: z.string().min(1).max(1024).nullable().optional(),
  })
  .strict();

export const adminOrganizationContractResponseSchema = z
  .object({
    organization: z
      .object({
        id: idSchema,
        name: z.string().min(1),
        status: organizationStatusSchema,
        plan_key: organizationPlanSchema,
        billing_email: nullableStringSchema,
        updated_at: timestampSchema,
      })
      .strict(),
  })
  .strict();

export const organizationsResponseSchema = z
  .object({
    organizations: z.array(organizationWorkspaceSchema),
    next_cursor: z.string().min(1).max(512).nullable().optional(),
  })
  .strict();

export const organizationResponseSchema = z
  .object({
    organization: organizationSchema,
  })
  .strict();

export const organizationMembersResponseSchema = z
  .object({
    members: z.array(organizationMemberSchema),
    next_cursor: z.string().min(1).max(1024).nullable().optional(),
  })
  .strict();

export const organizationMemberResponseSchema = z
  .object({
    member: organizationMemberSchema,
  })
  .strict();

export const organizationInvitationSchema = z
  .object({
    id: idSchema,
    organization_id: idSchema,
    email: z.string().min(1),
    role: organizationRoleSchema,
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    send_status: z.enum(['not_sent', 'sending', 'sent', 'failed']),
    send_error_code: nullableStringSchema,
    send_error_message: nullableStringSchema,
    sent_at: timestampSchema.nullable(),
    last_sent_at: timestampSchema.nullable(),
    resend_count: z.number().int().nonnegative(),
    invited_by_user_id: idSchema,
    accepted_by_user_id: nullableStringSchema,
    expires_at: timestampSchema,
    accepted_at: timestampSchema.nullable(),
    revoked_at: timestampSchema.nullable(),
    revoked_by_user_id: nullableStringSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

export const organizationInvitationsResponseSchema = z
  .object({
    invitations: z.array(organizationInvitationSchema),
    next_cursor: z.string().min(1).max(1024).nullable().optional(),
  })
  .strict();

export const organizationInvitationResponseSchema = z
  .object({
    invitation: organizationInvitationSchema,
  })
  .strict();

const invitationEmailDeliverySchema = z
  .object({
    status: z.enum(['disabled', 'sent', 'failed']),
    errorMessage: z.string().optional(),
  })
  .strict();

export const organizationInvitationResultResponseSchema = z
  .object({
    invitation: organizationInvitationSchema,
    invitation_url: z.string().min(1),
    email_delivery: invitationEmailDeliverySchema,
  })
  .strict();

export const organizationInvitationPreviewResponseSchema = z
  .object({
    organization: z
      .object({
        id: idSchema,
        name: z.string().min(1),
      })
      .strict(),
    invitation: z
      .object({
        email: z.string().min(1),
        role: organizationRoleSchema,
        status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
        expires_at: timestampSchema,
      })
      .strict(),
  })
  .strict();

export const workSchema = z.object({
  id: idSchema,
  organization_id: nullableStringSchema,
  title: z.string(),
  genre: nullableStringSchema,
  world_setting: nullableStringSchema,
  theme: nullableStringSchema,
  main_entity_ids: z.array(idSchema),
  starting_point: nullableStringSchema,
  ending_point: nullableStringSchema,
  overall_flow: nullableStringSchema,
  version: z.number().int().nonnegative(),
  status: storyStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const worksResponseSchema = z.object({
  works: z.array(workSchema),
  next_cursor: z.string().min(1).max(512).nullable().optional(),
});

export const chapterSchema = z.object({
  id: idSchema,
  work_id: idSchema,
  order: z.number().int().positive(),
  title: nullableStringSchema,
  purpose: nullableStringSchema,
  starting_state: nullableStringSchema,
  ending_state: nullableStringSchema,
  emotion_curve: nullableStringSchema,
  entities_involved: z.array(idSchema),
  key_beats: z.array(z.string()),
  version: z.number().int().nonnegative(),
  status: storyStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const chaptersResponseSchema = z.object({
  chapters: z.array(chapterSchema),
});

export const episodeSchema = z.object({
  id: idSchema,
  chapter_id: idSchema,
  order: z.number().int().positive(),
  title: nullableStringSchema,
  purpose: nullableStringSchema,
  story_input_mode: z.enum(['structured', 'full']),
  story_full_draft: nullableStringSchema,
  introduction: nullableStringSchema,
  middle: nullableStringSchema,
  climax: nullableStringSchema,
  ending_hook: nullableStringSchema,
  estimated_pages: z.number().int().positive(),
  entities_involved: z.array(idSchema),
  starting_entity_states: z.array(z.object({
    entity_id: idSchema,
    state_id: idSchema.nullable(),
  })).optional(),
  page_skeleton_generated: z.boolean(),
  version: z.number().int().nonnegative(),
  status: storyStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const episodesResponseSchema = z.object({
  episodes: z.array(episodeSchema),
});

export const storyEpisodeImprovementSchema = z.object({
  draft: z.object({
    title: nullableStringSchema,
    purpose: nullableStringSchema,
    story_input_mode: z.enum(['structured', 'full']),
    story_full_draft: nullableStringSchema,
    introduction: nullableStringSchema,
    middle: nullableStringSchema,
    climax: nullableStringSchema,
    ending_hook: nullableStringSchema,
  }),
  compiler_provider: z.enum(['openai', 'fallback']),
  compiler_model: nullableStringSchema,
  compiler_prompt_version: nullableStringSchema,
  compiler_error: nullableStringSchema,
});

export const pageSkeletonResponseSchema = z.union([
  z
    .object({
      job_id: idSchema,
      queued: z.literal(true),
      story_plan_applied: z.boolean(),
    })
    .strict(),
  z
    .object({
      pages_created: z.number().int().nonnegative(),
      panels_created: z.number().int().nonnegative(),
      replaced_existing: z.boolean(),
      story_plan_applied: z.boolean(),
      story_plan_job_id: nullableStringSchema,
    })
    .strict(),
]);

export const storyCollaborationEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('chunk'),
      data: z.object({ text: z.string().max(25_000) }).strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('done'),
      data: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('error'),
      data: z.object({ message: z.string().min(1).max(500) }).strict(),
    })
    .strict(),
]);

export const entitySchema = z.object({
  id: idSchema,
  work_id: idSchema,
  entity_type: z.enum(['character', 'nonhuman', 'object']),
  name: z.string(),
  free_description: nullableStringSchema,
  structured_fields: unknownRecordSchema,
  prompt_supplement: nullableStringSchema,
  speech_profile: unknownRecordSchema,
  status: z.enum(['draft', 'ready']),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const entitiesResponseSchema = z.object({
  entities: z.array(entitySchema),
  next_cursor: z.string().min(1).max(512).nullable().optional(),
});

export const entityReferenceGenerationAvailabilityResponseSchema = z.object({ enabled: z.boolean() }).strict();

export const entityReferenceSetSchema = z
  .object({
    entity_id: idSchema,
    primary_ref_id: nullableStringSchema,
    status: z.enum(['empty', 'partial', 'ready']),
    updated_at: timestampSchema,
    reference_images: z.array(
      z
        .object({
          ...imageProvenanceFields,
          ref_id: idSchema,
          cdn_url: z.string().min(1).optional(),
          source: z.enum(['upload', 'generated']),
          created_at: timestampSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const entityImportResponseSchema = z
  .object({
    suggested_fields: unknownRecordSchema,
    prompt_supplement: z.string(),
    tmp_image_token: z.string().min(1),
  })
  .strict();

const entityReferenceUploadMimeTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const entityReferenceUploadPresignResponseSchema = z
  .object({
    upload_url: z
      .string()
      .url()
      .max(4096)
      .refine((value) => value.startsWith('https://'), 'upload_url must use HTTPS'),
    upload_token: z.string().min(1).max(512),
    expires_at: timestampSchema,
    upload_headers: z
      .object({
        'Content-Type': entityReferenceUploadMimeTypeSchema,
        'x-amz-server-side-encryption': z.literal('AES256'),
      })
      .strict(),
  })
  .strict();

export const entityReferenceGenerationResponseSchema = z
  .object({
    job_id: idSchema,
  })
  .strict();

export const entityStateReferenceGenerationBodySchema = z.object({}).strict();

export const entityStateReferenceGenerationResponseSchema = z
  .object({
    job_id: idSchema,
    state_revision: timestampSchema,
  })
  .strict();

export const confirmEntityStateReferenceBodySchema = z
  .object({
    candidate_token: z.string().trim().min(1).max(4096),
    expected_state_revision: timestampSchema,
  })
  .strict();

export const entityStateReferenceResponseSchema = z
  .object({
    entity_id: idSchema,
    state_id: idSchema,
    state_revision: timestampSchema,
    reference_image: z
      .object({
        ...imageProvenanceFields,
        ref_id: z.string().min(1).max(256),
        image_model: z.string().min(1).max(200),
        base_ref_id: z.string().min(1).max(256),
        created_at: timestampSchema,
        input_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
      })
      .strict(),
  })
  .strict();

export const sceneSchema = z.object({
  id: idSchema,
  episode_id: idSchema,
  order: z.number().int().positive(),
  location: nullableStringSchema,
  time: nullableStringSchema,
  atmosphere: nullableStringSchema,
  involved_entity_ids: z.array(idSchema),
  entity_states: z.array(
    z.object({
      entity_id: idSchema,
      state_id: idSchema,
    }),
  ),
  status: z.enum(['draft', 'reviewing', 'ready']),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const scenesResponseSchema = z.object({
  scenes: z.array(sceneSchema),
});

export const entityStateSchema = z.object({
  reference_status: z.enum(['legacy', 'draft', 'confirmed', 'stale']).optional(),
  reference_image: z.object({
    ...imageProvenanceFields,
    ref_id: idSchema, image_model: z.string().min(1).max(100), base_ref_id: idSchema,
    created_at: timestampSchema, input_fingerprint: z.string().min(1).max(128),
  }).strict().nullable().optional(),
  id: idSchema,
  entity_id: idSchema,
  scene_id: nullableStringSchema,
  name: nullableStringSchema.optional(),
  description: nullableStringSchema.optional(),
  costume_note: nullableStringSchema,
  costume_ref_id: nullableStringSchema,
  condition_note: nullableStringSchema,
  hair_note: nullableStringSchema,
  expression_default: z.string().min(1).max(100),
  extra_note: nullableStringSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema.optional(),
});

export const entityStatesResponseSchema = z.object({
  entity_states: z.array(entityStateSchema),
});

const pageGenerationModeSchema = z.enum(['standard', 'thinking']);
const generatedPageImageSchema = z
  .object({
    ...imageProvenanceFields,
    cdn_url: z.string().min(1).nullable().optional(),
    generation_mode: pageGenerationModeSchema.nullable(),
    generated_at: timestampSchema.nullable(),
  })
  .strict();

export const pageLayoutTemplatesCatalogSchema = z.object({
  templates: z.array(z.object({
    id: idSchema, label_key: z.string().min(1), panel_count: z.number().int().min(1).max(20),
    reading_direction: z.literal('right_to_left_top_to_bottom'), preview_aspect_ratio: z.number().positive(),
    supported_page_sizes: z.tuple([z.literal('normalized_portrait')]),
    frames: z.array(z.object({
      vertices: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).length(4),
      border_style: z.enum(['solid', 'dashed', 'none']), border_width: z.number().min(0).max(20),
      border_color: z.string().regex(/^#[0-9a-fA-F]{6}$/), z_index: z.number().int(), reading_order: z.number().int().positive(),
    })),
  })),
});

export const pageSchema = z.object({
  id: idSchema,
  episode_id: idSchema,
  page_number: z.number().int().positive(),
  layout_config: unknownRecordSchema,
  story_source_scene_ids: z.array(idSchema),
  story_page_purpose: nullableStringSchema,
  story_continuity_note: nullableStringSchema,
  dialogue_mode: z.enum(['image_baked', 'balloon_only', 'mixed']),
  page_dialogue_toggle: z.boolean(),
  generation_mode: pageGenerationModeSchema.nullable(),
  generated_image: generatedPageImageSchema.nullable(),
  status: z.enum(['designing', 'generating', 'generated', 'editing', 'confirmed']),
  panel_count: z.number().int().nonnegative(),
  frame_count: z.number().int().nonnegative(),
  balloon_count: z.number().int().nonnegative(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const pagesResponseSchema = z.object({
  pages: z.array(pageSchema),
  next_cursor: z.string().min(1).max(512).nullable().optional(),
});

export const pageJobAcceptedResponseSchema = z
  .object({
    job_id: idSchema,
  })
  .strict();

export const pageAutofillResponseSchema = z.object({
  updated_panel_count: z.number().int().nonnegative(),
  filled_field_count: z.number().int().nonnegative(),
  compiler_used: z.boolean(),
  compiler_provider: z.enum(['openai', 'fallback']),
  compiler_model: nullableStringSchema,
  compiler_prompt_version: nullableStringSchema,
  compiler_error: nullableStringSchema,
});

const jobProgressFields = {
  progress_stage: z.string().nullable().optional(),
  progress_message: z.string().nullable().optional(),
  progress_current_chunk: z.number().int().nonnegative().nullable().optional(),
  progress_total_chunks: z.number().int().nonnegative().nullable().optional(),
  progress_started_at: timestampSchema.nullable().optional(),
  progress_updated_at: timestampSchema.nullable().optional(),
};

const jobCompilerResultFields = {
  updated_page_count: z.number().int().nonnegative().nullable().optional(),
  updated_panel_count: z.number().int().nonnegative().nullable().optional(),
  updated_assignment_count: z.number().int().nonnegative().nullable().optional(),
  filled_field_count: z.number().int().nonnegative().nullable().optional(),
  compiler_used: z.boolean().nullable().optional(),
  compiler_provider: z.enum(['openai', 'fallback']).nullable().optional(),
  compiler_model: nullableStringSchema.optional(),
  compiler_prompt_version: nullableStringSchema.optional(),
  compiler_error: nullableStringSchema.optional(),
};

const pageGenerationJobResultSchema = z
  .object({
    generation_mode: pageGenerationModeSchema.nullable().optional(),
    request_kind: z.enum(['initial', 'regenerate']).optional(),
    generated_image: z
      .object({
        ...imageProvenanceFields,
        generation_mode: pageGenerationModeSchema.nullable().optional(),
        generated_at: timestampSchema.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const entityGenerationJobResultSchema = z
  .object({
    ...imageProvenanceFields,
    provider_result: z.boolean(),
    candidates: z
      .array(
        z
          .object({
            candidate_token: idSchema,
            cdn_url: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const episodeStateSourceFieldSchema = z.enum([
  'story_full_draft', 'introduction', 'middle', 'climax', 'ending_hook',
  'scene_location', 'scene_time', 'scene_atmosphere',
]);
export const episodeStateTransitionResultSchema = z.object({
  entity_id: idSchema,
  state_id: idSchema.nullable(),
  starts_at_panel_id: idSchema,
  source_scene_id: idSchema.nullable(),
  source_field: episodeStateSourceFieldSchema,
  source_quote: z.string().trim().min(1).max(300),
}).strict();
const episodeStateBlockerCandidateSchema = z.object({
  entity_id: idSchema,
  candidate_state_id: idSchema.nullable(),
  starts_at_panel_id: idSchema,
  suggested_name: z.string().trim().min(1).max(100),
  suggested_description: z.string().trim().min(1).max(500),
  source_scene_id: idSchema.nullable(),
  source_field: episodeStateSourceFieldSchema,
  source_quote: z.string().trim().min(1).max(300),
  reason: z.enum(['missing_reference', 'ambiguous_mapping']),
}).strict();
export const episodeStateBlockerSchema = z.object({
  code: z.enum([
    'STATE_PLAN_INVALID', 'STATE_ASSIGNMENT_CONFLICT', 'STATE_REFERENCE_REQUIRED',
    'STATE_MAPPING_AMBIGUOUS', 'LIMIT_EXCEEDED',
  ]),
  candidates: z.array(episodeStateBlockerCandidateSchema).max(20),
}).strict();

const episodeStoryAutofillJobResultSchema = z
  .object({
    ...jobCompilerResultFields,
    ...jobProgressFields,
    state_plan_version: z.literal('episode_state_plan_v1').optional(),
    state_assignment_policy: z.enum(['preserve_existing', 'overwrite_existing']).optional(),
    state_transitions: z.array(episodeStateTransitionResultSchema).max(512).optional(),
    state_blocker: episodeStateBlockerSchema.optional(),
  })
  .strict();

const storyPlanJobResultSchema = z
  .object({
    ...jobCompilerResultFields,
  })
  .strict();

const episodePageSkeletonJobResultSchema = z
  .object({
    pages_created: z.number().int().nonnegative().nullable().optional(),
    panels_created: z.number().int().nonnegative().nullable().optional(),
    replaced_existing: z.boolean().nullable().optional(),
    story_plan_applied: z.boolean().nullable().optional(),
    story_plan_result: storyPlanJobResultSchema.nullable().optional(),
    ...jobProgressFields,
  })
  .strict();

const generationJobCommonFields = {
  id: idSchema,
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled', 'canceled']),
  credit_settlement: z.object({ charged_credits: z.number().int().nonnegative(), refunded_credits: z.number().int().nonnegative(), net_credits: z.number().int().nonnegative(), status: z.enum(['not_charged', 'charged', 'refunded', 'partially_refunded', 'refund_pending']) }).strict().optional(),
  error_code: nullableStringSchema.optional(), message_key: nullableStringSchema.optional(), retryable: z.boolean().optional(), support_id: nullableStringSchema.optional(),
  progress_stage: z.enum(['queued', 'compiling', 'preparing_references', 'generating', 'saving', 'completed']).nullable().optional(),
  progress_percent: z.number().min(0).max(100).nullable().optional(), progress_updated_at: timestampSchema.nullable().optional(), updated_at: timestampSchema.optional(),
  actions: z.object({ cancel: z.object({ available: z.boolean(), reason_key: nullableStringSchema }).strict(), hide: z.object({ available: z.boolean(), reason_key: nullableStringSchema }).strict() }).strict().optional(),
  generation_mode: pageGenerationModeSchema.nullable(),
  credit_cost: z.number().int().nonnegative(),
  error_message: nullableStringSchema,
  retry_count: z.number().int().nonnegative(),
  created_at: timestampSchema,
  started_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
  expires_at: timestampSchema.nullable(),
  cancel_requested_at: timestampSchema.nullable(),
  cancelled_at: timestampSchema.nullable(),
  commit_started_at: timestampSchema.nullable(),
};

const pageGenerationJobResponseSchema = z
  .object({
    ...generationJobCommonFields,
    job_type: z.literal('page_generate'),
    params: z
      .object({
        page_id: idSchema.optional(),
        request_kind: z.enum(['initial', 'regenerate']).optional(),
        generation_mode: pageGenerationModeSchema.optional(),
        quality: z.enum(['medium', 'high']).optional(),
        requires_planner: z.boolean().optional(),
      })
      .strict(),
    result: pageGenerationJobResultSchema.nullable(),
  })
  .strict();

const entityGenerationJobResponseSchema = z
  .object({
    ...generationJobCommonFields,
    job_type: z.literal('entity_generate'),
    params: z
      .object({
        entity_id: idSchema.optional(),
        target: z.literal('entity_state').optional(),
        entity_state_id: idSchema.optional(),
        state_revision: timestampSchema.optional(),
        entity_type: z.enum(['character', 'nonhuman', 'object']).optional(),
      })
      .strict(),
    result: entityGenerationJobResultSchema.nullable(),
  })
  .strict();

const episodeStoryAutofillJobResponseSchema = z
  .object({
    ...generationJobCommonFields,
    job_type: z.literal('episode_story_autofill'),
    params: z
      .object({
        episode_id: idSchema.optional(),
        language: z.enum(['ja', 'en']).optional(),
        state_autofill_version: z.literal('v1').optional(),
        state_assignment_policy: z.enum(['preserve_existing', 'overwrite_existing']).optional(),
      })
      .strict()
      .refine(
        (params) => params.state_autofill_version === undefined
          ? params.state_assignment_policy === undefined
          : params.state_assignment_policy !== undefined,
        { message: 'state autofill version and policy must be paired' },
      ),
    result: episodeStoryAutofillJobResultSchema.nullable(),
  })
  .strict();

const episodePageSkeletonJobResponseSchema = z
  .object({
    ...generationJobCommonFields,
    job_type: z.literal('episode_page_skeleton'),
    params: z
      .object({
        episode_id: idSchema.optional(),
        overwrite_existing: z.boolean().optional(),
        apply_story_plan: z.boolean().optional(),
        language: z.enum(['ja', 'en']).optional(),
      })
      .strict(),
    result: episodePageSkeletonJobResultSchema.nullable(),
  })
  .strict();

export const generationJobResponseSchema = z.discriminatedUnion('job_type', [
  pageGenerationJobResponseSchema,
  entityGenerationJobResponseSchema,
  episodeStoryAutofillJobResponseSchema,
  episodePageSkeletonJobResponseSchema,
  z.object({
    ...generationJobCommonFields,
    job_type: z.literal('entity_import_analysis'),
    params: z.object({
      entity_id: idSchema.nullable().optional(),
      entity_type: z.enum(['character', 'nonhuman', 'object']).optional(),
    }).strict(),
    result: entityImportResponseSchema.nullable(),
  }).strict(),
]);

export const generationJobHistoryResponseSchema = z
  .object({
    jobs: z.array(generationJobResponseSchema),
    next_cursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

export const compositionSchema = z.object({
  id: idSchema,
  name: z.string(),
  category: z.string(),
  entity_count: z.number().int().nonnegative(),
  preview_cdn_url: nullableStringSchema,
  composition_prompt: z.string(),
  shot_type: nullableStringSchema,
  angle: nullableStringSchema,
  tags: z.array(z.string()),
  created_at: timestampSchema,
});

export const balloonSchema = z.object({
  id: idSchema,
  page_id: idSchema,
  speaker_entity_id: nullableStringSchema,
  balloon_type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx', 'caption']),
  writing_mode: z.enum(['horizontal', 'vertical']),
  text: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  tail: z.object({
    base_x: z.number(),
    base_y: z.number(),
    tip_x: z.number(),
    tip_y: z.number(),
  }).nullable(),
  font_size: z.number().int().positive(),
  font_family: z.enum(['manga_gothic', 'mincho', 'rounded', 'bold']),
  panel_order_reference: z.number().int().nullable(),
  z_index: z.number().int(),
});

export const balloonsResponseSchema = z.object({
  balloons: z.array(balloonSchema),
});

export const panelEntityAssignmentSchema = z.object({
  entity_id: idSchema,
  role: z.enum(['primary', 'secondary', 'background']),
  expression: z.enum(['determined', 'calm', 'angry', 'sad', 'surprised', 'custom']),
  custom_expression: nullableStringSchema,
  action: z.enum(['standing_firm', 'attacking', 'defending', 'running', 'custom']),
  custom_action: nullableStringSchema,
  position: z.enum(['left', 'center', 'right', 'background']),
  facing_direction: z
    .enum(['front', 'left', 'right', 'away', 'three_quarter_left', 'three_quarter_right'])
    .nullable(),
  effect_note: nullableStringSchema,
  state_id: nullableStringSchema,
});

export const panelAssignmentsResponseSchema = z.object({
  entities: z.array(panelEntityAssignmentSchema),
});

const panelDialogueSchema = z.object({
  entity_id: nullableStringSchema,
  text: z.string(),
  type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx']),
  position: z.enum(['top', 'bottom', 'left', 'right', 'center']),
});

export const panelSchema = z.object({
  id: idSchema,
  page_id: idSchema,
  order: z.number().int().positive(),
  panel_role: z.enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact']),
  panel_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']),
  situation_text: nullableStringSchema,
  entities: z.array(panelEntityAssignmentSchema),
  composition: z.object({
    source: z.enum(['gallery', 'custom', 'ai_auto']),
    gallery_item_id: nullableStringSchema,
    composition_prompt: nullableStringSchema,
    shot_type: nullableStringSchema,
    angle: nullableStringSchema,
    custom_note: nullableStringSchema,
  }),
  dialogue_in_panel: z.boolean(),
  dialogue: z.array(panelDialogueSchema),
  sfx_text: nullableStringSchema,
  background_note: nullableStringSchema,
  panel_notes: nullableStringSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const panelsResponseSchema = z.object({
  panels: z.array(panelSchema),
});

export const panelFrameSchema = z.object({
  id: idSchema,
  page_id: idSchema,
  panel_id: nullableStringSchema,
  vertices: z.array(z.object({ x: z.number(), y: z.number() })).min(3),
  border_style: z.enum(['solid', 'dashed', 'none']),
  border_width: z.number().nonnegative(),
  border_color: z.string(),
  z_index: z.number().int(),
  reading_order: z.number().int().nonnegative(),
});

export const framesResponseSchema = z.object({
  frames: z.array(panelFrameSchema),
});

export const frameTemplateResponseSchema = z.object({
  template_id: idSchema,
  panel_count: z.number().int().nonnegative(),
  frames: z.array(panelFrameSchema),
});

const pageLayoutTemplateIdSchema = z.enum([
  'standard_4',
  'stacked_wide_4',
  'top_wide_3',
  'standard_6',
  'dense_8',
  'climax_2',
  'splash_1',
  'action_5',
  'battle_7',
  'vertical_2',
  'bottom_wide_3',
  'wide_top_4',
  'wide_bottom_4',
  'tall_left_4',
  'right_tall_4',
  'balanced_5',
  'middle_wide_5',
  'top_wide_5',
  'split_6',
]);

export const pageLayoutTemplateResponseSchema = z.object({
  template_id: pageLayoutTemplateIdSchema,
  panel_count: z.number().int().nonnegative(),
  created_panel_count: z.number().int().nonnegative(),
  deleted_panel_count: z.number().int().nonnegative(),
  frames: z.array(panelFrameSchema),
});

const uniquePagePanelIdsSchema = z.array(z.string().uuid()).max(8).superRefine((panelIds, context) => {
  if (new Set(panelIds).size !== panelIds.length) {
    context.addIssue({ code: 'custom', message: 'Panel ids must not contain duplicates' });
  }
});

export const pagePanelStructureRequestSchema = z
  .object({
    expected_panel_ids: uniquePagePanelIdsSchema,
    operation: z.discriminatedUnion('type', [
      z.object({ type: z.literal('append') }).strict(),
      z.object({ type: z.literal('insert_after'), panel_id: z.string().uuid() }).strict(),
      z.object({ type: z.literal('delete'), panel_id: z.string().uuid() }).strict(),
      z.object({ type: z.literal('reorder'), panel_ids: uniquePagePanelIdsSchema.min(1) }).strict(),
    ]),
  })
  .strict();

export const pagePanelStructureResponseSchema = z
  .object({
    panel_ids: z.array(idSchema).max(8),
    created_panel_id: idSchema.nullable(),
    layout_template_id: pageLayoutTemplateIdSchema.nullable(),
    frames: z.array(panelFrameSchema).max(8),
    balloon_reference_updated_count: z.number().int().nonnegative(),
    balloon_reference_cleared_count: z.number().int().nonnegative(),
  })
  .strict();

export const compositionsResponseSchema = z.object({
  compositions: z.array(compositionSchema),
});

const generationQuoteOperationSchema = z.enum([
  'page_generate', 'page_regenerate', 'entity_preview', 'entity_state_preview', 'entity_import_analysis',
]);

export const generationQuoteRequestSchema = z.object({
  operation: generationQuoteOperationSchema,
  target_id: z.string().uuid().optional(),
  entity_id: z.string().uuid().optional(),
  upload_token: z.string().min(1).max(256).optional(),
  entity_type: z.enum(['character', 'nonhuman', 'object']).optional(),
  source_ref_id: z.string().min(1).max(200).optional(),
  source_candidate_token: z.string().min(1).max(4096).optional(),
  image_model: z.string().min(1).max(80).optional(),
  quality: z.literal('medium').optional(),
  render_style: z.enum(['color', 'monochrome']).optional(),
  expected_revision: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
}).strict().superRefine((request, context) => {
  if (request.operation === 'entity_import_analysis') {
    if (request.upload_token === undefined || request.entity_type === undefined || request.target_id !== undefined) {
      context.addIssue({ code: 'custom', message: 'Import quotes require an upload token and entity type, without a target id' });
    }
  } else if (request.target_id === undefined || request.upload_token !== undefined || request.entity_type !== undefined) {
    context.addIssue({ code: 'custom', message: 'Generation quotes require a target id, without import fields' });
  }
  if (request.operation !== 'entity_preview' && (request.source_ref_id !== undefined || request.source_candidate_token !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Source reference selection only applies to entity preview' });
  }
  if (request.source_ref_id !== undefined && request.source_candidate_token !== undefined) {
    context.addIssue({ code: 'custom', message: 'Choose only one source reference' });
  }
});

export const generationQuoteAcceptanceSchema = z.object({
  quote_token: z.string().min(1).max(128),
  request_key: z.string().uuid(),
}).strict();

export const generationQuoteResponseSchema = z.object({
  quote_id: z.string().uuid(),
  quote_token: z.string().min(1).max(128),
  operation: generationQuoteOperationSchema,
  target_id: z.string().uuid(),
  billing_scope: z.object({ kind: z.enum(['personal', 'organization']), organization_id: z.string().uuid().nullable() }).strict(),
  image_model: z.literal('gpt-image-2').nullable(),
  quality: z.literal('medium').nullable(),
  render_style: z.enum(['color', 'monochrome']).nullable(),
  reference_count: z.number().int().min(0).max(12),
  amount_credits: z.number().int().positive(),
  pricing_version: z.string().min(1).max(100),
  input_revision: z.string().regex(/^[0-9a-f]{64}$/u),
  expires_at: z.string().datetime(),
  blockers: z.array(z.string().max(200)).max(20),
}).strict();

export const generationQuoteReceiptSchema = z.object({
  quote_id: z.string().uuid(),
  job_id: z.string().uuid().nullable(),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']).nullable(),
  amount_credits: z.number().int().positive(),
  charged_credits: z.number().int().nonnegative(),
  refunded_credits: z.number().int().nonnegative(),
  accepted_at: z.string().datetime().nullable(),
  expires_at: z.string().datetime(),
}).strict();


// Google link receipts carry no provider token, email, subject, or secret.
export const googleAuthCapabilitiesSchema = z.object({
  google_sign_in: z.boolean(), google_linking: z.boolean(), google_ios: z.literal(false),
}).strict();
export const googleLinkStateSchema = z.enum(['pending', 'processing', 'linked', 'cancelled', 'expired', 'failed', 'recovery_required']);
export const googleLinkStartBodySchema = z.object({ platform: z.enum(['mobile', 'web']), request_key: z.string().uuid() }).strict();
export const googleLinkStatusSchema = z.object({
  challenge_id: z.string().uuid(), status: googleLinkStateSchema, expires_at: z.iso.datetime({ offset: true }),
  message_code: z.string().max(120).optional(), requires_reauthentication: z.boolean(),
}).strict();
export const googleLinkStartSchema = googleLinkStatusSchema.extend({ authorization_url: z.string().url().nullable() }).strict();


export const deployedAccountDeletionPreviewSchema = z.object({
  personal_data: z.object({ account: z.literal('anonymized'), personal_works: z.literal('deleted'), organization_memberships: z.literal('removed') }).strict(),
  unique_owner_organizations: z.array(z.object({ id: idSchema, name: z.string() }).strict()).max(25),
  active_personal_subscription_count: z.number().int().nonnegative(),
  active_stripe_subscription_count: z.number().int().nonnegative(),
  active_mobile_store_subscription_count: z.number().int().nonnegative(),
  confirmed_personal_asset_count: z.number().int().nonnegative(),
}).strict();
export const deployedAccountDeletionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('blocked'), blockers: z.array(z.discriminatedUnion('code', [
    z.object({ code: z.literal('UNIQUE_ORGANIZATION_OWNER'), organizations: z.array(z.object({ id: idSchema, name: z.string() })) }),
    z.object({ code: z.literal('ACTIVE_PERSONAL_SUBSCRIPTION'), subscription_count: z.number().int().nonnegative() }),
    z.object({ code: z.literal('CONFIRMED_PERSONAL_ASSETS'), asset_count: z.number().int().nonnegative() }),
  ])) }).strict(),
  z.object({ status: z.literal('in_progress'), blockers: z.array(z.never()).max(0) }).strict(),
  z.object({ status: z.literal('completed'), blockers: z.array(z.never()).max(0) }).strict(),
  z.object({ status: z.literal('pending_external_action'), blockers: z.array(z.never()).max(0),
    next_action: z.enum(['cancel_subscription', 'disable_identity', 'delete_identity', 'schedule_asset_lifecycle', 'anonymize_personal_data']) }).strict(),
]);

export const pushTokenRegistrationSchema = z.object({
  status: z.literal('registered'), installation_id: z.string().uuid(), platform: z.enum(['ios', 'android']),
}).strict();

export const pageGenerationReadinessSchema = z.object({
  ready: z.boolean(),
  blockers: z.array(
    z.object({
      code: z.enum([
        'GENERATION_DISABLED',
        'FRAME_REQUIRED',
        'PANEL_REQUIRED',
        'FRAME_PANEL_MISMATCH',
        'PANEL_ORDER_INVALID',
        'DIALOGUE_SPEAKER_REQUIRED',
        'DIALOGUE_SPEAKER_INVALID',
        'DIALOGUE_SPEAKER_NOT_IN_PANEL',
        'ASSIGNED_ENTITY_INVALID',
        'PAGE_GENERATING',
        'PAGE_REOPEN_REQUIRED',
        'CHARACTER_REFERENCE_REQUIRED',
        'CHARACTER_REFERENCE_MODEL_INCOMPATIBLE',
        'REFERENCE_IMAGE_LIMIT_EXCEEDED',
        'ACTIVE_GENERATION_JOB',
        'INSUFFICIENT_CREDITS'
      ]),
      entity_id: nullableStringSchema,
      field: z.enum(['generation', 'frames', 'panels', 'entities', 'dialogue', 'status']),
      action: z.enum([
        'open_layout',
        'open_panels',
        'open_characters',
        'reopen_page',
        'wait_for_generation',
        'none'
      ]),
      message_key: z.string().min(1)
    })
  ),
  warnings: z.array(z.string()),
  estimated_credit_cost: z.number().int().nonnegative(),
  page_revision: timestampSchema
});

export const saveAndGeneratePageResponseSchema = z.object({
  job_id: idSchema,
  page_revision: timestampSchema
});

export {
  accountDeletionPreviewSchema,
  accountDeletionResultSchema,
  apiErrorBodySchema,
  createEpisodeExportResponseSchema,
  entityReferenceGenerationAvailabilitySchema,
  exportJobSchema,
  generationJobSchema,
  generationJobsResponseSchema,
  jobAcceptedSchema,
  layoutTemplateResponseSchema,
  organizationBillingSummarySchema,
  organizationCreditCheckoutSchema,
  organizationCustomerPortalSchema,
  organizationInvitationActionResponseSchema,
  organizationInvitationPreviewSchema,
  organizationInvitationUpdateResponseSchema,
  organizationMemberUpdateResponseSchema,
  organizationPlansResponseSchema,
  organizationSubscriptionCheckoutSchema,
  organizationUpdateResponseSchema,
  organizationWorkspaceDetailSchema,
  organizationWorkspacesResponseSchema,
  pageLayoutTemplatesResponseSchema,
} from './mobileCompatibilitySchemas';
