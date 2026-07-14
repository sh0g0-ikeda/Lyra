import type {
  BalloonRecord,
  BillingBalanceRecord,
  ChapterRecord,
  CompositionRecord,
  CurrentSessionRecord,
  EntityRecord,
  EntityReferenceSetRecord,
  EpisodeRecord,
  GenerationJobRecord,
  OrganizationAuditLogRecord,
  OrganizationBillingSummaryRecord,
  OrganizationBillingPlanRecord,
  OrganizationCreditBalanceRecord,
  OrganizationInvitationCreateRecord,
  OrganizationInvitationPreviewRecord,
  OrganizationInvitationRecord,
  OrganizationInvoiceRecord,
  OrganizationMemberRecord,
  OrganizationUsageEventRecord,
  OrganizationUsageSummaryRecord,
  OrganizationWorkspaceRecord,
  PageRecord,
  PanelFrameRecord,
  PanelRecord,
  SceneRecord,
  StoryEpisodeImprovementRecord,
  StoryCollaborationInput,
  WorkRecord,
} from '../types/api';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(
    message: string,
    status: number,
    code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type JsonRequestInit = Omit<RequestInit, 'body'> & { body?: unknown; timeoutMs?: number };

const billingRedirectTimeoutMs = 30_000;

interface JsonErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

interface SseHandlers {
  onChunk: (text: string) => void;
  onDone?: () => void;
}

export interface BlobResponse {
  blob: Blob;
  contentType: string | null;
}

export class LyraApiClient {
  private readonly tokenProvider: () => string | null;
  private readonly baseUrl: string;

  public constructor(tokenProvider: () => string | null) {
    this.tokenProvider = tokenProvider;
    const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
    this.baseUrl = typeof configuredBaseUrl === 'string' ? configuredBaseUrl : '';
  }

  public getOrganizationWorkspaces(): Promise<{ organizations: OrganizationWorkspaceRecord[] }> {
    return this.request('/api/organizations');
  }

  public getCurrentSession(): Promise<CurrentSessionRecord> {
    return this.request('/api/me');
  }

  public createOrganization(body: {
    name: string;
    legal_name?: string | null;
    billing_email?: string | null;
  }): Promise<OrganizationWorkspaceRecord> {
    return this.request('/api/organizations', { method: 'POST', body });
  }

  public getOrganization(organizationId: string): Promise<OrganizationWorkspaceRecord> {
    return this.request(`/api/organizations/${organizationId}`);
  }

  public updateOrganization(organizationId: string, body: Record<string, unknown>): Promise<{
    organization: OrganizationWorkspaceRecord['organization'];
  }> {
    return this.request(`/api/organizations/${organizationId}`, { method: 'PATCH', body });
  }

  public getOrganizationMembers(organizationId: string): Promise<{ members: OrganizationMemberRecord[] }> {
    return this.request(`/api/organizations/${organizationId}/members`);
  }

  public inviteOrganizationMember(
    organizationId: string,
    body: { email: string; role: OrganizationMemberRecord['role'] },
  ): Promise<OrganizationInvitationCreateRecord> {
    return this.request(`/api/organizations/${organizationId}/invitations`, { method: 'POST', body });
  }

  public getOrganizationInvitations(organizationId: string): Promise<{ invitations: OrganizationInvitationRecord[] }> {
    return this.request(`/api/organizations/${organizationId}/invitations`);
  }

  public resendOrganizationInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<OrganizationInvitationCreateRecord> {
    return this.request(`/api/organizations/${organizationId}/invitations/${invitationId}/resend`, {
      method: 'POST',
    });
  }

  public revokeOrganizationInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<{ invitation: OrganizationInvitationRecord }> {
    return this.request(`/api/organizations/${organizationId}/invitations/${invitationId}/revoke`, {
      method: 'POST',
    });
  }

  public updateOrganizationMember(
    organizationId: string,
    memberId: string,
    body: { role?: OrganizationMemberRecord['role']; status?: OrganizationMemberRecord['status'] },
  ): Promise<{ member: OrganizationMemberRecord }> {
    return this.request(`/api/organizations/${organizationId}/members/${memberId}`, { method: 'PATCH', body });
  }

  public removeOrganizationMember(organizationId: string, memberId: string): Promise<void> {
    return this.requestVoid(`/api/organizations/${organizationId}/members/${memberId}`, { method: 'DELETE' });
  }

  public acceptOrganizationInvitation(token: string): Promise<OrganizationWorkspaceRecord> {
    return this.request('/api/organization-invitations/accept', { method: 'POST', body: { token } });
  }

  public previewOrganizationInvitation(token: string): Promise<OrganizationInvitationPreviewRecord> {
    return this.request(`/api/organization-invitations/${encodeURIComponent(token)}`);
  }

  public getOrganizationBalance(organizationId: string): Promise<OrganizationCreditBalanceRecord> {
    return this.request(`/api/organizations/${organizationId}/credits/balance`);
  }

  public getOrganizationUsage(organizationId: string): Promise<{
    usage_events: OrganizationUsageEventRecord[];
    summary: OrganizationUsageSummaryRecord;
  }> {
    return this.request(`/api/organizations/${organizationId}/usage`);
  }

  public async downloadOrganizationUsageCsv(organizationId: string): Promise<BlobResponse> {
    const response = await fetch(
      this.toUrl(`/api/organizations/${organizationId}/usage.csv`),
      this.buildRequest({ method: 'GET' }),
    );
    if (!response.ok) {
      throw await this.toApiError(response);
    }

    return {
      blob: await response.blob(),
      contentType: response.headers.get('Content-Type'),
    };
  }

  public getOrganizationAuditLogs(organizationId: string): Promise<{ audit_logs: OrganizationAuditLogRecord[] }> {
    return this.request(`/api/organizations/${organizationId}/audit-logs`);
  }

  public getOrganizationBillingPlans(organizationId: string): Promise<{ subscription_plans: OrganizationBillingPlanRecord[] }> {
    return this.request(`/api/organizations/${organizationId}/billing/plans`);
  }

  public getOrganizationBilling(organizationId: string): Promise<OrganizationBillingSummaryRecord> {
    return this.request(`/api/organizations/${organizationId}/billing`);
  }

  public getOrganizationInvoices(organizationId: string): Promise<{ invoices: OrganizationInvoiceRecord[] }> {
    return this.request(`/api/organizations/${organizationId}/invoices`);
  }

  public createOrganizationSubscriptionCheckout(
    organizationId: string,
    planCode: 'enterprise_a' | 'enterprise_b' | 'enterprise_c',
  ): Promise<{ session_id: string; url: string }> {
    return this.request(`/api/organizations/${organizationId}/billing/checkout/subscription`, {
      method: 'POST',
      body: { plan_code: planCode },
      timeoutMs: billingRedirectTimeoutMs,
    });
  }

  public createOrganizationCreditCheckout(
    organizationId: string,
    packageCode: 'credits_200' | 'credits_1000' | 'credits_3000',
  ): Promise<{ session_id: string; package_code: string; url: string }> {
    return this.request(`/api/organizations/${organizationId}/billing/checkout/credits`, {
      method: 'POST',
      body: { package_code: packageCode },
      timeoutMs: billingRedirectTimeoutMs,
    });
  }

  public createOrganizationCustomerPortal(organizationId: string): Promise<{ url: string }> {
    return this.request(`/api/organizations/${organizationId}/billing/customer-portal`, {
      method: 'POST',
      timeoutMs: billingRedirectTimeoutMs,
    });
  }

  public getWorks(organizationId?: string | null): Promise<{ works: WorkRecord[] }> {
    return this.request(`/api/works${organizationQuery(organizationId)}`);
  }

  public createWork(body: Record<string, unknown>, organizationId?: string | null): Promise<WorkRecord> {
    return this.request('/api/works', {
      method: 'POST',
      body: organizationId === undefined || organizationId === null || organizationId.trim().length === 0
        ? body
        : { ...body, organization_id: organizationId },
    });
  }

  public updateWork(workId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<WorkRecord> {
    return this.request(`/api/works/${workId}${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public getChapters(workId: string, organizationId?: string | null): Promise<{ chapters: ChapterRecord[] }> {
    return this.request(`/api/works/${workId}/chapters${organizationQuery(organizationId)}`);
  }

  public createChapter(workId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<ChapterRecord> {
    return this.request(`/api/works/${workId}/chapters${organizationQuery(organizationId)}`, { method: 'POST', body });
  }

  public updateChapter(chapterId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<ChapterRecord> {
    return this.request(`/api/chapters/${chapterId}${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public moveChapter(chapterId: string, direction: 'up' | 'down', organizationId?: string | null): Promise<ChapterRecord> {
    return this.request(`/api/chapters/${chapterId}/move${organizationQuery(organizationId)}`, {
      method: 'POST',
      body: { direction },
    });
  }

  public deleteChapter(chapterId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/chapters/${chapterId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public getEpisodes(chapterId: string, organizationId?: string | null): Promise<{ episodes: EpisodeRecord[] }> {
    return this.request(`/api/chapters/${chapterId}/episodes${organizationQuery(organizationId)}`);
  }

  public createEpisode(chapterId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<EpisodeRecord> {
    return this.request(`/api/chapters/${chapterId}/episodes${organizationQuery(organizationId)}`, { method: 'POST', body });
  }

  public updateEpisode(episodeId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<EpisodeRecord> {
    return this.request(`/api/episodes/${episodeId}${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public moveEpisode(episodeId: string, direction: 'up' | 'down', organizationId?: string | null): Promise<EpisodeRecord> {
    return this.request(`/api/episodes/${episodeId}/move${organizationQuery(organizationId)}`, {
      method: 'POST',
      body: { direction },
    });
  }

  public deleteEpisode(episodeId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/episodes/${episodeId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public generatePageSkeleton(
    episodeId: string,
    body?: { overwrite_existing?: boolean; apply_story_plan?: boolean; language?: 'ja' | 'en' },
    organizationId?: string | null,
  ): Promise<
    | {
        job_id: string;
        queued: true;
        story_plan_applied: boolean;
      }
    | {
        pages_created: number;
        panels_created: number;
        replaced_existing: boolean;
        story_plan_applied: boolean;
        story_plan_job_id: string | null;
        story_plan_result?: {
          updated_page_count: number;
          updated_panel_count: number;
          updated_assignment_count: number;
          filled_field_count: number;
          compiler_used: boolean;
          compiler_provider: 'openai' | 'fallback';
          compiler_model: string | null;
          compiler_prompt_version: string | null;
          compiler_error: string | null;
        } | null;
      }
  > {
    return this.request(`/api/episodes/${episodeId}/generate-page-skeleton${organizationQuery(organizationId)}`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    });
  }

  public streamStoryCollaboration(
    input: StoryCollaborationInput,
    handlers: SseHandlers,
    organizationId?: string | null,
  ): Promise<void> {
    return this.stream(`/api/story/collaborate${organizationQuery(organizationId)}`, input, handlers);
  }

  public improveEpisodeDraft(body: {
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
  }, organizationId?: string | null): Promise<StoryEpisodeImprovementRecord> {
    return this.request(`/api/story/improve-episode-draft${organizationQuery(organizationId)}`, { method: 'POST', body });
  }

  public getEntities(workId: string, organizationId?: string | null): Promise<{ entities: EntityRecord[] }> {
    return this.request(`/api/works/${workId}/entities${organizationQuery(organizationId)}`);
  }

  public createEntity(workId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<EntityRecord> {
    return this.request(`/api/works/${workId}/entities${organizationQuery(organizationId)}`, { method: 'POST', body });
  }

  public updateEntity(entityId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<EntityRecord> {
    return this.request(`/api/entities/${entityId}${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public deleteEntity(entityId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/entities/${entityId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public importEntityImage(body: Record<string, unknown>, organizationId?: string | null): Promise<{
    suggested_fields: Record<string, unknown>;
    prompt_supplement: string;
    tmp_image_token: string;
  }> {
    return this.request(`/api/entities/import-image${organizationQuery(organizationId)}`, { method: 'POST', body });
  }

  public generateEntityReference(entityId: string, body?: Record<string, unknown>, organizationId?: string | null): Promise<{ job_id: string }> {
    return this.request(`/api/entities/${entityId}/generate-reference${organizationQuery(organizationId)}`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    });
  }

  public getEntityReferenceSet(entityId: string, organizationId?: string | null): Promise<EntityReferenceSetRecord> {
    return this.request(`/api/entities/${entityId}/reference-set${organizationQuery(organizationId)}`);
  }

  public confirmEntityReference(
    entityId: string,
    body: Record<string, unknown>,
    organizationId?: string | null,
  ): Promise<EntityReferenceSetRecord> {
    return this.request(`/api/entities/${entityId}/reference/confirm${organizationQuery(organizationId)}`, { method: 'POST', body });
  }

  public deleteEntityReference(entityId: string, refId: string, organizationId?: string | null): Promise<EntityReferenceSetRecord> {
    return this.request(`/api/entities/${entityId}/reference/${refId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public getScenes(episodeId: string, organizationId?: string | null): Promise<{ scenes: SceneRecord[] }> {
    return this.request(`/api/episodes/${episodeId}/scenes${organizationQuery(organizationId)}`);
  }

  public createScene(episodeId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<SceneRecord> {
    return this.request(`/api/episodes/${episodeId}/scenes${organizationQuery(organizationId)}`, { method: 'POST', body });
  }

  public updateScene(sceneId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<SceneRecord> {
    return this.request(`/api/scenes/${sceneId}${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public getPages(episodeId: string, organizationId?: string | null): Promise<{ pages: PageRecord[] }> {
    return this.request(`/api/episodes/${episodeId}/pages${organizationQuery(organizationId)}`);
  }

  public updatePage(pageId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<PageRecord> {
    return this.request(`/api/pages/${pageId}${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public autofillPageFromScenes(pageId: string, language: 'ja' | 'en', organizationId?: string | null): Promise<{
    updated_panel_count: number;
    filled_field_count: number;
    compiler_used: boolean;
    compiler_provider: 'openai' | 'fallback';
    compiler_model: string | null;
    compiler_prompt_version: string | null;
    compiler_error: string | null;
  }> {
    return this.request(`/api/pages/${pageId}/autofill-from-scenes${organizationQuery(organizationId)}`, { method: 'POST', body: { language } });
  }

  public autofillEpisodePagesFromStory(episodeId: string, language: 'ja' | 'en', organizationId?: string | null): Promise<{
    job_id: string;
  }> {
    return this.request(`/api/episodes/${episodeId}/autofill-pages-from-story${organizationQuery(organizationId)}`, {
      method: 'POST',
      body: { language },
    });
  }

  public generatePage(pageId: string, organizationId?: string | null): Promise<{ job_id: string }> {
    return this.request(`/api/pages/${pageId}/generate${organizationQuery(organizationId)}`, { method: 'POST' });
  }

  public confirmPage(pageId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/pages/${pageId}/confirm${organizationQuery(organizationId)}`, { method: 'POST' });
  }

  public reopenPage(pageId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/pages/${pageId}/reopen${organizationQuery(organizationId)}`, { method: 'POST' });
  }

  public getPanels(pageId: string, organizationId?: string | null): Promise<{ panels: PanelRecord[] }> {
    return this.request(`/api/pages/${pageId}/panels${organizationQuery(organizationId)}`);
  }

  public createPanel(pageId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<PanelRecord> {
    return this.request(`/api/pages/${pageId}/panels${organizationQuery(organizationId)}`, { method: 'POST', body });
  }

  public updatePanel(panelId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<PanelRecord> {
    return this.request(`/api/panels/${panelId}${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public deletePanel(panelId: string, organizationId?: string | null): Promise<void> {
    return this.requestVoid(`/api/panels/${panelId}${organizationQuery(organizationId)}`, { method: 'DELETE' });
  }

  public reorderPanels(pageId: string, panelIds: string[], organizationId?: string | null): Promise<{ panels: PanelRecord[] }> {
    return this.request(`/api/pages/${pageId}/panels/order${organizationQuery(organizationId)}`, {
      method: 'PUT',
      body: { panel_ids: panelIds },
    });
  }

  public replacePanelAssignments(panelId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<{
    entities: PanelRecord['entities'];
  }> {
    return this.request(`/api/panels/${panelId}/entities${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public getFrames(pageId: string, organizationId?: string | null): Promise<{ frames: PanelFrameRecord[] }> {
    return this.request(`/api/pages/${pageId}/frames${organizationQuery(organizationId)}`);
  }

  public applyFrameTemplate(pageId: string, templateId: string, organizationId?: string | null): Promise<{
    template_id: string;
    panel_count: number;
    frames: PanelFrameRecord[];
  }> {
    return this.request(`/api/pages/${pageId}/frames/apply-template${organizationQuery(organizationId)}`, {
      method: 'POST',
      body: { template_id: templateId },
    });
  }

  public applyPageLayoutTemplate(pageId: string, templateId: string, allowPanelTruncation: boolean, organizationId?: string | null): Promise<{
    template_id: string;
    panel_count: number;
    created_panel_count: number;
    deleted_panel_count: number;
    frames: PanelFrameRecord[];
  }> {
    return this.request(`/api/pages/${pageId}/layout-template${organizationQuery(organizationId)}`, {
      method: 'POST',
      body: {
        template_id: templateId,
        allow_panel_truncation: allowPanelTruncation,
      },
    });
  }

  public replaceFrames(pageId: string, body: Record<string, unknown>, organizationId?: string | null): Promise<{ frames: PanelFrameRecord[] }> {
    return this.request(`/api/pages/${pageId}/frames${organizationQuery(organizationId)}`, { method: 'PUT', body });
  }

  public getBalloons(pageId: string): Promise<{ balloons: BalloonRecord[] }> {
    return this.request(`/api/pages/${pageId}/balloons`);
  }

  public createBalloon(pageId: string, body: Record<string, unknown>): Promise<BalloonRecord> {
    return this.request(`/api/pages/${pageId}/balloons`, { method: 'POST', body });
  }

  public updateBalloon(balloonId: string, body: Record<string, unknown>): Promise<BalloonRecord> {
    return this.request(`/api/balloons/${balloonId}`, { method: 'PUT', body });
  }

  public deleteBalloon(balloonId: string): Promise<void> {
    return this.requestVoid(`/api/balloons/${balloonId}`, { method: 'DELETE' });
  }

  public autoBalloons(pageId: string): Promise<{ balloons: BalloonRecord[] }> {
    return this.request(`/api/pages/${pageId}/auto-balloons`, { method: 'POST' });
  }

  public getCompositions(searchParams = new URLSearchParams()): Promise<{ compositions: CompositionRecord[] }> {
    const query = searchParams.toString();
    return this.request(`/api/compositions${query.length > 0 ? `?${query}` : ''}`);
  }

  public getJob(jobId: string, organizationId?: string | null): Promise<GenerationJobRecord> {
    return this.request(`/api/jobs/${jobId}${organizationQuery(organizationId)}`);
  }

  public cancelJob(jobId: string, organizationId?: string | null): Promise<GenerationJobRecord> {
    return this.request(`/api/jobs/${jobId}/cancel${organizationQuery(organizationId)}`, {
      method: 'POST',
    });
  }

  public getBalance(): Promise<BillingBalanceRecord> {
    return this.request('/api/billing/balance');
  }

  public createSubscriptionCheckout(planCode: 'standard' | 'premium'): Promise<{ session_id: string; url: string }> {
    return this.request('/api/billing/checkout/subscription', {
      method: 'POST',
      body: { plan_code: planCode },
      timeoutMs: billingRedirectTimeoutMs,
    });
  }

  public createCreditCheckout(
    packageCode: 'credits_200' | 'credits_1000' | 'credits_3000',
  ): Promise<{ session_id: string; package_code: string; url: string }> {
    return this.request('/api/billing/checkout/credits', {
      method: 'POST',
      body: { package_code: packageCode },
      timeoutMs: billingRedirectTimeoutMs,
    });
  }

  public createCustomerPortal(): Promise<{ url: string }> {
    return this.request('/api/billing/customer-portal', { method: 'POST', timeoutMs: billingRedirectTimeoutMs });
  }

  public async exportPageImage(pageId: string, organizationId?: string | null): Promise<BlobResponse> {
    const response = await fetch(
      this.toUrl(`/api/pages/${pageId}/export-image${organizationQuery(organizationId)}`),
      this.buildRequest({ method: 'GET' }),
    );
    if (!response.ok) {
      throw await this.toApiError(response);
    }

    return {
      blob: await response.blob(),
      contentType: response.headers.get('Content-Type'),
    };
  }

  public async exportEntityReferenceImage(
    entityId: string,
    refId: string,
    organizationId?: string | null,
  ): Promise<BlobResponse> {
    const response = await fetch(
      this.toUrl(`/api/entities/${entityId}/reference/${encodeURIComponent(refId)}/image${organizationQuery(organizationId)}`),
      this.buildRequest({ method: 'GET' }),
    );
    if (!response.ok) {
      throw await this.toApiError(response);
    }

    return {
      blob: await response.blob(),
      contentType: response.headers.get('Content-Type'),
    };
  }

  public async exportEntityReferenceCandidateImage(
    entityId: string,
    candidateToken: string,
    organizationId?: string | null,
  ): Promise<BlobResponse> {
    const params = new URLSearchParams({ candidate_token: candidateToken });
    if (organizationId !== undefined && organizationId !== null && organizationId.trim().length > 0) {
      params.set('organization_id', organizationId);
    }
    const response = await fetch(
      this.toUrl(`/api/entities/${entityId}/reference-candidate-image?${params.toString()}`),
      this.buildRequest({ method: 'GET' }),
    );
    if (!response.ok) {
      throw await this.toApiError(response);
    }

    return {
      blob: await response.blob(),
      contentType: response.headers.get('Content-Type'),
    };
  }

  private async request<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
    const response = await this.fetchWithOptionalTimeout(path, init);
    if (!response.ok) {
      throw await this.toApiError(response);
    }

    return (await response.json()) as T;
  }

  private async requestVoid(path: string, init: JsonRequestInit = {}): Promise<void> {
    const response = await this.fetchWithOptionalTimeout(path, init);
    if (!response.ok) {
      throw await this.toApiError(response);
    }
  }

  private async fetchWithOptionalTimeout(path: string, init: JsonRequestInit): Promise<Response> {
    if (init.timeoutMs === undefined) {
      return await fetch(this.toUrl(path), this.buildRequest(init));
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), init.timeoutMs);
    try {
      return await fetch(this.toUrl(path), this.buildRequest({ ...init, signal: controller.signal }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('The billing page took too long to prepare. Please try again.', 504, 'BILLING_TIMEOUT');
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private async stream(path: string, body: unknown, handlers: SseHandlers): Promise<void> {
    const response = await fetch(this.toUrl(path), this.buildRequest({ method: 'POST', body }));
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    if (response.body === null) {
      throw new ApiError('Story collaboration stream is unavailable', 500, 'STREAM_UNAVAILABLE');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';
    let dataLines: string[] = [];

    const flushEvent = (): void => {
      if (dataLines.length === 0) {
        currentEvent = 'message';
        return;
      }

      const data = dataLines.join('\n');
      if (currentEvent === 'chunk') {
        const parsed = JSON.parse(data) as { text?: string };
        if (typeof parsed.text === 'string') {
          handlers.onChunk(parsed.text);
        }
      } else if (currentEvent === 'done') {
        handlers.onDone?.();
      } else if (currentEvent === 'error') {
        const parsed = JSON.parse(data) as { message?: string };
        throw new ApiError(parsed.message ?? 'Story collaboration failed', 500, 'SSE_ERROR');
      }

      currentEvent = 'message';
      dataLines = [];
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim().length > 0) {
          flushEvent();
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex >= 0) {
        const message = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);

        for (const line of message.split('\n')) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        flushEvent();
        boundaryIndex = buffer.indexOf('\n\n');
      }
    }
  }

  private buildRequest(init: JsonRequestInit): RequestInit {
    const token = this.tokenProvider();
    const headers = new Headers(init.headers);

    if (token !== null) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    return {
      ...init,
      headers,
      body: init.body === undefined ? init.body : JSON.stringify(init.body),
    };
  }

  private toUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async toApiError(response: Response): Promise<ApiError> {
    const fallbackMessage = `${response.status} ${response.statusText}`;

    try {
      const json = (await response.json()) as JsonErrorBody;
      const message = json.error?.message ?? fallbackMessage;
      const code = json.error?.code ?? null;
      return new ApiError(message, response.status, code);
    } catch {
      return new ApiError(fallbackMessage, response.status, null);
    }
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    const payload = JSON.parse(decoded) as unknown;

    return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function organizationQuery(organizationId: string | null | undefined): string {
  if (organizationId === undefined || organizationId === null || organizationId.trim().length === 0) {
    return '';
  }

  return `?organization_id=${encodeURIComponent(organizationId)}`;
}
