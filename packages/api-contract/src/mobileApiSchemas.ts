import { z } from 'zod';

const idSchema = z.string().min(1);
const nullableStringSchema = z.string().nullable();
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
  cancel_at_period_end: z.boolean(),
  subscription_plans: z.array(subscriptionPlanSchema),
});

export const currentSessionSchema = z.object({
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
  })
  .strict();

export const organizationsResponseSchema = z
  .object({
    organizations: z.array(organizationWorkspaceSchema),
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
});

export const entityReferenceSetSchema = z
  .object({
    entity_id: idSchema,
    primary_ref_id: nullableStringSchema,
    status: z.enum(['empty', 'partial', 'ready']),
    updated_at: timestampSchema,
    reference_images: z.array(
      z
        .object({
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

export const entityReferenceGenerationResponseSchema = z
  .object({
    job_id: idSchema,
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
  id: idSchema,
  entity_id: idSchema,
  scene_id: nullableStringSchema,
  costume_note: nullableStringSchema,
  costume_ref_id: nullableStringSchema,
  condition_note: nullableStringSchema,
  hair_note: nullableStringSchema,
  expression_default: z.string().min(1).max(100),
  extra_note: nullableStringSchema,
  created_at: timestampSchema,
});

export const entityStatesResponseSchema = z.object({
  entity_states: z.array(entityStateSchema),
});

const pageGenerationModeSchema = z.enum(['standard', 'thinking']);
const generatedPageImageSchema = z
  .object({
    cdn_url: z.string().min(1).nullable().optional(),
    generation_mode: pageGenerationModeSchema.nullable(),
    generated_at: timestampSchema.nullable(),
  })
  .strict();

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
        generation_mode: pageGenerationModeSchema.nullable().optional(),
        generated_at: timestampSchema.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const entityGenerationJobResultSchema = z
  .object({
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

const episodeStoryAutofillJobResultSchema = z
  .object({
    ...jobCompilerResultFields,
    ...jobProgressFields,
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
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']),
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
      })
      .strict(),
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
]);

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

export const compositionsResponseSchema = z.object({
  compositions: z.array(compositionSchema),
});
