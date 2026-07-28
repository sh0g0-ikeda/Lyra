import type { ZodType } from 'zod';
import { onlineManager } from '@tanstack/react-query';

import {
  accountDeletionPreviewSchema,
  accountDeletionResultSchema,
  apiErrorBodySchema,
  balloonSchema,
  balloonsResponseSchema,
  billingBalanceSchema,
  chapterSchema,
  chaptersResponseSchema,
  compositionsResponseSchema,
  currentSessionSchema,
  createEpisodeExportResponseSchema,
  entitiesResponseSchema,
  entityStateSchema,
  entityStatesResponseSchema,
  entityImportResponseSchema,
  entityReferenceUploadPresignResponseSchema,
  entityReferenceGenerationAvailabilitySchema,
  entityReferenceSetSchema,
  entitySchema,
  episodeSchema,
  episodesResponseSchema,
  exportJobSchema,
  frameTemplateResponseSchema,
  framesResponseSchema,
  generationJobSchema,
  generationJobsResponseSchema,
  jobAcceptedSchema,
  layoutTemplateResponseSchema,
  mobilePurchaseAccountBindingSchema,
  mobileStoreProductCatalogSchema,
  mobileStorePurchaseResultSchema,
  mobileStoreRestoreResultSchema,
  organizationAuditLogsResponseSchema,
  organizationBillingSummarySchema,
  organizationCreditBalanceSchema,
  organizationCreditCheckoutSchema,
  organizationCustomerPortalSchema,
  organizationInvitationPreviewSchema,
  organizationInvitationActionResponseSchema,
  organizationInvitationsResponseSchema,
  organizationInvitationUpdateResponseSchema,
  organizationInvoicesResponseSchema,
  organizationMembersResponseSchema,
  organizationMemberUpdateResponseSchema,
  organizationPlansResponseSchema,
  organizationSubscriptionCheckoutSchema,
  organizationUsageResponseSchema,
  organizationUpdateResponseSchema,
  organizationWorkspaceDetailSchema,
  organizationWorkspaceSchema,
  pageAutofillResponseSchema,
  pageGenerationReadinessSchema,
  pageLayoutTemplatesResponseSchema,
  pageSchema,
  pageSkeletonResponseSchema,
  pagesResponseSchema,
  panelAssignmentsResponseSchema,
  panelSchema,
  panelsResponseSchema,
  sceneSchema,
  scenesResponseSchema,
  saveAndGeneratePageResponseSchema,
  pushTokenRegistrationSchema,
  storyCollaborationEventSchema,
  storyEpisodeImprovementSchema,
  workSchema,
  worksResponseSchema
} from '@/domain/apiSchemas';
import type {
  AccountDeletionPreviewRecord,
  AccountDeletionResultRecord,
  BalloonRecord,
  BillingBalanceRecord,
  ChapterRecord,
  CompositionRecord,
  CurrentSessionRecord,
  CreateEpisodeExportPayload,
  CreateEpisodeExportResultRecord,
  EntityRecord,
  EntityReferenceGenerationAvailabilityRecord,
  EntityStateRecord,
  EntityReferenceSetRecord,
  EpisodeRecord,
  ExportJobRecord,
  GenerationJobRecord,
  GenerationJobsResponseRecord,
  GenerationJobStatus,
  GenerationJobType,
  MobilePurchaseAccountBindingRecord,
  MobileStoreProductCatalogRecord,
  MobileStorePurchaseResultRecord,
  MobileStoreRestoreResultRecord,
  OrganizationInvitationPreviewRecord,
  OrganizationAuditLogRecord,
  OrganizationBillingSummaryRecord,
  OrganizationCheckoutRecord,
  OrganizationCreditBalanceRecord,
  OrganizationInvitationRecord,
  OrganizationInvoiceRecord,
  OrganizationMemberRecord,
  OrganizationSubscriptionPlanRecord,
  OrganizationUsageEventRecord,
  OrganizationUsageSummaryRecord,
  OrganizationWorkspaceDetailRecord,
  OrganizationWorkspaceRecord,
  PageGenerationReadinessRecord,
  PageLayoutTemplateRecord,
  PageRecord,
  PageSkeletonResultRecord,
  PanelFrameRecord,
  PushTokenRegistrationRecord,
  PanelRecord,
  SaveAndGeneratePageResultRecord,
  SceneRecord,
  StoryCollaborationInput,
  StoryEpisodeImprovementRecord,
  UiLanguage,
  WorkRecord
} from '@/domain/types';
import type {
  ApplyPageLayoutTemplatePayload,
  ConfirmEntityReferencePayload,
  CreateChapterPayload,
  CreateEntityPayload,
  CreateEntityReferenceUploadPayload,
  CreateEntityStatePayload,
  CreateOrganizationPayload,
  CreateOrganizationCreditCheckoutPayload,
  CreateOrganizationInvitationPayload,
  CreateOrganizationSubscriptionCheckoutPayload,
  CreateEpisodePayload,
  CreatePanelPayload,
  CreateScenePayload,
  CreateWorkPayload,
  GeneratePageSkeletonPayload,
  ImportEntityImagePayload,
  PushTokenRegistrationPayload,
  RestoreMobilePurchasesPayload,
  ReplacePanelAssignmentsPayload,
  UpdateChapterPayload,
  UpdateEntityPayload,
  UpdateEntityStatePayload,
  UpdateOrganizationMemberPayload,
  UpdateOrganizationPayload,
  UpdateEpisodePayload,
  UpdatePagePayload,
  UpdatePanelPayload,
  UpdateScenePayload,
  UpdateWorkPayload,
  VerifyAppleMobilePurchasePayload,
  VerifyGoogleMobilePurchasePayload
} from '@/domain/payloads';
import type { AtomicSaveAndGeneratePayload } from '@/domain/pageAtomicGeneration';
import { config } from '@/lib/config';
import { recordOperationalMetric } from '@/lib/operationalEvents';
import { requestTimeoutMs, SSE_IDLE_TIMEOUT_MS } from '@/lib/requestPolicy';

type JsonRequestInit = Omit<RequestInit, 'body'> & { body?: unknown; timeoutMs?: number };

type StoryCollaborationRequest = StoryCollaborationInput & { language: UiLanguage };

export interface BlobResponse {
  blob: Blob;
  contentType: string | null;
}

export interface SseHandlers {
  onMessage: (data: unknown) => void;
  onError?: (error: unknown) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  public readonly requestId: string | null;
  public readonly retryAfterSeconds: number | null;
  public readonly retryAtMs: number | null;

  public constructor(
    message: string,
    status: number,
    code: string | null,
    requestId: string | null = null,
    retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
    const effectiveRetryAfterSeconds =
      retryAfterSeconds ?? (status === 429 ? 5 : null);
    this.retryAtMs =
      effectiveRetryAfterSeconds === null
        ? null
        : Date.now() + effectiveRetryAfterSeconds * 1_000;
  }
}

const retryAfterSecondsFrom = (response: Response): number | null => {
  const value = response.headers.get('retry-after')?.trim() ?? '';
  if (!/^\d{1,4}$/u.test(value)) {
    return null;
  }
  const seconds = Number(value);
  return Number.isSafeInteger(seconds)
    ? Math.min(Math.max(seconds, 1), 3_600)
    : null;
};

const organizationQuery = (organizationId?: string | null): string => {
  if (organizationId === undefined || organizationId === null || organizationId.trim().length === 0) {
    return '';
  }
  return `?organization_id=${encodeURIComponent(organizationId)}`;
};

export interface ListPageInput {
  organizationId?: string | null;
  limit: number;
  cursor?: string | null;
}

const listPageQuery = (input: ListPageInput): string => {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError('List page limit must be an integer from 1 to 100');
  }
  if (
    input.cursor !== undefined &&
    input.cursor !== null &&
    (input.cursor.length === 0 || input.cursor.length > 1024)
  ) {
    throw new RangeError('List page cursor must contain 1 to 1024 characters');
  }

  const params = new URLSearchParams();
  if (
    input.organizationId !== undefined &&
    input.organizationId !== null &&
    input.organizationId.trim().length > 0
  ) {
    params.set('organization_id', input.organizationId);
  }
  params.set('limit', String(input.limit));
  if (input.cursor !== undefined && input.cursor !== null) {
    params.set('cursor', input.cursor);
  }
  return `?${params.toString()}`;
};

export interface ListJobsInput {
  organizationId?: string | null;
  limit?: number;
  cursor?: string | null;
  statuses?: readonly GenerationJobStatus[];
  jobTypes?: readonly GenerationJobType[];
}

const jobListQuery = (input: ListJobsInput): string => {
  const params = new URLSearchParams();
  if (input.organizationId !== undefined && input.organizationId !== null && input.organizationId.trim().length > 0) {
    params.set('organization_id', input.organizationId);
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.cursor !== undefined && input.cursor !== null && input.cursor.length > 0) {
    params.set('cursor', input.cursor);
  }
  if (input.statuses !== undefined && input.statuses.length > 0) {
    params.set('status', input.statuses.join(','));
  }
  if (input.jobTypes !== undefined && input.jobTypes.length > 0) {
    params.set('type', input.jobTypes.join(','));
  }
  const query = params.toString();
  return query.length === 0 ? '' : `?${query}`;
};

export class LyraMobileApiClient {
  private readonly tokenProvider: () => string | null;
  private readonly tokenRefreshProvider: (() => Promise<string | null>) | null;
  private readonly baseUrl: string;

  public constructor(
    tokenProvider: () => string | null,
    tokenRefreshProvider: (() => Promise<string | null>) | null = null
  ) {
    this.tokenProvider = tokenProvider;
    this.tokenRefreshProvider = tokenRefreshProvider;
    this.baseUrl = config.apiBaseUrl;
  }

  public getCurrentSession(): Promise<CurrentSessionRecord> {
    return this.request('/api/me', currentSessionSchema);
  }

  public getEntityReferenceGenerationAvailability(): Promise<EntityReferenceGenerationAvailabilityRecord> {
    return this.request(
      '/api/entities/reference-generation-availability',
      entityReferenceGenerationAvailabilitySchema
    );
  }

  public getMobilePurchaseBinding(): Promise<MobilePurchaseAccountBindingRecord> {
    return this.request('/api/mobile-purchases/binding', mobilePurchaseAccountBindingSchema);
  }

  public getMobileStoreProductCatalog(
    store: MobileStoreProductCatalogRecord['store']
  ): Promise<MobileStoreProductCatalogRecord> {
    return this.request(
      `/api/mobile-purchases/catalog/${encodeURIComponent(store)}`,
      mobileStoreProductCatalogSchema
    );
  }

  public verifyAppleMobilePurchase(
    body: VerifyAppleMobilePurchasePayload
  ): Promise<MobileStorePurchaseResultRecord> {
    return this.request('/api/mobile-purchases/apple/verify', mobileStorePurchaseResultSchema, {
      method: 'POST',
      body
    });
  }

  public verifyGoogleMobilePurchase(
    body: VerifyGoogleMobilePurchasePayload
  ): Promise<MobileStorePurchaseResultRecord> {
    return this.request('/api/mobile-purchases/google/verify', mobileStorePurchaseResultSchema, {
      method: 'POST',
      body
    });
  }

  public restoreMobilePurchases(
    body: RestoreMobilePurchasesPayload
  ): Promise<MobileStoreRestoreResultRecord> {
    return this.request('/api/mobile-purchases/restore', mobileStoreRestoreResultSchema, {
      method: 'POST',
      body
    });
  }

  public previewOrganizationInvitation(token: string): Promise<OrganizationInvitationPreviewRecord> {
    return this.request(
      `/api/organization-invitations/${encodeURIComponent(token)}`,
      organizationInvitationPreviewSchema
    );
  }

  public acceptOrganizationInvitation(token: string): Promise<OrganizationWorkspaceRecord> {
    return this.request('/api/organization-invitations/accept', organizationWorkspaceSchema, {
      method: 'POST',
      body: { token }
    });
  }

  public createOrganization(body: CreateOrganizationPayload): Promise<OrganizationWorkspaceDetailRecord> {
    return this.request('/api/organizations', organizationWorkspaceDetailSchema, {
      method: 'POST',
      body
    });
  }

  /**
   * The caller must pass the organization selected from the authenticated
   * session. Backend membership checks remain the authorization boundary.
   */
  public getOrganizationWorkspace(organizationId: string): Promise<OrganizationWorkspaceDetailRecord> {
    return this.request(`/api/organizations/${encodeURIComponent(organizationId)}`, organizationWorkspaceDetailSchema);
  }

  public updateOrganization(
    organizationId: string,
    body: UpdateOrganizationPayload
  ): Promise<OrganizationWorkspaceDetailRecord['organization']> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}`,
      organizationUpdateResponseSchema,
      { method: 'PATCH', body }
    );
  }

  public async getOrganizationMembers(organizationId: string): Promise<{ members: OrganizationMemberRecord[] }> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/members`,
      organizationMembersResponseSchema
    );
    return { members: response.members };
  }

  public getOrganizationMembersPage(
    organizationId: string,
    input: ListPageInput
  ): Promise<{ members: OrganizationMemberRecord[]; next_cursor: string | null }> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/members${listPageQuery(input)}`,
      organizationMembersResponseSchema
    );
  }

  public updateOrganizationMember(
    organizationId: string,
    memberId: string,
    body: UpdateOrganizationMemberPayload
  ): Promise<OrganizationMemberRecord> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}`,
      organizationMemberUpdateResponseSchema,
      { method: 'PATCH', body }
    );
  }

  public removeOrganizationMember(organizationId: string, memberId: string): Promise<void> {
    return this.requestVoid(
      `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' }
    );
  }

  public async getOrganizationInvitations(organizationId: string): Promise<{ invitations: OrganizationInvitationRecord[] }> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/invitations`,
      organizationInvitationsResponseSchema
    );
    return { invitations: response.invitations };
  }

  public getOrganizationInvitationsPage(
    organizationId: string,
    input: ListPageInput
  ): Promise<{ invitations: OrganizationInvitationRecord[]; next_cursor: string | null }> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/invitations${listPageQuery(input)}`,
      organizationInvitationsResponseSchema
    );
  }

  public async createOrganizationInvitation(
    organizationId: string,
    body: CreateOrganizationInvitationPayload
  ): Promise<OrganizationInvitationRecord> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/invitations`,
      organizationInvitationActionResponseSchema,
      { method: 'POST', body }
    );
    return response.invitation;
  }

  public async resendOrganizationInvitation(
    organizationId: string,
    invitationId: string
  ): Promise<OrganizationInvitationRecord> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}/resend`,
      organizationInvitationActionResponseSchema,
      { method: 'POST' }
    );
    return response.invitation;
  }

  public async revokeOrganizationInvitation(
    organizationId: string,
    invitationId: string
  ): Promise<OrganizationInvitationRecord> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
      organizationInvitationUpdateResponseSchema,
      { method: 'POST' }
    );
    return response.invitation;
  }

  public getOrganizationCreditBalance(organizationId: string): Promise<OrganizationCreditBalanceRecord> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/credits/balance`,
      organizationCreditBalanceSchema
    );
  }

  public getOrganizationPlans(organizationId: string): Promise<{ subscription_plans: OrganizationSubscriptionPlanRecord[] }> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/billing/plans`,
      organizationPlansResponseSchema
    );
  }

  public getOrganizationBillingSummary(organizationId: string): Promise<OrganizationBillingSummaryRecord> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/billing`,
      organizationBillingSummarySchema
    );
  }

  public createOrganizationSubscriptionCheckout(
    organizationId: string,
    body: CreateOrganizationSubscriptionCheckoutPayload
  ): Promise<OrganizationCheckoutRecord> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/billing/checkout/subscription`,
      organizationSubscriptionCheckoutSchema,
      { method: 'POST', body }
    );
  }

  public createOrganizationCreditCheckout(
    organizationId: string,
    body: CreateOrganizationCreditCheckoutPayload
  ): Promise<OrganizationCheckoutRecord> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/billing/checkout/credits`,
      organizationCreditCheckoutSchema,
      { method: 'POST', body }
    );
  }

  public createOrganizationCustomerPortal(organizationId: string): Promise<OrganizationCheckoutRecord> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/billing/customer-portal`,
      organizationCustomerPortalSchema,
      { method: 'POST' }
    );
  }

  public getOrganizationInvoices(organizationId: string): Promise<{ invoices: OrganizationInvoiceRecord[] }> {
    return this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/invoices`,
      organizationInvoicesResponseSchema,
      { method: 'GET' }
    );
  }

  public async getOrganizationUsage(organizationId: string): Promise<{
    usage_events: OrganizationUsageEventRecord[];
    summary: OrganizationUsageSummaryRecord;
  }> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/usage`,
      organizationUsageResponseSchema
    );
    return {
      usage_events: response.usage_events.map(({ generation_job_id: _generationJobId, metadata: _metadata, ...event }) => event),
      summary: response.summary
    };
  }

  public async getOrganizationUsagePage(
    organizationId: string,
    input: ListPageInput
  ): Promise<{
    usage_events: OrganizationUsageEventRecord[];
    summary: OrganizationUsageSummaryRecord;
    next_cursor: string | null;
  }> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/usage${listPageQuery(input)}`,
      organizationUsageResponseSchema
    );
    return {
      usage_events: response.usage_events.map(
        ({ generation_job_id: _generationJobId, metadata: _metadata, ...event }) => event
      ),
      summary: response.summary,
      next_cursor: response.next_cursor
    };
  }

  public async getOrganizationAuditLogs(organizationId: string): Promise<{ audit_logs: OrganizationAuditLogRecord[] }> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/audit-logs`,
      organizationAuditLogsResponseSchema
    );
    return {
      audit_logs: response.audit_logs.map(({ actor_user_id: _actorUserId, target_id: _targetId, metadata: _metadata, ...log }) => log)
    };
  }

  public async getOrganizationAuditLogsPage(
    organizationId: string,
    input: ListPageInput
  ): Promise<{ audit_logs: OrganizationAuditLogRecord[]; next_cursor: string | null }> {
    const response = await this.request(
      `/api/organizations/${encodeURIComponent(organizationId)}/audit-logs${listPageQuery(input)}`,
      organizationAuditLogsResponseSchema
    );
    return {
      audit_logs: response.audit_logs.map(
        ({ actor_user_id: _actorUserId, target_id: _targetId, metadata: _metadata, ...log }) => log
      ),
      next_cursor: response.next_cursor
    };
  }

  public async getWorks(organizationId?: string | null): Promise<{ works: WorkRecord[] }> {
    const response = await this.request(
      `/api/works${organizationQuery(organizationId)}`,
      worksResponseSchema
    );
    return { works: response.works };
  }

  public getWorksPage(
    input: ListPageInput
  ): Promise<{ works: WorkRecord[]; next_cursor: string | null }> {
    return this.request(`/api/works${listPageQuery(input)}`, worksResponseSchema);
  }

  public getWork(workId: string, organizationId?: string | null): Promise<WorkRecord> {
    return this.request(
      `/api/works/${encodeURIComponent(workId)}${organizationQuery(organizationId)}`,
      workSchema
    );
  }

  public createWork(body: CreateWorkPayload, organizationId?: string | null): Promise<WorkRecord> {
    const requestBody =
      organizationId === undefined || organizationId === null || organizationId.trim().length === 0
        ? body
        : { ...body, organization_id: organizationId };
    return this.request('/api/works', workSchema, { method: 'POST', body: requestBody });
  }

  public updateWork(workId: string, body: UpdateWorkPayload, organizationId?: string | null): Promise<WorkRecord> {
    return this.request(`/api/works/${workId}${organizationQuery(organizationId)}`, workSchema, { method: 'PUT', body });
  }

  public getChapters(workId: string, organizationId?: string | null): Promise<{ chapters: ChapterRecord[] }> {
    return this.request(`/api/works/${workId}/chapters${organizationQuery(organizationId)}`, chaptersResponseSchema);
  }

  public createChapter(
    workId: string,
    body: CreateChapterPayload,
    organizationId?: string | null
  ): Promise<ChapterRecord> {
    return this.request(`/api/works/${workId}/chapters${organizationQuery(organizationId)}`, chapterSchema, {
      method: 'POST',
      body
    });
  }

  public updateChapter(
    chapterId: string,
    body: UpdateChapterPayload,
    organizationId?: string | null
  ): Promise<ChapterRecord> {
    return this.request(`/api/chapters/${chapterId}${organizationQuery(organizationId)}`, chapterSchema, {
      method: 'PUT',
      body
    });
  }

  public moveChapter(chapterId: string, direction: 'up' | 'down', organizationId?: string | null): Promise<ChapterRecord> {
    return this.request(`/api/chapters/${chapterId}/move${organizationQuery(organizationId)}`, chapterSchema, {
      method: 'POST',
      body: { direction }
    });
  }

  public deleteChapter(chapterId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/chapters/${chapterId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public getEpisodes(chapterId: string, organizationId?: string | null): Promise<{ episodes: EpisodeRecord[] }> {
    return this.request(`/api/chapters/${chapterId}/episodes${organizationQuery(organizationId)}`, episodesResponseSchema);
  }

  public createEpisode(
    chapterId: string,
    body: CreateEpisodePayload,
    organizationId?: string | null
  ): Promise<EpisodeRecord> {
    return this.request(`/api/chapters/${chapterId}/episodes${organizationQuery(organizationId)}`, episodeSchema, {
      method: 'POST',
      body
    });
  }

  public updateEpisode(
    episodeId: string,
    body: UpdateEpisodePayload,
    organizationId?: string | null
  ): Promise<EpisodeRecord> {
    return this.request(`/api/episodes/${episodeId}${organizationQuery(organizationId)}`, episodeSchema, {
      method: 'PUT',
      body
    });
  }

  public moveEpisode(
    episodeId: string,
    direction: 'up' | 'down',
    organizationId?: string | null,
    crossChapter = false
  ): Promise<EpisodeRecord> {
    return this.request(`/api/episodes/${episodeId}/move${organizationQuery(organizationId)}`, episodeSchema, {
      method: 'POST',
      body: crossChapter ? { direction, cross_chapter: true } : { direction }
    });
  }

  public deleteEpisode(episodeId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/episodes/${episodeId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public generatePageSkeleton(
    episodeId: string,
    body: GeneratePageSkeletonPayload,
    organizationId?: string | null
  ): Promise<PageSkeletonResultRecord> {
    return this.request(`/api/episodes/${episodeId}/generate-page-skeleton${organizationQuery(organizationId)}`, pageSkeletonResponseSchema, {
      method: 'POST',
      body
    });
  }

  public improveEpisodeDraft(
    body: {
      episode_id: string;
      instruction: string;
      language: 'ja' | 'en';
      base_draft: {
        title: string | null;
        purpose: string | null;
        story_input_mode: 'structured' | 'full';
        story_full_draft: string | null;
        introduction: string | null;
        middle: string | null;
        climax: string | null;
        ending_hook: string | null;
      };
    },
    organizationId?: string | null
  ): Promise<StoryEpisodeImprovementRecord> {
    return this.request(
      `/api/story/improve-episode-draft${organizationQuery(organizationId)}`,
      storyEpisodeImprovementSchema,
      { method: 'POST', body }
    );
  }

  public collaborateStory(
    input: StoryCollaborationRequest,
    organizationId?: string | null
  ): Promise<Record<string, unknown>> {
    let text = '';
    return this.streamStoryCollaboration(
      input,
      {
        onMessage: (data) => {
          if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
            const chunk = (data as { text?: unknown }).text;
            if (typeof chunk === 'string') {
              text += chunk;
            }
          }
        }
      },
      organizationId
    ).then(() => ({ text }));
  }

  public async streamStoryCollaboration(
    input: StoryCollaborationRequest,
    handlers: SseHandlers,
    organizationId?: string | null
  ): Promise<void> {
    return this.stream(`/api/story/collaborate${organizationQuery(organizationId)}`, input, handlers);
  }

  public async getEntities(workId: string, organizationId?: string | null): Promise<{ entities: EntityRecord[] }> {
    const response = await this.request(
      `/api/works/${workId}/entities${organizationQuery(organizationId)}`,
      entitiesResponseSchema
    );
    return { entities: response.entities };
  }

  public getEntitiesPage(
    workId: string,
    input: ListPageInput
  ): Promise<{ entities: EntityRecord[]; next_cursor: string | null }> {
    return this.request(
      `/api/works/${encodeURIComponent(workId)}/entities${listPageQuery(input)}`,
      entitiesResponseSchema
    );
  }

  public getEntity(entityId: string, organizationId?: string | null): Promise<EntityRecord> {
    return this.request(
      `/api/entities/${encodeURIComponent(entityId)}${organizationQuery(organizationId)}`,
      entitySchema
    );
  }

  public createEntity(workId: string, body: CreateEntityPayload, organizationId?: string | null): Promise<EntityRecord> {
    return this.request(`/api/works/${workId}/entities${organizationQuery(organizationId)}`, entitySchema, {
      method: 'POST',
      body
    });
  }

  public updateEntity(entityId: string, body: UpdateEntityPayload, organizationId?: string | null): Promise<EntityRecord> {
    return this.request(`/api/entities/${entityId}${organizationQuery(organizationId)}`, entitySchema, {
      method: 'PUT',
      body
    });
  }

  public deleteEntity(entityId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/entities/${entityId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public importEntityImage(body: ImportEntityImagePayload, organizationId?: string | null): Promise<{
    suggested_fields: Record<string, unknown>;
    prompt_supplement: string;
    tmp_image_token: string;
  }> {
    return this.request(`/api/entities/import-image${organizationQuery(organizationId)}`, entityImportResponseSchema, {
      method: 'POST',
      body
    });
  }

  public createEntityReferenceUpload(
    body: CreateEntityReferenceUploadPayload,
    organizationId?: string | null
  ): Promise<{
    upload_url: string;
    upload_token: string;
    expires_at: string;
    upload_headers: {
      'Content-Type': CreateEntityReferenceUploadPayload['mime_type'];
      'x-amz-server-side-encryption': 'AES256';
    };
  }> {
    return this.request(
      `/api/uploads/entity-reference/presign${organizationQuery(organizationId)}`,
      entityReferenceUploadPresignResponseSchema,
      { method: 'POST', body }
    );
  }

  public generateEntityReference(
    entityId: string,
    body: Record<string, unknown> = {},
    organizationId?: string | null
  ): Promise<{ job_id: string }> {
    return this.request(`/api/entities/${entityId}/generate-reference${organizationQuery(organizationId)}`, jobAcceptedSchema, {
      method: 'POST',
      body
    });
  }

  public getEntityReferenceSet(entityId: string, organizationId?: string | null): Promise<EntityReferenceSetRecord> {
    return this.request(
      `/api/entities/${entityId}/reference-set${organizationQuery(organizationId)}`,
      entityReferenceSetSchema
    );
  }

  public confirmEntityReference(
    entityId: string,
    body: ConfirmEntityReferencePayload,
    organizationId?: string | null
  ): Promise<EntityReferenceSetRecord> {
    return this.request(
      `/api/entities/${entityId}/reference/confirm${organizationQuery(organizationId)}`,
      entityReferenceSetSchema,
      {
        method: 'POST',
        body
      }
    );
  }

  public deleteEntityReference(entityId: string, refId: string, organizationId?: string | null): Promise<EntityReferenceSetRecord> {
    return this.request(
      `/api/entities/${entityId}/reference/${encodeURIComponent(refId)}${organizationQuery(organizationId)}`,
      entityReferenceSetSchema,
      { method: 'DELETE' }
    );
  }

  public getEntityStates(
    entityId: string,
    organizationId?: string | null,
  ): Promise<{ entity_states: EntityStateRecord[] }> {
    return this.request(`/api/entities/${entityId}/states${organizationQuery(organizationId)}`, entityStatesResponseSchema);
  }

  public createEntityState(
    entityId: string,
    body: CreateEntityStatePayload,
    organizationId?: string | null,
  ): Promise<EntityStateRecord> {
    return this.request(`/api/entities/${entityId}/states${organizationQuery(organizationId)}`, entityStateSchema, {
      method: 'POST',
      body,
    });
  }

  public updateEntityState(
    entityId: string,
    stateId: string,
    body: UpdateEntityStatePayload,
    organizationId?: string | null,
  ): Promise<EntityStateRecord> {
    return this.request(
      `/api/entities/${entityId}/states/${stateId}${organizationQuery(organizationId)}`,
      entityStateSchema,
      { method: 'PUT', body },
    );
  }

  public getScenes(episodeId: string, organizationId?: string | null): Promise<{ scenes: SceneRecord[] }> {
    return this.request(`/api/episodes/${episodeId}/scenes${organizationQuery(organizationId)}`, scenesResponseSchema);
  }

  public createScene(
    episodeId: string,
    body: CreateScenePayload,
    organizationId?: string | null
  ): Promise<SceneRecord> {
    return this.request(`/api/episodes/${episodeId}/scenes${organizationQuery(organizationId)}`, sceneSchema, {
      method: 'POST',
      body
    });
  }

  public updateScene(sceneId: string, body: UpdateScenePayload, organizationId?: string | null): Promise<SceneRecord> {
    return this.request(`/api/scenes/${sceneId}${organizationQuery(organizationId)}`, sceneSchema, {
      method: 'PUT',
      body
    });
  }

  public deleteScene(sceneId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/scenes/${sceneId}${organizationQuery(organizationId)}`, {
      method: 'DELETE'
    });
  }

  public async getPages(episodeId: string, organizationId?: string | null): Promise<{ pages: PageRecord[] }> {
    const response = await this.request(
      `/api/episodes/${episodeId}/pages${organizationQuery(organizationId)}`,
      pagesResponseSchema
    );
    return { pages: response.pages };
  }

  public getPagesPage(
    episodeId: string,
    input: ListPageInput
  ): Promise<{ pages: PageRecord[]; next_cursor: string | null }> {
    return this.request(
      `/api/episodes/${encodeURIComponent(episodeId)}/pages${listPageQuery(input)}`,
      pagesResponseSchema
    );
  }

  public getPage(pageId: string, organizationId?: string | null): Promise<PageRecord> {
    return this.request(
      `/api/pages/${encodeURIComponent(pageId)}${organizationQuery(organizationId)}`,
      pageSchema
    );
  }

  public createEpisodeExport(
    episodeId: string,
    body: CreateEpisodeExportPayload,
    idempotencyKey: string,
    organizationId?: string | null
  ): Promise<CreateEpisodeExportResultRecord> {
    return this.request(
      `/api/episodes/${episodeId}/exports${organizationQuery(organizationId)}`,
      createEpisodeExportResponseSchema,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body
      }
    );
  }

  public getExportJob(jobId: string, organizationId?: string | null): Promise<ExportJobRecord> {
    return this.request(`/api/exports/${jobId}${organizationQuery(organizationId)}`, exportJobSchema);
  }

  public updatePage(pageId: string, body: UpdatePagePayload, organizationId?: string | null): Promise<PageRecord> {
    return this.request(`/api/pages/${pageId}${organizationQuery(organizationId)}`, pageSchema, { method: 'PUT', body });
  }

  public getPageGenerationReadiness(
    pageId: string,
    organizationId?: string | null
  ): Promise<PageGenerationReadinessRecord> {
    return this.request(
      `/api/pages/${pageId}/generation-readiness${organizationQuery(organizationId)}`,
      pageGenerationReadinessSchema
    );
  }

  public saveAndGeneratePage(
    pageId: string,
    body: AtomicSaveAndGeneratePayload,
    idempotencyKey: string,
    organizationId?: string | null
  ): Promise<SaveAndGeneratePageResultRecord> {
    return this.request(
      `/api/pages/${pageId}/save-and-generate${organizationQuery(organizationId)}`,
      saveAndGeneratePageResponseSchema,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body
      }
    );
  }

  public getPageLayoutTemplates(): Promise<{ templates: PageLayoutTemplateRecord[] }> {
    return this.request('/api/page-layout-templates', pageLayoutTemplatesResponseSchema);
  }

  public autofillEpisodePagesFromStory(
    episodeId: string,
    language: 'ja' | 'en',
    organizationId?: string | null
  ): Promise<{ job_id: string }> {
    return this.request(
      `/api/episodes/${episodeId}/autofill-pages-from-story${organizationQuery(organizationId)}`,
      jobAcceptedSchema,
      {
      method: 'POST',
      body: { language }
      }
    );
  }

  public autofillPageFromScenes(
    pageId: string,
    language: 'ja' | 'en',
    organizationId?: string | null
  ): Promise<{
    updated_panel_count: number;
    filled_field_count: number;
    compiler_used: boolean;
    compiler_provider: 'openai' | 'fallback';
    compiler_model: string | null;
    compiler_prompt_version: string | null;
    compiler_error: string | null;
  }> {
    return this.request(`/api/pages/${pageId}/autofill-from-scenes${organizationQuery(organizationId)}`, pageAutofillResponseSchema, {
      method: 'POST',
      body: { language }
    });
  }

  public generatePage(pageId: string, organizationId?: string | null): Promise<{ job_id: string }> {
    return this.request(`/api/pages/${pageId}/generate${organizationQuery(organizationId)}`, jobAcceptedSchema, {
      method: 'POST'
    });
  }

  public confirmPage(pageId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/pages/${pageId}/confirm${organizationQuery(organizationId)}`, { method: 'POST' });
  }

  public reopenPage(pageId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/pages/${pageId}/reopen${organizationQuery(organizationId)}`, { method: 'POST' });
  }

  public getPanels(pageId: string, organizationId?: string | null): Promise<{ panels: PanelRecord[] }> {
    return this.request(`/api/pages/${pageId}/panels${organizationQuery(organizationId)}`, panelsResponseSchema);
  }

  public createPanel(pageId: string, body: CreatePanelPayload, organizationId?: string | null): Promise<PanelRecord> {
    return this.request(`/api/pages/${pageId}/panels${organizationQuery(organizationId)}`, panelSchema, {
      method: 'POST',
      body
    });
  }

  public updatePanel(panelId: string, body: UpdatePanelPayload, organizationId?: string | null): Promise<PanelRecord> {
    return this.request(`/api/panels/${panelId}${organizationQuery(organizationId)}`, panelSchema, {
      method: 'PUT',
      body
    });
  }

  public deletePanel(panelId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/panels/${panelId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public reorderPanels(
    pageId: string,
    panelIds: string[],
    organizationId?: string | null
  ): Promise<{ panels: PanelRecord[] }> {
    return this.request(`/api/pages/${pageId}/panels/order${organizationQuery(organizationId)}`, panelsResponseSchema, {
      method: 'PUT',
      body: { panel_ids: panelIds }
    });
  }

  public replacePanelAssignments(
    panelId: string,
    body: ReplacePanelAssignmentsPayload,
    organizationId?: string | null
  ): Promise<{ entities: PanelRecord['entities'] }> {
    return this.request(
      `/api/panels/${panelId}/entities${organizationQuery(organizationId)}`,
      panelAssignmentsResponseSchema,
      { method: 'PUT', body }
    );
  }

  public getFrames(pageId: string, organizationId?: string | null): Promise<{ frames: PanelFrameRecord[] }> {
    return this.request(`/api/pages/${pageId}/frames${organizationQuery(organizationId)}`, framesResponseSchema);
  }

  public applyPageLayoutTemplate(
    pageId: string,
    body: ApplyPageLayoutTemplatePayload,
    organizationId?: string | null
  ): Promise<{ template_id: string; panel_count: number; created_panel_count: number; deleted_panel_count: number; frames: PanelFrameRecord[] }> {
    return this.request(`/api/pages/${pageId}/layout-template${organizationQuery(organizationId)}`, layoutTemplateResponseSchema, {
      method: 'POST',
      body
    });
  }

  public applyFrameTemplate(
    pageId: string,
    templateId: string,
    organizationId?: string | null
  ): Promise<{ template_id: string; panel_count: number; frames: PanelFrameRecord[] }> {
    return this.request(`/api/pages/${pageId}/frames/apply-template${organizationQuery(organizationId)}`, frameTemplateResponseSchema, {
      method: 'POST',
      body: { template_id: templateId }
    });
  }

  public replaceFrames(
    pageId: string,
    body: { frames: PanelFrameRecord[] },
    organizationId?: string | null
  ): Promise<{ frames: PanelFrameRecord[] }> {
    return this.request(`/api/pages/${pageId}/frames${organizationQuery(organizationId)}`, framesResponseSchema, {
      method: 'PUT',
      body
    });
  }

  public getBalloons(
    pageId: string,
    organizationId?: string | null
  ): Promise<{ balloons: BalloonRecord[] }> {
    return this.request(`/api/pages/${pageId}/balloons${organizationQuery(organizationId)}`, balloonsResponseSchema);
  }

  public createBalloon(
    pageId: string,
    body: Record<string, unknown>,
    organizationId?: string | null
  ): Promise<BalloonRecord> {
    return this.request(`/api/pages/${pageId}/balloons${organizationQuery(organizationId)}`, balloonSchema, {
      method: 'POST',
      body
    });
  }

  public updateBalloon(
    balloonId: string,
    body: Record<string, unknown>,
    organizationId?: string | null
  ): Promise<BalloonRecord> {
    return this.request(`/api/balloons/${balloonId}${organizationQuery(organizationId)}`, balloonSchema, {
      method: 'PUT',
      body
    });
  }

  public deleteBalloon(balloonId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/balloons/${balloonId}${organizationQuery(organizationId)}`, {
      method: 'DELETE'
    });
  }

  public autoBalloons(
    pageId: string,
    organizationId?: string | null
  ): Promise<{ balloons: BalloonRecord[] }> {
    return this.request(`/api/pages/${pageId}/auto-balloons${organizationQuery(organizationId)}`, balloonsResponseSchema, {
      method: 'POST'
    });
  }

  public getCompositions(): Promise<{ compositions: CompositionRecord[] }> {
    return this.request('/api/compositions', compositionsResponseSchema);
  }

  public async exportPageImage(pageId: string, organizationId?: string | null): Promise<BlobResponse> {
    const response = await this.fetchWithAuthRetry(
      `/api/pages/${pageId}/export-image${organizationQuery(organizationId)}`,
      { method: 'GET' }
    );
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    return {
      blob: await response.blob(),
      contentType: response.headers.get('Content-Type')
    };
  }

  public async exportEntityReferenceImage(
    entityId: string,
    refId: string,
    organizationId?: string | null
  ): Promise<BlobResponse> {
    const response = await this.fetchWithAuthRetry(
      `/api/entities/${entityId}/reference/${encodeURIComponent(refId)}/image${organizationQuery(organizationId)}`,
      { method: 'GET' }
    );
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    return {
      blob: await response.blob(),
      contentType: response.headers.get('Content-Type')
    };
  }

  public async exportEntityReferenceCandidateImage(
    entityId: string,
    candidateToken: string,
    organizationId?: string | null
  ): Promise<BlobResponse> {
    const params = new URLSearchParams({ candidate_token: candidateToken });
    if (organizationId !== undefined && organizationId !== null && organizationId.trim().length > 0) {
      params.set('organization_id', organizationId);
    }
    const response = await this.fetchWithAuthRetry(
      `/api/entities/${entityId}/reference-candidate-image?${params.toString()}`,
      { method: 'GET' }
    );
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    return {
      blob: await response.blob(),
      contentType: response.headers.get('Content-Type')
    };
  }

  public getJob(jobId: string, organizationId?: string | null): Promise<GenerationJobRecord> {
    return this.request(`/api/jobs/${jobId}${organizationQuery(organizationId)}`, generationJobSchema);
  }

  public listJobs(input: ListJobsInput = {}): Promise<GenerationJobsResponseRecord> {
    return this.request(`/api/jobs${jobListQuery(input)}`, generationJobsResponseSchema);
  }

  public cancelJob(jobId: string, organizationId?: string | null): Promise<GenerationJobRecord> {
    return this.request(`/api/jobs/${jobId}/cancel${organizationQuery(organizationId)}`, generationJobSchema, {
      method: 'POST'
    });
  }

  public hideJob(jobId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/jobs/${jobId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public registerPushToken(
    payload: PushTokenRegistrationPayload
  ): Promise<PushTokenRegistrationRecord> {
    return this.request('/api/push-tokens', pushTokenRegistrationSchema, {
      method: 'POST',
      body: payload
    });
  }

  public removePushToken(installationId: string): Promise<void> {
    return this.requestVoid(
      `/api/push-tokens/${encodeURIComponent(installationId)}`,
      { method: 'DELETE' }
    );
  }

  /** Account deletion is always personal. Do not attach organization_id to these endpoints. */
  public getAccountDeletionPreview(): Promise<AccountDeletionPreviewRecord> {
    return this.request('/api/account/deletion-preview', accountDeletionPreviewSchema);
  }

  /** A 409 response is an expected blocked result, not a transport failure. */
  public async requestAccountDeletion(input: {
    confirmation: 'DELETE';
    acknowledge_active_subscription: boolean;
    acknowledge_confirmed_assets: boolean;
  }): Promise<AccountDeletionResultRecord> {
    const response = await this.fetchWithAuthRetry('/api/account/deletion', {
      method: 'POST',
      body: input
    });
    if (response.status !== 200 && response.status !== 202 && response.status !== 409) {
      throw await this.toApiError(response);
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      throw new ApiError('API response did not match the expected contract.', 502, 'INVALID_API_RESPONSE');
    }
    const parsed = accountDeletionResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('API response did not match the expected contract.', 502, 'INVALID_API_RESPONSE');
    }
    return parsed.data;
  }

  public getBalance(): Promise<BillingBalanceRecord> {
    return this.request('/api/billing/balance', billingBalanceSchema);
  }

  private async request<T>(path: string, schema: ZodType<T>, init: JsonRequestInit = {}): Promise<T> {
    const response = await this.fetchWithAuthRetry(path, init);
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      throw new ApiError('API response did not match the expected contract.', 502, 'INVALID_API_RESPONSE');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('API response did not match the expected contract.', 502, 'INVALID_API_RESPONSE');
    }
    return parsed.data;
  }

  private async stream(path: string, body: unknown, handlers: SseHandlers): Promise<void> {
    try {
      const response = await this.fetchWithAuthRetry(path, {
        method: 'POST',
        body,
        signal: handlers.signal
      });
      if (!response.ok) {
        throw await this.toApiError(response);
      }

      const bodyWithReader = response.body as ReadableStream<Uint8Array> | null;
      if (bodyWithReader === null || typeof bodyWithReader.getReader !== 'function') {
        this.parseSseText(await response.text(), handlers);
        handlers.onDone?.();
        return;
      }

      const reader = bodyWithReader.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await this.readStreamChunk(reader, handlers.signal);
        if (done) {
          if (buffer.trim().length > 0) {
            this.parseSseText(buffer, handlers);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex >= 0) {
          const message = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          this.parseSseText(message, handlers);
          boundaryIndex = buffer.indexOf('\n\n');
        }
      }

      handlers.onDone?.();
    } catch (error) {
      handlers.onError?.(error);
      throw error;
    }
  }

  private parseSseText(text: string, handlers: SseHandlers): void {
    const normalized = text.replace(/\r\n/g, '\n');
    const messages = normalized.includes('\n\n') ? normalized.split('\n\n') : [normalized];

    messages.forEach((message) => {
      let eventName = 'message';
      const dataLines: string[] = [];

      message.split('\n').forEach((line) => {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      });

      if (dataLines.length === 0) {
        return;
      }

      const rawData = dataLines.join('\n');
      const data = this.parseSseJson(rawData);
      const parsed = storyCollaborationEventSchema.safeParse({
        event: eventName,
        data
      });
      if (!parsed.success) {
        throw new ApiError('API response did not match the expected contract.', 502, 'INVALID_API_RESPONSE');
      }
      if (parsed.data.event === 'error') {
        throw new ApiError(parsed.data.data.message, 500, 'SSE_ERROR');
      }
      if (parsed.data.event === 'done') {
        return;
      }
      handlers.onMessage(parsed.data.data);
    });
  }

  private parseSseJson(data: string): unknown {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return { text: data };
    }
  }

  private async requestVoid(path: string, init: JsonRequestInit = {}): Promise<void> {
    const response = await this.fetchWithAuthRetry(path, init);
    if (!response.ok) {
      throw await this.toApiError(response);
    }
  }

  private async fetchWithAuthRetry(path: string, init: JsonRequestInit): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && !onlineManager.isOnline()) {
      throw new ApiError('The device is offline.', 0, 'NETWORK_OFFLINE');
    }
    const response = await this.fetchWithTimeout(path, init);
    if (response.status !== 401 || this.tokenRefreshProvider === null) {
      return response;
    }

    let refreshedToken: string | null;
    try {
      refreshedToken = await this.tokenRefreshProvider();
    } catch {
      return response;
    }
    if (refreshedToken === null) {
      return response;
    }
    return this.fetchWithTimeout(path, init, refreshedToken);
  }

  private async fetchWithTimeout(
    path: string,
    init: JsonRequestInit,
    tokenOverride?: string | null
  ): Promise<Response> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromExternalSignal = (): void => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
    }
    const timeoutId = setTimeout(
      () => controller.abort(),
      init.timeoutMs ?? requestTimeoutMs(init.method)
    );
    try {
      return await fetch(
        this.toUrl(path),
        this.buildRequest({ ...init, signal: controller.signal }, tokenOverride)
      );
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromExternalSignal);
    }
  }

  private async readStreamChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal | undefined
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let abortListener: (() => void) | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        void reader.cancel();
        reject(new DOMException('SSE stream was idle for too long.', 'AbortError'));
      }, SSE_IDLE_TIMEOUT_MS);
      if (signal !== undefined) {
        abortListener = () => {
          void reader.cancel();
          reject(new DOMException('SSE stream was cancelled.', 'AbortError'));
        };
        signal.addEventListener('abort', abortListener, { once: true });
      }
    });
    try {
      return await Promise.race([reader.read(), timeout]);
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (abortListener !== null) {
        signal?.removeEventListener('abort', abortListener);
      }
    }
  }

  private buildRequest(init: JsonRequestInit, tokenOverride?: string | null): RequestInit {
    const headers = new Headers(init.headers);
    const token = tokenOverride === undefined ? this.tokenProvider() : tokenOverride;
    if (token !== null) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const { timeoutMs: _timeoutMs, ...requestInit } = init;
    void _timeoutMs;
    return {
      ...requestInit,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    };
  }

  private toUrl(path: string): string {
    const trimmedBaseUrl = this.baseUrl.replace(/\/+$/, '');
    return `${trimmedBaseUrl}${path}`;
  }

  private async toApiError(response: Response): Promise<ApiError> {
    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
    const parsed = apiErrorBodySchema.safeParse(body);
    const error = new ApiError(
      parsed.success ? parsed.data.error?.message ?? `API request failed with status ${response.status}` : `API request failed with status ${response.status}`,
      response.status,
      parsed.success ? parsed.data.error?.code ?? null : null,
      response.headers.get('x-request-id'),
      retryAfterSecondsFrom(response)
    );
    if (error.status === 401) {
      recordOperationalMetric({
        name: 'auth_failure',
        requestId: error.requestId,
        status: 401
      });
    }
    return error;
  }
}
