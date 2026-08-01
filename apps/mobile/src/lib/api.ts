import type { ZodType } from 'zod';
import {
  chapterSchema,
  chaptersResponseSchema,
  currentSessionSchema,
  episodeSchema,
  episodesResponseSchema,
  entitiesResponseSchema,
  entityImportResponseSchema,
  entityReferenceGenerationResponseSchema,
  entityReferenceSetSchema,
  entityStateSchema,
  entityStatesResponseSchema,
  entitySchema,
  generationJobHistoryResponseSchema,
  generationJobResponseSchema,
  pageSchema,
  panelAssignmentsResponseSchema,
  panelSchema,
  panelsResponseSchema,
  pageJobAcceptedResponseSchema,
  pagesResponseSchema,
  pageSkeletonResponseSchema,
  sceneSchema,
  scenesResponseSchema,
  workSchema,
  worksResponseSchema,
} from '../domain/apiSchemas';
import type { EpisodeStoryUpdatePayload } from '../domain/episodeStoryDraft';
import type { StoryItemMoveDirection } from '../domain/storyHierarchyPolicy';
import type { AuthTokens } from '../domain/auth';

export type CurrentSession = ReturnType<typeof currentSessionSchema.parse>;
export type WorkRecord = ReturnType<typeof workSchema.parse>;
export type ChapterRecord = ReturnType<typeof chapterSchema.parse>;
export type EpisodeRecord = ReturnType<typeof episodeSchema.parse>;
export type EntityRecord = ReturnType<typeof entitySchema.parse>;
export type EntityImportResponseRecord = ReturnType<typeof entityImportResponseSchema.parse>;
export type EntityReferenceGenerationResponse = ReturnType<
  typeof entityReferenceGenerationResponseSchema.parse
>;
export type EntityReferenceSetRecord = ReturnType<typeof entityReferenceSetSchema.parse>;
export type EntityStateRecord = ReturnType<typeof entityStateSchema.parse>;
export type SceneRecord = ReturnType<typeof sceneSchema.parse>;
export type PageRecord = ReturnType<typeof pageSchema.parse>;
export type PanelRecord = ReturnType<typeof panelSchema.parse>;
export type PanelEntityAssignmentRecord = PanelRecord['entities'][number];
export type GenerationJobRecord = ReturnType<typeof generationJobResponseSchema.parse>;
export type PageSkeletonResponse = ReturnType<typeof pageSkeletonResponseSchema.parse>;
export type PageJobAcceptedResponse = ReturnType<typeof pageJobAcceptedResponseSchema.parse>;

export interface ListWorksPageInput {
  limit: number;
  cursor?: string | null;
}

export interface ListJobsPageInput {
  limit: number;
  cursor?: string | null;
}

export interface ListEntitiesPageInput {
  limit: number;
  cursor?: string | null;
}

export interface CreateEntityInput {
  entity_type: 'character' | 'nonhuman' | 'object';
  name: string;
  free_description: string | null;
}

export interface ConfirmEntityReferenceInput {
  selected_candidate_tokens: [string, ...string[]];
  primary_candidate_token: string;
  prompt_supplement: string | null;
}

export type UpdateEntityInput =
  | { name: string; free_description?: string | null }
  | { name?: never; free_description: string | null };

export interface CreateEntityStateInput {
  scene_id?: string | null;
  costume_note?: string | null;
  condition_note?: string | null;
  hair_note?: string | null;
  expression_default: string;
  extra_note?: string | null;
}

export interface UpdateEntityStateInput {
  scene_id?: string | null;
  costume_note?: string | null;
  condition_note?: string | null;
  hair_note?: string | null;
  expression_default?: string;
  extra_note?: string | null;
}

export interface ReplacePanelEntityAssignmentsInput {
  entities: PanelEntityAssignmentRecord[];
  expected_entities: PanelEntityAssignmentRecord[];
}

export interface GeneratePageSkeletonInput {
  overwrite_existing: false;
  apply_story_plan: false;
  language: 'ja' | 'en';
}

export interface UpdatePageSettingsInput {
  dialogue_mode?: PageRecord['dialogue_mode'];
  page_dialogue_toggle?: boolean;
  style_reference?: {
    title: string;
    notes: string | null;
  } | null;
  story_page_purpose?: string | null;
  story_continuity_note?: string | null;
}

export interface CreateStoryItemInput {
  order: number;
  title: string;
}

export interface CreateSceneInput {
  order: number;
  location?: string | null;
  time?: string | null;
  atmosphere?: string | null;
}

export interface UpdatePanelInput {
  panel_role?: PanelRecord['panel_role'];
  panel_size?: PanelRecord['panel_size'];
  situation_text?: string | null;
  composition?: {
    source: PanelRecord['composition']['source'];
    gallery_item_id: string | null;
    composition_prompt: string | null;
    shot_type: 'full_body' | 'half_body' | 'close_up' | 'wide' | 'extreme_close_up' | null;
    angle: 'front' | 'side' | 'three_quarter' | 'bird_eye' | 'worm_eye' | 'dutch_angle' | null;
    custom_note: string | null;
  };
  dialogue_in_panel?: boolean;
  dialogue?: {
    entity_id: string | null;
    text: string;
    type: PanelRecord['dialogue'][number]['type'];
    position: PanelRecord['dialogue'][number]['position'];
  }[];
  sfx_text?: string | null;
  background_note?: string | null;
  panel_notes?: string | null;
}

export type UpdateSceneInput = Partial<Omit<CreateSceneInput, 'order'>>;

export interface MobileAuthSessionPort {
  getTokens(): Promise<AuthTokens | null>;
  refreshTokens(): Promise<AuthTokens>;
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
}

export class ApiError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface LyraMobileApiClientOptions {
  apiBaseUrl: string;
  auth: MobileAuthSessionPort;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const ENTITY_IMPORT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_ENTITY_PROMPT_SUPPLEMENT_LENGTH = 2_000;

export class LyraMobileApiClient {
  private readonly apiBaseUrl: string;
  private readonly auth: MobileAuthSessionPort;
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;
  private imageAuthorizationRefresh: Promise<string> | null = null;

  public constructor(options: LyraMobileApiClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    this.auth = options.auth;
    this.fetcher = options.fetcher ?? fetch;
    this.requestTimeoutMs = normalizeRequestTimeout(options.requestTimeoutMs);
  }

  public async getCurrentSession(): Promise<CurrentSession> {
    return this.requestJson('/api/me', currentSessionSchema);
  }

  public async getWorksPage(
    input: ListWorksPageInput,
    organizationId: string | null = null,
  ): Promise<{ works: WorkRecord[]; next_cursor: string | null }> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
    }
    const query = new URLSearchParams({ limit: String(input.limit) });
    const cursor = input.cursor?.trim();
    if (cursor !== undefined && cursor.length > 0) {
      if (cursor.length > 512) {
        throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
      }
      query.set('cursor', cursor);
    }
    appendOrganizationQuery(query, organizationId);
    const response = await this.requestJson(
      `/api/works?${query.toString()}`,
      worksResponseSchema,
    );
    return {
      works: response.works,
      next_cursor: response.next_cursor ?? null,
    };
  }

  public getChapters(
    workId: string,
    organizationId: string | null = null,
  ): Promise<{ chapters: ChapterRecord[] }> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/works/${encodeURIComponent(workId)}/chapters`,
        organizationId,
      ),
      chaptersResponseSchema,
    );
  }

  public async getEntitiesPage(
    workId: string,
    input: ListEntitiesPageInput,
    organizationId: string | null = null,
  ): Promise<{ entities: EntityRecord[]; next_cursor: string | null }> {
    const query = buildBoundedPageQuery(input, organizationId);
    const response = await this.requestJson(
      `/api/works/${encodeURIComponent(workId)}/entities?${query.toString()}`,
      entitiesResponseSchema,
    );
    if (response.entities.some((entity) => entity.work_id !== workId)) {
      throw invalidApiResponse();
    }
    return {
      entities: response.entities,
      next_cursor: response.next_cursor ?? null,
    };
  }

  public async createEntity(
    workId: string,
    body: CreateEntityInput,
    organizationId: string | null = null,
  ): Promise<EntityRecord> {
    const entity = await this.requestJson(
      withOrganizationQuery(
        `/api/works/${encodeURIComponent(workId)}/entities`,
        organizationId,
      ),
      entitySchema,
      { method: 'POST', body },
    );
    if (entity.work_id !== workId) {
      throw invalidApiResponse();
    }
    return entity;
  }

  public async updateEntity(
    entityId: string,
    body: UpdateEntityInput,
    organizationId: string | null = null,
  ): Promise<EntityRecord> {
    if (Object.keys(body).length === 0) {
      throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
    }
    const entity = await this.requestJson(
      withOrganizationQuery(`/api/entities/${encodeURIComponent(entityId)}`, organizationId),
      entitySchema,
      { method: 'PUT', body },
    );
    if (entity.id !== entityId) {
      throw invalidApiResponse();
    }
    return entity;
  }

  public async updateEntityGenerationContext(
    entityId: string,
    promptSupplement: string | null,
    organizationId: string | null = null,
  ): Promise<EntityRecord> {
    if (
      promptSupplement !== null
      && promptSupplement.length > MAX_ENTITY_PROMPT_SUPPLEMENT_LENGTH
    ) {
      throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
    }
    const entity = await this.requestJson(
      withOrganizationQuery(`/api/entities/${encodeURIComponent(entityId)}`, organizationId),
      entitySchema,
      { method: 'PUT', body: { prompt_supplement: promptSupplement } },
    );
    if (entity.id !== entityId) {
      throw invalidApiResponse();
    }
    return entity;
  }

  public async getEntityReferenceSet(
    entityId: string,
    organizationId: string | null = null,
  ): Promise<EntityReferenceSetRecord> {
    const referenceSet = await this.requestJson(
      withOrganizationQuery(
        `/api/entities/${encodeURIComponent(entityId)}/reference-set`,
        organizationId,
      ),
      entityReferenceSetSchema,
    );
    if (referenceSet.entity_id !== entityId) {
      throw invalidApiResponse();
    }
    return referenceSet;
  }

  public importEntityReferenceImage(
    entityId: string,
    entityType: EntityRecord['entity_type'],
    imageDataUrl: string,
    organizationId: string | null = null,
  ): Promise<EntityImportResponseRecord> {
    return this.requestJson(
      withOrganizationQuery('/api/entities/import-image', organizationId),
      entityImportResponseSchema,
      {
        method: 'POST',
        body: {
          entity_type: entityType,
          entity_id: entityId,
          image_base64: imageDataUrl,
        },
        timeoutMs: ENTITY_IMPORT_REQUEST_TIMEOUT_MS,
      },
    );
  }

  public generateEntityReference(
    entityId: string,
    sourceCandidateToken: string | null = null,
    organizationId: string | null = null,
  ): Promise<EntityReferenceGenerationResponse> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/entities/${encodeURIComponent(entityId)}/generate-reference`,
        organizationId,
      ),
      entityReferenceGenerationResponseSchema,
      {
        method: 'POST',
        ...(sourceCandidateToken === null
          ? {}
          : { body: { source_candidate_token: sourceCandidateToken } }),
      },
    );
  }

  public async confirmEntityReference(
    entityId: string,
    body: ConfirmEntityReferenceInput,
    organizationId: string | null = null,
  ): Promise<EntityReferenceSetRecord> {
    const referenceSet = await this.requestJson(
      withOrganizationQuery(
        `/api/entities/${encodeURIComponent(entityId)}/reference/confirm`,
        organizationId,
      ),
      entityReferenceSetSchema,
      { method: 'POST', body },
    );
    if (referenceSet.entity_id !== entityId) {
      throw invalidApiResponse();
    }
    return referenceSet;
  }

  public refreshImageAuthorizationHeader(): Promise<string> {
    if (this.imageAuthorizationRefresh !== null) {
      return this.imageAuthorizationRefresh;
    }
    const operation = this.auth.refreshTokens().then(
      (tokens) => `Bearer ${tokens.idToken}`,
    );
    this.imageAuthorizationRefresh = operation;
    void operation.then(
      () => {
        if (this.imageAuthorizationRefresh === operation) {
          this.imageAuthorizationRefresh = null;
        }
      },
      () => {
        if (this.imageAuthorizationRefresh === operation) {
          this.imageAuthorizationRefresh = null;
        }
      },
    );
    return operation;
  }

  public createWork(
    title: string,
    organizationId: string | null = null,
  ): Promise<WorkRecord> {
    const body: { title: string; organization_id?: string } = { title };
    if (organizationId !== null) {
      body.organization_id = organizationId;
    }
    return this.requestJson('/api/works', workSchema, {
      method: 'POST',
      body,
    });
  }

  public updateWork(
    workId: string,
    title: string,
    organizationId: string | null = null,
  ): Promise<WorkRecord> {
    return this.requestJson(
      withOrganizationQuery(`/api/works/${encodeURIComponent(workId)}`, organizationId),
      workSchema,
      { method: 'PUT', body: { title } },
    );
  }

  public createChapter(
    workId: string,
    body: CreateStoryItemInput,
    organizationId: string | null = null,
  ): Promise<ChapterRecord> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/works/${encodeURIComponent(workId)}/chapters`,
        organizationId,
      ),
      chapterSchema,
      { method: 'POST', body },
    );
  }

  public updateChapter(
    chapterId: string,
    title: string,
    organizationId: string | null = null,
  ): Promise<ChapterRecord> {
    return this.requestJson(
      withOrganizationQuery(`/api/chapters/${encodeURIComponent(chapterId)}`, organizationId),
      chapterSchema,
      { method: 'PUT', body: { title } },
    );
  }

  public moveChapter(
    chapterId: string,
    direction: StoryItemMoveDirection,
    organizationId: string | null = null,
  ): Promise<ChapterRecord> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/chapters/${encodeURIComponent(chapterId)}/move`,
        organizationId,
      ),
      chapterSchema,
      { method: 'POST', body: { direction } },
    );
  }

  public deleteChapter(
    chapterId: string,
    organizationId: string | null = null,
  ): Promise<void> {
    return this.requestNoContent(
      withOrganizationQuery(`/api/chapters/${encodeURIComponent(chapterId)}`, organizationId),
    );
  }

  public getEpisodes(
    chapterId: string,
    organizationId: string | null = null,
  ): Promise<{ episodes: EpisodeRecord[] }> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/chapters/${encodeURIComponent(chapterId)}/episodes`,
        organizationId,
      ),
      episodesResponseSchema,
    );
  }

  public createEpisode(
    chapterId: string,
    body: CreateStoryItemInput,
    organizationId: string | null = null,
  ): Promise<EpisodeRecord> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/chapters/${encodeURIComponent(chapterId)}/episodes`,
        organizationId,
      ),
      episodeSchema,
      { method: 'POST', body },
    );
  }

  public moveEpisode(
    episodeId: string,
    direction: StoryItemMoveDirection,
    crossChapter = false,
    organizationId: string | null = null,
  ): Promise<EpisodeRecord> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/episodes/${encodeURIComponent(episodeId)}/move`,
        organizationId,
      ),
      episodeSchema,
      {
        method: 'POST',
        body: crossChapter
          ? { direction, cross_chapter: true }
          : { direction },
      },
    );
  }

  public updateEpisode(
    episodeId: string,
    body: EpisodeStoryUpdatePayload,
    organizationId: string | null = null,
  ): Promise<EpisodeRecord> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/episodes/${encodeURIComponent(episodeId)}`,
        organizationId,
      ),
      episodeSchema,
      { method: 'PUT', body },
    );
  }

  public deleteEpisode(
    episodeId: string,
    organizationId: string | null = null,
  ): Promise<void> {
    return this.requestNoContent(
      withOrganizationQuery(`/api/episodes/${encodeURIComponent(episodeId)}`, organizationId),
    );
  }

  public getScenes(
    episodeId: string,
    organizationId: string | null = null,
  ): Promise<{ scenes: SceneRecord[] }> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/episodes/${encodeURIComponent(episodeId)}/scenes`,
        organizationId,
      ),
      scenesResponseSchema,
    );
  }

  public async getEntityStates(
    entityId: string,
    organizationId: string | null = null,
  ): Promise<{ entity_states: EntityStateRecord[] }> {
    const response = await this.requestJson(
      withOrganizationQuery(
        `/api/entities/${encodeURIComponent(entityId)}/states`,
        organizationId,
      ),
      entityStatesResponseSchema,
    );
    if (response.entity_states.some((state) => state.entity_id !== entityId)) {
      throw invalidApiResponse();
    }
    return response;
  }

  public async createEntityState(
    entityId: string,
    body: CreateEntityStateInput,
    organizationId: string | null = null,
  ): Promise<EntityStateRecord> {
    const state = await this.requestJson(
      withOrganizationQuery(
        `/api/entities/${encodeURIComponent(entityId)}/states`,
        organizationId,
      ),
      entityStateSchema,
      { method: 'POST', body },
    );
    if (
      state.entity_id !== entityId
      || state.costume_ref_id !== null
      || !entityStateMatchesRequestedFields(state, body)
    ) {
      throw invalidApiResponse();
    }
    return state;
  }

  public async updateEntityState(
    entityId: string,
    stateId: string,
    body: UpdateEntityStateInput,
    organizationId: string | null = null,
  ): Promise<EntityStateRecord> {
    if (Object.keys(body).length === 0) {
      throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
    }
    const state = await this.requestJson(
      withOrganizationQuery(
        `/api/entities/${encodeURIComponent(entityId)}/states/${encodeURIComponent(stateId)}`,
        organizationId,
      ),
      entityStateSchema,
      { method: 'PUT', body },
    );
    if (
      state.id !== stateId
      || state.entity_id !== entityId
      || !entityStateMatchesRequestedFields(state, body)
    ) {
      throw invalidApiResponse();
    }
    return state;
  }

  public createScene(
    episodeId: string,
    body: CreateSceneInput,
    organizationId: string | null = null,
  ): Promise<SceneRecord> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/episodes/${encodeURIComponent(episodeId)}/scenes`,
        organizationId,
      ),
      sceneSchema,
      { method: 'POST', body },
    );
  }

  public updateScene(
    sceneId: string,
    body: UpdateSceneInput,
    organizationId: string | null = null,
  ): Promise<SceneRecord> {
    return this.requestJson(
      withOrganizationQuery(`/api/scenes/${encodeURIComponent(sceneId)}`, organizationId),
      sceneSchema,
      { method: 'PUT', body },
    );
  }

  public getPages(
    episodeId: string,
    organizationId: string | null = null,
  ): Promise<{ pages: PageRecord[]; next_cursor?: string | null }> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/episodes/${encodeURIComponent(episodeId)}/pages`,
        organizationId,
      ),
      pagesResponseSchema,
    );
  }

  public async getPanels(
    pageId: string,
    organizationId: string | null = null,
  ): Promise<{ panels: PanelRecord[] }> {
    const response = await this.requestJson(
      withOrganizationQuery(
        `/api/pages/${encodeURIComponent(pageId)}/panels`,
        organizationId,
      ),
      panelsResponseSchema,
    );
    if (response.panels.some((panel) => panel.page_id !== pageId)) {
      throw invalidApiResponse();
    }
    return response;
  }

  public async updatePageSettings(
    pageId: string,
    body: UpdatePageSettingsInput,
    organizationId: string | null = null,
  ): Promise<PageRecord> {
    if (Object.keys(body).length === 0) {
      throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
    }
    const page = await this.requestJson(
      withOrganizationQuery(`/api/pages/${encodeURIComponent(pageId)}`, organizationId),
      pageSchema,
      { method: 'PUT', body },
    );
    if (page.id !== pageId) {
      throw invalidApiResponse();
    }
    return page;
  }

  public async updatePanel(
    panelId: string,
    body: UpdatePanelInput,
    organizationId: string | null = null,
  ): Promise<PanelRecord> {
    if (Object.keys(body).length === 0) {
      throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
    }
    const panel = await this.requestJson(
      withOrganizationQuery(`/api/panels/${encodeURIComponent(panelId)}`, organizationId),
      panelSchema,
      { method: 'PUT', body },
    );
    if (panel.id !== panelId) {
      throw invalidApiResponse();
    }
    return panel;
  }

  public replacePanelEntityAssignments(
    panelId: string,
    body: ReplacePanelEntityAssignmentsInput,
    organizationId: string | null = null,
  ): Promise<{ entities: PanelEntityAssignmentRecord[] }> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/panels/${encodeURIComponent(panelId)}/entities`,
        organizationId,
      ),
      panelAssignmentsResponseSchema,
      { method: 'PUT', body },
    );
  }

  public generatePageSkeleton(
    episodeId: string,
    body: GeneratePageSkeletonInput,
    organizationId: string | null = null,
  ): Promise<PageSkeletonResponse> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/episodes/${encodeURIComponent(episodeId)}/generate-page-skeleton`,
        organizationId,
      ),
      pageSkeletonResponseSchema,
      { method: 'POST', body },
    );
  }

  public autofillEpisodePagesFromStory(
    episodeId: string,
    language: 'ja' | 'en',
    organizationId: string | null = null,
  ): Promise<PageJobAcceptedResponse> {
    return this.requestJson(
      withOrganizationQuery(
        `/api/episodes/${encodeURIComponent(episodeId)}/autofill-pages-from-story`,
        organizationId,
      ),
      pageJobAcceptedResponseSchema,
      { method: 'POST', body: { language } },
    );
  }

  public async getJobs(
    input: ListJobsPageInput,
    organizationId: string | null = null,
  ): Promise<{ jobs: GenerationJobRecord[]; next_cursor: string | null }> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
    }
    const query = new URLSearchParams({ limit: String(input.limit) });
    const cursor = input.cursor?.trim();
    if (cursor !== undefined && cursor.length > 0) {
      if (cursor.length > 512) {
        throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
      }
      query.set('cursor', cursor);
    }
    appendOrganizationQuery(query, organizationId);
    return this.requestJson(
      `/api/jobs?${query.toString()}`,
      generationJobHistoryResponseSchema,
    );
  }

  public async getJob(
    jobId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJobRecord> {
    const job = await this.requestJson(
      withOrganizationQuery(`/api/jobs/${encodeURIComponent(jobId)}`, organizationId),
      generationJobResponseSchema,
    );
    if (job.id !== jobId) {
      throw new ApiError(
        'INVALID_API_RESPONSE',
        502,
        'The server returned an invalid response.',
      );
    }
    return job;
  }

  private async requireTokens(): Promise<AuthTokens> {
    const tokens = await this.auth.getTokens();
    if (tokens === null) {
      throw new ApiError('AUTH_REQUIRED', 401, 'Authentication is required.');
    }
    return tokens;
  }

  private async requestJson<T>(
    path: string,
    schema: ZodType<T>,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const tokens = await this.requireTokens();
    let response = await this.request(path, tokens.idToken, options);
    if (response.status === 401) {
      const refreshed = await this.auth.refreshTokens();
      response = await this.request(path, refreshed.idToken, options);
    }
    if (!response.ok) {
      throw new ApiError(
        response.status >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED',
        response.status,
        'The request could not be completed.',
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        'INVALID_API_RESPONSE',
        502,
        'The server returned an invalid response.',
      );
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(
        'INVALID_API_RESPONSE',
        502,
        'The server returned an invalid response.',
      );
    }
    return parsed.data;
  }

  private async requestNoContent(path: string): Promise<void> {
    const options: ApiRequestOptions = { method: 'DELETE' };
    const tokens = await this.requireTokens();
    let response = await this.request(path, tokens.idToken, options);
    if (response.status === 401) {
      const refreshed = await this.auth.refreshTokens();
      response = await this.request(path, refreshed.idToken, options);
    }
    if (!response.ok) {
      throw new ApiError(
        response.status >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED',
        response.status,
        'The request could not be completed.',
      );
    }
    if (response.status !== 204) {
      throw new ApiError(
        'INVALID_API_RESPONSE',
        502,
        'The server returned an invalid response.',
      );
    }
  }

  private async request(
    path: string,
    idToken: string,
    options: ApiRequestOptions,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      normalizeRequestTimeout(options.timeoutMs ?? this.requestTimeoutMs),
    );
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      };
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      return await this.fetcher(`${this.apiBaseUrl}${path}`, {
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        headers,
        method: options.method ?? 'GET',
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        'NETWORK_ERROR',
        0,
        'The server could not be reached.',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function normalizeRequestTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_REQUEST_TIMEOUT_MS);
}

function appendOrganizationQuery(
  query: URLSearchParams,
  organizationId: string | null,
): void {
  if (organizationId !== null) {
    query.set('organization_id', organizationId);
  }
}

function buildBoundedPageQuery(
  input: { limit: number; cursor?: string | null },
  organizationId: string | null,
): URLSearchParams {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
  }
  const query = new URLSearchParams({ limit: String(input.limit) });
  const cursor = input.cursor?.trim();
  if (cursor !== undefined && cursor.length > 0) {
    if (cursor.length > 512) {
      throw new ApiError('INVALID_REQUEST', 422, 'The request is invalid.');
    }
    query.set('cursor', cursor);
  }
  appendOrganizationQuery(query, organizationId);
  return query;
}

function invalidApiResponse(): ApiError {
  return new ApiError(
    'INVALID_API_RESPONSE',
    502,
    'The server returned an invalid response.',
  );
}

function entityStateMatchesRequestedFields(
  state: EntityStateRecord,
  body: CreateEntityStateInput | UpdateEntityStateInput,
): boolean {
  if (body.scene_id !== undefined && state.scene_id !== body.scene_id) return false;
  if (
    body.costume_note !== undefined
    && state.costume_note !== normalizeRequestedNullableText(body.costume_note)
  ) return false;
  if (
    body.condition_note !== undefined
    && state.condition_note !== normalizeRequestedNullableText(body.condition_note)
  ) return false;
  if (
    body.hair_note !== undefined
    && state.hair_note !== normalizeRequestedNullableText(body.hair_note)
  ) return false;
  if (
    body.expression_default !== undefined
    && state.expression_default !== body.expression_default.trim()
  ) return false;
  if (
    body.extra_note !== undefined
    && state.extra_note !== normalizeRequestedNullableText(body.extra_note)
  ) return false;
  return true;
}

function normalizeRequestedNullableText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function withOrganizationQuery(path: string, organizationId: string | null): string {
  if (organizationId === null) {
    return path;
  }
  const query = new URLSearchParams({ organization_id: organizationId });
  return `${path}?${query.toString()}`;
}
