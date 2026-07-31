import type { ZodType } from 'zod';
import {
  chapterSchema,
  chaptersResponseSchema,
  currentSessionSchema,
  episodeSchema,
  episodesResponseSchema,
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

export interface ListWorksPageInput {
  limit: number;
  cursor?: string | null;
}

export interface CreateStoryItemInput {
  order: number;
  title: string;
}

export interface MobileAuthSessionPort {
  getTokens(): Promise<AuthTokens | null>;
  refreshTokens(): Promise<AuthTokens>;
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

export class LyraMobileApiClient {
  private readonly apiBaseUrl: string;
  private readonly auth: MobileAuthSessionPort;
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;

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
    options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
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

  private async request(
    path: string,
    idToken: string,
    options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
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

function withOrganizationQuery(path: string, organizationId: string | null): string {
  if (organizationId === null) {
    return path;
  }
  const query = new URLSearchParams({ organization_id: organizationId });
  return `${path}?${query.toString()}`;
}
