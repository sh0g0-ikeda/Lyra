// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.
import { z } from 'zod';

const id = z.string().min(1);
const timestamp = z.string().min(1);
const nullableString = z.string().nullable();
const nextCursor = z.string().min(1).max(1024).nullable().optional().default(null);
const unknownRecord = z.record(z.string(), z.unknown());
const storyStatus = z.enum(['draft', 'reviewing', 'ready']);
const organizationRoleSchema = z.enum(['owner', 'admin', 'billing', 'editor', 'viewer']);
const organizationStatusSchema = z.enum(['active', 'trialing', 'past_due', 'suspended', 'canceled']);
const organizationMemberStatusSchema = z.enum(['invited', 'active', 'suspended', 'removed']);
const organizationInvitationStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired']);
const organizationInvitationSendStatusSchema = z.enum(['not_sent', 'sending', 'sent', 'failed']);
const organizationEnterprisePlanSchema = z.enum(['enterprise_a', 'enterprise_b', 'enterprise_c']);
const organizationSubscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired'
]);

export const workSchema = z.object({
  id,
  organization_id: nullableString,
  title: z.string(),
  genre: nullableString,
  world_setting: nullableString,
  theme: nullableString,
  main_entity_ids: z.array(id),
  starting_point: nullableString,
  ending_point: nullableString,
  overall_flow: nullableString,
  version: z.number().int().nonnegative(),
  status: storyStatus,
  created_at: timestamp,
  updated_at: timestamp
});

export const chapterSchema = z.object({
  id,
  work_id: id,
  order: z.number().int().positive(),
  title: nullableString,
  purpose: nullableString,
  starting_state: nullableString,
  ending_state: nullableString,
  emotion_curve: nullableString,
  entities_involved: z.array(id),
  key_beats: z.array(z.string()),
  version: z.number().int().nonnegative(),
  status: storyStatus,
  created_at: timestamp,
  updated_at: timestamp
});

export const episodeSchema = z.object({
  id,
  chapter_id: id,
  order: z.number().int().positive(),
  title: nullableString,
  purpose: nullableString,
  story_input_mode: z.enum(['structured', 'full']),
  story_full_draft: nullableString,
  introduction: nullableString,
  middle: nullableString,
  climax: nullableString,
  ending_hook: nullableString,
  estimated_pages: z.number().int().positive(),
  entities_involved: z.array(id),
  page_skeleton_generated: z.boolean(),
  version: z.number().int().nonnegative(),
  status: storyStatus,
  created_at: timestamp,
  updated_at: timestamp
});

export const entitySchema = z.object({
  id,
  work_id: id,
  entity_type: z.enum(['character', 'nonhuman', 'object']),
  name: z.string(),
  free_description: nullableString,
  structured_fields: unknownRecord,
  prompt_supplement: nullableString,
  speech_profile: unknownRecord,
  status: z.enum(['draft', 'ready']),
  created_at: timestamp,
  updated_at: timestamp
});

const entityReferenceImageSchema = z.object({
  ref_id: id,
  cdn_url: z.string().nullable().optional(),
  source: z.enum(['upload', 'generated']),
  created_at: timestamp
});

export const entityReferenceSetSchema = z.object({
  entity_id: id,
  primary_ref_id: nullableString,
  status: z.enum(['empty', 'partial', 'ready']),
  updated_at: timestamp,
  reference_images: z.array(entityReferenceImageSchema)
});

const entityReferenceUploadMimeTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

export const entityReferenceUploadPresignResponseSchema = z
  .object({
    upload_url: z
      .string()
      .url()
      .max(4096)
      .refine((value) => value.startsWith('https://'), 'upload_url must use HTTPS'),
    upload_token: z.string().min(1).max(512),
    expires_at: timestamp,
    upload_headers: z
      .object({
        'Content-Type': entityReferenceUploadMimeTypeSchema,
        'x-amz-server-side-encryption': z.literal('AES256')
      })
      .strict()
  })
  .strict();

export const sceneSchema = z.object({
  id,
  episode_id: id,
  order: z.number().int().positive(),
  location: nullableString,
  time: nullableString,
  atmosphere: nullableString,
  involved_entity_ids: z.array(id),
  entity_states: z.array(z.object({ entity_id: id, state_id: id })),
  status: storyStatus,
  created_at: timestamp,
  updated_at: timestamp
});

export const entityStateSchema = z.object({
  id,
  entity_id: id,
  scene_id: nullableString,
  costume_note: nullableString,
  costume_ref_id: nullableString,
  condition_note: nullableString,
  hair_note: nullableString,
  expression_default: z.string().min(1).max(100),
  extra_note: nullableString,
  created_at: timestamp
});

const generatedImageSchema = z.object({
  cdn_url: z.string().nullable().optional(),
  generation_mode: z.enum(['standard', 'thinking']).nullable(),
  generated_at: nullableString
});

export const pageSchema = z.object({
  id,
  episode_id: id,
  page_number: z.number().int().positive(),
  layout_config: unknownRecord,
  story_source_scene_ids: z.array(id),
  story_page_purpose: nullableString,
  story_continuity_note: nullableString,
  dialogue_mode: z.enum(['image_baked', 'balloon_only', 'mixed']),
  page_dialogue_toggle: z.boolean(),
  generation_mode: z.enum(['standard', 'thinking']).nullable(),
  generated_image: generatedImageSchema.nullable(),
  status: z.enum(['designing', 'generating', 'generated', 'editing', 'confirmed']),
  panel_count: z.number().int().nonnegative(),
  frame_count: z.number().int().nonnegative(),
  balloon_count: z.number().int().nonnegative(),
  created_at: timestamp,
  updated_at: timestamp
});

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
        'DIALOGUE_SPEAKER_NOT_IN_PANEL',
        'ASSIGNED_ENTITY_INVALID',
        'PAGE_GENERATING',
        'PAGE_REOPEN_REQUIRED',
        'CHARACTER_REFERENCE_REQUIRED',
        'REFERENCE_IMAGE_LIMIT_EXCEEDED',
        'ACTIVE_GENERATION_JOB',
        'INSUFFICIENT_CREDITS'
      ]),
      entity_id: nullableString,
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
  page_revision: timestamp
});

export const saveAndGeneratePageResponseSchema = z.object({
  job_id: id,
  page_revision: timestamp
});

const pageLayoutTemplateFrameSchema = z.object({
  vertices: z
    .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .length(4),
  border_style: z.enum(['solid', 'dashed', 'none']),
  border_width: z.number().min(0).max(20),
  border_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  z_index: z.number().int(),
  reading_order: z.number().int().positive()
});

export const pageLayoutTemplatesResponseSchema = z.object({
  templates: z.array(
    z.object({
      id,
      label_key: z.string().min(1),
      panel_count: z.number().int().min(1).max(20),
      reading_direction: z.literal('right_to_left_top_to_bottom'),
      preview_aspect_ratio: z.number().positive(),
      supported_page_sizes: z.tuple([z.literal('normalized_portrait')]),
      frames: z.array(pageLayoutTemplateFrameSchema).min(1).max(20)
    })
  )
});

const panelDialogueSchema = z.object({
  entity_id: nullableString,
  text: z.string(),
  type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx']),
  position: z.enum(['top', 'bottom', 'left', 'right', 'center'])
});

export const panelEntityAssignmentSchema = z.object({
  entity_id: id,
  role: z.enum(['primary', 'secondary', 'background']),
  expression: z.enum(['determined', 'calm', 'angry', 'sad', 'surprised', 'custom']),
  custom_expression: nullableString,
  action: z.enum(['standing_firm', 'attacking', 'defending', 'running', 'custom']),
  custom_action: nullableString,
  position: z.enum(['left', 'center', 'right', 'background']),
  facing_direction: z
    .enum(['front', 'left', 'right', 'away', 'three_quarter_left', 'three_quarter_right'])
    .nullable(),
  effect_note: nullableString,
  state_id: nullableString
});

export const panelSchema = z.object({
  id,
  page_id: id,
  order: z.number().int().positive(),
  panel_role: z.enum(['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact']),
  panel_size: z.enum(['standard', 'large', 'wide', 'narrow', 'splash']),
  situation_text: nullableString,
  entities: z.array(panelEntityAssignmentSchema),
  composition: z.object({
    source: z.enum(['gallery', 'custom', 'ai_auto']),
    gallery_item_id: nullableString,
    composition_prompt: nullableString,
    shot_type: nullableString,
    angle: nullableString,
    custom_note: nullableString
  }),
  dialogue_in_panel: z.boolean(),
  dialogue: z.array(panelDialogueSchema),
  sfx_text: nullableString,
  background_note: nullableString,
  panel_notes: nullableString,
  created_at: timestamp,
  updated_at: timestamp
});

export const panelFrameSchema = z.object({
  id,
  page_id: id,
  panel_id: nullableString,
  vertices: z.array(z.object({ x: z.number(), y: z.number() })).min(3),
  border_style: z.enum(['solid', 'dashed', 'none']),
  border_width: z.number().nonnegative(),
  border_color: z.string(),
  z_index: z.number().int(),
  reading_order: z.number().int().nonnegative()
});

export const balloonSchema = z.object({
  id,
  page_id: id,
  speaker_entity_id: nullableString,
  balloon_type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper']),
  writing_mode: z.enum(['horizontal', 'vertical']),
  text: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive()
  }),
  tail: z
    .object({
      base_x: z.number(),
      base_y: z.number(),
      tip_x: z.number(),
      tip_y: z.number()
    })
    .nullable(),
  font_size: z.number().positive(),
  font_family: z.enum(['manga_gothic', 'mincho', 'rounded', 'bold']),
  panel_order_reference: z.number().int().nullable(),
  z_index: z.number().int()
});

export const compositionSchema = z.object({
  id,
  name: z.string(),
  category: z.string(),
  entity_count: z.number().int().nonnegative(),
  preview_cdn_url: nullableString,
  composition_prompt: z.string(),
  shot_type: nullableString,
  angle: nullableString,
  tags: z.array(z.string()),
  created_at: timestamp
});

export const generationJobSchema = z.object({
  id,
  job_type: z.enum(['page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton']),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'canceled']),
  generation_mode: z.enum(['standard', 'thinking']).nullable(),
  credit_cost: z.number().int().nonnegative(),
  credit_settlement: z.object({
    charged_credits: z.number().int().nonnegative(),
    refunded_credits: z.number().int().nonnegative(),
    net_credits: z.number().int().nonnegative(),
    status: z.enum([
      'not_charged',
      'charged',
      'refunded',
      'partially_refunded',
      'refund_pending'
    ])
  }),
  params: unknownRecord,
  result: unknownRecord.nullable(),
  error_message: nullableString,
  error_code: nullableString,
  message_key: nullableString,
  retryable: z.boolean(),
  support_id: nullableString,
  progress_stage: z.enum(['queued', 'compiling', 'preparing_references', 'generating', 'saving', 'completed']).nullable(),
  progress_percent: z.number().min(0).max(100).nullable(),
  progress_updated_at: nullableString,
  updated_at: timestamp,
  actions: z.object({
    cancel: z.object({
      available: z.boolean(),
      reason_key: nullableString
    }),
    hide: z.object({
      available: z.boolean(),
      reason_key: nullableString
    })
  }),
  retry_count: z.number().int().nonnegative(),
  created_at: timestamp,
  started_at: nullableString,
  completed_at: nullableString,
  expires_at: nullableString
});

export const generationJobsResponseSchema = z.object({
  jobs: z.array(generationJobSchema),
  next_cursor: nullableString
});

const exportTimestampSchema = z.string().datetime({ offset: true }).max(64);
const boundedExportKeySchema = z.string().min(1).max(128).nullable();

const exportJobBaseSchema = z.object({
  id: id.max(128),
  episode_id: id.max(128),
  format: z.enum(['pdf', 'zip']),
  filename: z.string().min(1).max(160),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'canceled']),
  progress_stage: z.string().min(1).max(100),
  progress_percent: z.number().int().min(0).max(100),
  error_code: boundedExportKeySchema,
  message_key: boundedExportKeySchema,
  expires_at: exportTimestampSchema,
  completed_at: exportTimestampSchema.nullable(),
  cancel_supported: z.literal(false),
  cancel_reason_code: z.literal('EXPORT_CANCEL_UNSUPPORTED').nullable(),
  download_url: z.string().url().max(2048).optional()
});

export const exportJobSchema = exportJobBaseSchema.superRefine((value, context) => {
  if (value.status !== 'completed' && value.download_url !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'download_url is only available after export completion',
      path: ['download_url']
    });
  }
});

export const createEpisodeExportResponseSchema = z.object({
  job_id: id.max(128),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'canceled'])
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
  configured: z.boolean()
});

const organizationDetailSchema = z.object({
  id,
  type: z.enum(['business', 'internal']),
  name: z.string().min(1).max(120),
  legal_name: nullableString,
  status: organizationStatusSchema,
  plan_key: organizationEnterprisePlanSchema,
  billing_email: z.string().email().max(320).nullable(),
  created_by_user_id: id,
  created_at: timestamp,
  updated_at: timestamp
});

export const organizationMemberSchema = z.object({
  id,
  organization_id: id,
  user_id: id,
  email: z.string().email().max(320),
  display_name: nullableString,
  role: organizationRoleSchema,
  status: organizationMemberStatusSchema,
  invited_by_user_id: nullableString,
  joined_at: nullableString,
  created_at: timestamp,
  updated_at: timestamp
});

const organizationInvitationWireSchema = z.object({
  id,
  organization_id: id,
  email: z.string().email().max(320),
  role: organizationRoleSchema,
  status: organizationInvitationStatusSchema,
  send_status: organizationInvitationSendStatusSchema,
  send_error_code: nullableString,
  send_error_message: nullableString,
  sent_at: nullableString,
  last_sent_at: nullableString,
  resend_count: z.number().int().nonnegative(),
  invited_by_user_id: id,
  accepted_by_user_id: nullableString,
  expires_at: timestamp,
  accepted_at: nullableString,
  revoked_at: nullableString,
  revoked_by_user_id: nullableString,
  created_at: timestamp,
  updated_at: timestamp
});

export const organizationInvitationSchema = organizationInvitationWireSchema.transform((invitation) => ({
  id: invitation.id,
  organization_id: invitation.organization_id,
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  send_status: invitation.send_status,
  sent_at: invitation.sent_at,
  last_sent_at: invitation.last_sent_at,
  resend_count: invitation.resend_count,
  expires_at: invitation.expires_at,
  accepted_at: invitation.accepted_at,
  revoked_at: invitation.revoked_at,
  created_at: invitation.created_at,
  updated_at: invitation.updated_at
}));

export const organizationCreditBalanceSchema = z.object({
  organization_id: id,
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableString,
  updated_at: timestamp
});

export const organizationWorkspaceDetailSchema = z.object({
  organization: organizationDetailSchema,
  membership: organizationMemberSchema,
  balance: organizationCreditBalanceSchema.nullable()
});

export const organizationWorkspacesResponseSchema = z.object({
  organizations: z.array(organizationWorkspaceDetailSchema)
});

export const organizationUpdateResponseSchema = z
  .object({ organization: organizationDetailSchema })
  .transform(({ organization }) => organization);

export const organizationMemberUpdateResponseSchema = z
  .object({ member: organizationMemberSchema })
  .transform(({ member }) => member);

export const organizationMembersResponseSchema = z.object({
  members: z.array(organizationMemberSchema),
  next_cursor: nextCursor
});

export const organizationInvitationsResponseSchema = z.object({
  invitations: z.array(organizationInvitationSchema),
  next_cursor: nextCursor
});

export const organizationInvitationActionResponseSchema = z
  .object({
    invitation: organizationInvitationSchema,
    invitation_url: z.string().url().max(4096),
    email_delivery: z.unknown()
  })
  .transform(({ invitation }) => ({ invitation }));

export const organizationInvitationUpdateResponseSchema = z
  .object({ invitation: organizationInvitationSchema })
  .transform(({ invitation }) => ({ invitation }));

const organizationSubscriptionPlanSchema = subscriptionPlanSchema.extend({
  plan_code: organizationEnterprisePlanSchema
});

const organizationSubscriptionSummarySchema = z.object({
  organization_id: id,
  plan_code: organizationEnterprisePlanSchema,
  status: organizationSubscriptionStatusSchema,
  current_period_start: nullableString,
  current_period_end: nullableString,
  cancel_at_period_end: z.boolean()
});

export const organizationBillingSummarySchema = z.object({
  workspace: organizationWorkspaceDetailSchema,
  subscription: organizationSubscriptionSummarySchema.nullable(),
  subscription_plans: z.array(organizationSubscriptionPlanSchema)
});

export const organizationPlansResponseSchema = z.object({
  subscription_plans: z.array(organizationSubscriptionPlanSchema)
});

const secureExternalUrlSchema = z
  .string()
  .url()
  .max(4096)
  .refine((value) => value.startsWith('https://'), 'External URLs must use HTTPS');

export const organizationSubscriptionCheckoutSchema = z.object({
  session_id: z.string().min(1).max(512),
  url: secureExternalUrlSchema
});

export const organizationCreditCheckoutSchema = z.object({
  session_id: z.string().min(1).max(512),
  package_code: z.enum(['credits_200', 'credits_1000', 'credits_3000']),
  url: secureExternalUrlSchema
});

export const organizationCustomerPortalSchema = z.object({
  url: secureExternalUrlSchema
});

export const organizationInvoicesResponseSchema = z.object({
  invoices: z.array(
    z.object({
      id,
      organization_id: nullableString,
      kind: z.enum(['subscription', 'credit_purchase']),
      amount_jpy: z.number().int().nonnegative(),
      status: z.enum(['paid', 'failed']),
      invoice_url: secureExternalUrlSchema.nullable(),
      created_at: timestamp
    })
  )
});

const organizationUsageSummaryItemSchema = z.object({
  key: z.string().min(1).max(512),
  credits: z.number().int()
});

export const organizationUsageResponseSchema = z.object({
  usage_events: z.array(
    z.object({
      id,
      organization_id: id,
      user_id: nullableString,
      work_id: nullableString,
      generation_job_id: nullableString,
      event_type: z.string().min(1).max(200),
      credit_amount: z.number().int(),
      metadata: unknownRecord,
      created_at: timestamp
    })
  ),
  next_cursor: nextCursor,
  summary: z.object({
    current_month_total_credits: z.number().int(),
    by_member: z.array(organizationUsageSummaryItemSchema),
    by_work: z.array(organizationUsageSummaryItemSchema),
    by_generation_type: z.array(organizationUsageSummaryItemSchema)
  })
});

export const organizationAuditLogsResponseSchema = z.object({
  audit_logs: z.array(
    z.object({
      id,
      organization_id: id,
      actor_user_id: nullableString,
      action: z.string().min(1).max(200),
      target_type: z.string().min(1).max(200),
      target_id: nullableString,
      metadata: unknownRecord,
      created_at: timestamp
    })
  ),
  next_cursor: nextCursor
});

export const billingBalanceSchema = z.object({
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableString,
  plan_code: z.enum(['free', 'standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c']),
  current_period_end: nullableString,
  cancel_at_period_end: z.boolean(),
  subscription_plans: z.array(subscriptionPlanSchema)
});

export const mobilePurchaseAccountBindingSchema = z.object({
  apple_app_account_token: z.string().uuid(),
  google_obfuscated_account_id: z.string().min(8).max(256),
  subscription_purchase_allowed: z.boolean()
}).strict();

const mobileStoreProductSchema = z.object({
  product_id: z.string().trim().min(1).max(200),
  kind: z.enum(['subscription', 'credit_pack']),
  plan_code: z.enum(['standard', 'premium']).nullable(),
  credit_package_code: z.enum(['credits_200', 'credits_1000', 'credits_3000']).nullable()
}).strict().superRefine((product, context) => {
  const validSubscription =
    product.kind === 'subscription' &&
    product.plan_code !== null &&
    product.credit_package_code === null;
  const validCreditPack =
    product.kind === 'credit_pack' &&
    product.plan_code === null &&
    product.credit_package_code !== null;
  if (!validSubscription && !validCreditPack) {
    context.addIssue({
      code: 'custom',
      message: 'Store product has inconsistent logical codes'
    });
  }
});

export const mobileStoreProductCatalogSchema = z.object({
  store: z.enum(['apple', 'google']),
  products: z.array(mobileStoreProductSchema).max(20)
}).strict().superRefine((catalog, context) => {
  const productIds = new Set<string>();
  catalog.products.forEach((product, index) => {
    if (productIds.has(product.product_id)) {
      context.addIssue({
        code: 'custom',
        message: 'Store product id is duplicated',
        path: ['products', index, 'product_id']
      });
    }
    productIds.add(product.product_id);
  });
});

export const entityReferenceGenerationAvailabilitySchema = z.object({
  enabled: z.boolean()
}).strict();

export const mobileStorePurchaseResultSchema = z.object({
  store: z.enum(['apple', 'google']),
  state: z.enum(['pending', 'active', 'cancelled', 'expired', 'refunded', 'revoked', 'failed']),
  product_kind: z.enum(['subscription', 'credit_pack']),
  plan_code: z.enum(['standard', 'premium']).nullable(),
  credit_package_code: z.enum(['credits_200', 'credits_1000', 'credits_3000']).nullable(),
  credits_changed: z.number().int(),
  is_duplicate: z.boolean()
}).strict();

export const mobileStoreRestoreResultSchema = z.object({
  purchases: z.array(mobileStorePurchaseResultSchema).max(100)
}).strict();

const creditBalanceSchema = z.object({
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableString
});

export const currentSessionSchema = z.object({
  user: z.object({
    id,
    email: z.string().email(),
    display_name: nullableString,
    plan_code: z.string()
  }),
  personal_credits: creditBalanceSchema.nullable(),
  organizations: z.array(
    z.object({
      id,
      name: z.string(),
      status: z.string(),
      plan_key: z.string(),
      role: organizationRoleSchema,
      membership_status: z.string(),
      monthly_credits: z.number().int().nonnegative(),
      purchased_credits: z.number().int().nonnegative(),
      total_credits: z.number().int().nonnegative(),
      monthly_expires_at: nullableString
    })
  )
});

export const organizationInvitationPreviewSchema = z.object({
  organization: z.object({
    id,
    name: z.string()
  }),
  invitation: z.object({
    email: z.string().email(),
    role: organizationRoleSchema,
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    expires_at: timestamp
  })
});

export const organizationWorkspaceSchema = z.object({
  organization: z.object({
    id,
    name: z.string(),
    status: z.string(),
    plan_key: z.string()
  }),
  membership: z.object({
    role: organizationRoleSchema,
    status: z.string()
  }),
  balance: z
    .object({
      monthly_credits: z.number().int().nonnegative(),
      purchased_credits: z.number().int().nonnegative(),
      total_credits: z.number().int().nonnegative(),
      monthly_expires_at: nullableString
    })
    .nullable()
});

export const storyEpisodeImprovementSchema = z.object({
  draft: z.object({
    title: nullableString,
    purpose: nullableString,
    story_input_mode: z.enum(['structured', 'full']),
    story_full_draft: nullableString,
    introduction: nullableString,
    middle: nullableString,
    climax: nullableString,
    ending_hook: nullableString
  }),
  compiler_provider: z.enum(['openai', 'fallback']),
  compiler_model: nullableString,
  compiler_prompt_version: nullableString,
  compiler_error: nullableString
});

const accountDeletionBlockerSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('UNIQUE_ORGANIZATION_OWNER'),
    organizations: z.array(z.object({ id, name: z.string().min(1) }))
  }),
  z.object({
    code: z.literal('ACTIVE_PERSONAL_SUBSCRIPTION'),
    subscription_count: z.number().int().nonnegative()
  }),
  z.object({
    code: z.literal('CONFIRMED_PERSONAL_ASSETS'),
    asset_count: z.number().int().nonnegative()
  })
]);

export const accountDeletionPreviewSchema = z.object({
  personal_data: z.object({
    account: z.literal('anonymized'),
    personal_works: z.literal('deleted'),
    organization_memberships: z.literal('removed')
  }),
  unique_owner_organizations: z.array(z.object({ id, name: z.string().min(1) })),
  active_personal_subscription_count: z.number().int().nonnegative(),
  active_stripe_subscription_count: z.number().int().nonnegative(),
  active_mobile_store_subscription_count: z.number().int().nonnegative(),
  confirmed_personal_asset_count: z.number().int().nonnegative()
});

export const accountDeletionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('blocked'), blockers: z.array(accountDeletionBlockerSchema) }),
  z.object({ status: z.literal('in_progress'), blockers: z.tuple([]) }),
  z.object({
    status: z.literal('pending_external_action'),
    blockers: z.tuple([]),
    next_action: z.enum([
      'cancel_subscription',
      'disable_identity',
      'delete_identity',
      'schedule_asset_lifecycle',
      'anonymize_personal_data'
    ])
  }),
  z.object({ status: z.literal('completed'), blockers: z.tuple([]) })
]);

export const worksResponseSchema = z.object({
  works: z.array(workSchema),
  next_cursor: nextCursor
});
export const chaptersResponseSchema = z.object({ chapters: z.array(chapterSchema) });
export const episodesResponseSchema = z.object({ episodes: z.array(episodeSchema) });
export const entitiesResponseSchema = z.object({
  entities: z.array(entitySchema),
  next_cursor: nextCursor
});
export const scenesResponseSchema = z.object({ scenes: z.array(sceneSchema) });
export const entityStatesResponseSchema = z.object({ entity_states: z.array(entityStateSchema) });
export const pagesResponseSchema = z.object({
  pages: z.array(pageSchema),
  next_cursor: nextCursor
});
export const panelsResponseSchema = z.object({ panels: z.array(panelSchema) });
export const framesResponseSchema = z.object({ frames: z.array(panelFrameSchema) });
export const balloonsResponseSchema = z.object({ balloons: z.array(balloonSchema) });
export const compositionsResponseSchema = z.object({ compositions: z.array(compositionSchema) });
export const jobAcceptedSchema = z.object({ job_id: id });
export const pushTokenRegistrationSchema = z.object({
  status: z.literal('registered'),
  installation_id: z.string().uuid(),
  platform: z.enum(['ios', 'android'])
}).strict();
export const pageSkeletonResponseSchema = z.union([
  z
    .object({
      job_id: id,
      queued: z.literal(true),
      story_plan_applied: z.boolean()
    })
    .strict(),
  z
    .object({
      pages_created: z.number().int().nonnegative(),
      panels_created: z.number().int().nonnegative(),
      replaced_existing: z.boolean(),
      story_plan_applied: z.boolean(),
      story_plan_job_id: nullableString
    })
    .strict()
]);
export const entityImportResponseSchema = z.object({
  suggested_fields: unknownRecord,
  prompt_supplement: z.string(),
  tmp_image_token: z.string().min(1)
});
export const pageAutofillResponseSchema = z.object({
  updated_panel_count: z.number().int().nonnegative(),
  filled_field_count: z.number().int().nonnegative(),
  compiler_used: z.boolean(),
  compiler_provider: z.enum(['openai', 'fallback']),
  compiler_model: nullableString,
  compiler_prompt_version: nullableString,
  compiler_error: nullableString
});
export const panelAssignmentsResponseSchema = z.object({
  entities: z.array(panelEntityAssignmentSchema)
});
export const layoutTemplateResponseSchema = z.object({
  template_id: id,
  panel_count: z.number().int().nonnegative(),
  created_panel_count: z.number().int().nonnegative(),
  deleted_panel_count: z.number().int().nonnegative(),
  frames: z.array(panelFrameSchema)
});
export const frameTemplateResponseSchema = z.object({
  template_id: id,
  panel_count: z.number().int().nonnegative(),
  frames: z.array(panelFrameSchema)
});
export const storyCollaborationEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('chunk'),
      data: z.object({ text: z.string().max(25_000) }).strict()
    })
    .strict(),
  z
    .object({
      event: z.literal('done'),
      data: z.object({}).strict()
    })
    .strict(),
  z
    .object({
      event: z.literal('error'),
      data: z.object({ message: z.string().min(1).max(500) }).strict()
    })
    .strict()
]);
export const apiErrorBodySchema = z.object({
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional()
    })
    .optional()
});
