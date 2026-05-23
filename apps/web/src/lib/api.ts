import type {
  BalloonRecord,
  BillingBalanceRecord,
  ChapterRecord,
  CompositionRecord,
  EntityRecord,
  EntityReferenceSetRecord,
  EpisodeRecord,
  GenerationJobRecord,
  PageRecord,
  PanelFrameRecord,
  PanelRecord,
  SceneRecord,
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

type JsonRequestInit = Omit<RequestInit, 'body'> & { body?: unknown };

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

export class LyraApiClient {
  private readonly tokenProvider: () => string | null;
  private readonly baseUrl: string;

  public constructor(tokenProvider: () => string | null) {
    this.tokenProvider = tokenProvider;
    const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
    this.baseUrl = typeof configuredBaseUrl === 'string' ? configuredBaseUrl : '';
  }

  public getWorks(): Promise<{ works: WorkRecord[] }> {
    return this.request('/api/works');
  }

  public createWork(body: Record<string, unknown>): Promise<WorkRecord> {
    return this.request('/api/works', { method: 'POST', body });
  }

  public updateWork(workId: string, body: Record<string, unknown>): Promise<WorkRecord> {
    return this.request(`/api/works/${workId}`, { method: 'PUT', body });
  }

  public getChapters(workId: string): Promise<{ chapters: ChapterRecord[] }> {
    return this.request(`/api/works/${workId}/chapters`);
  }

  public createChapter(workId: string, body: Record<string, unknown>): Promise<ChapterRecord> {
    return this.request(`/api/works/${workId}/chapters`, { method: 'POST', body });
  }

  public updateChapter(chapterId: string, body: Record<string, unknown>): Promise<ChapterRecord> {
    return this.request(`/api/chapters/${chapterId}`, { method: 'PUT', body });
  }

  public deleteChapter(chapterId: string): Promise<void> {
    return this.requestVoid(`/api/chapters/${chapterId}`, { method: 'DELETE' });
  }

  public getEpisodes(chapterId: string): Promise<{ episodes: EpisodeRecord[] }> {
    return this.request(`/api/chapters/${chapterId}/episodes`);
  }

  public createEpisode(chapterId: string, body: Record<string, unknown>): Promise<EpisodeRecord> {
    return this.request(`/api/chapters/${chapterId}/episodes`, { method: 'POST', body });
  }

  public updateEpisode(episodeId: string, body: Record<string, unknown>): Promise<EpisodeRecord> {
    return this.request(`/api/episodes/${episodeId}`, { method: 'PUT', body });
  }

  public deleteEpisode(episodeId: string): Promise<void> {
    return this.requestVoid(`/api/episodes/${episodeId}`, { method: 'DELETE' });
  }

  public generatePageSkeleton(episodeId: string): Promise<{ pages_created: number; panels_created: number }> {
    return this.request(`/api/episodes/${episodeId}/generate-page-skeleton`, { method: 'POST' });
  }

  public streamStoryCollaboration(input: StoryCollaborationInput, handlers: SseHandlers): Promise<void> {
    return this.stream('/api/story/collaborate', input, handlers);
  }

  public getEntities(workId: string): Promise<{ entities: EntityRecord[] }> {
    return this.request(`/api/works/${workId}/entities`);
  }

  public createEntity(workId: string, body: Record<string, unknown>): Promise<EntityRecord> {
    return this.request(`/api/works/${workId}/entities`, { method: 'POST', body });
  }

  public updateEntity(entityId: string, body: Record<string, unknown>): Promise<EntityRecord> {
    return this.request(`/api/entities/${entityId}`, { method: 'PUT', body });
  }

  public deleteEntity(entityId: string): Promise<void> {
    return this.requestVoid(`/api/entities/${entityId}`, { method: 'DELETE' });
  }

  public importEntityImage(body: Record<string, unknown>): Promise<{
    suggested_fields: Record<string, unknown>;
    prompt_supplement: string;
    tmp_image_s3_key: string;
    tmp_image_cdn_url: string;
  }> {
    return this.request('/api/entities/import-image', { method: 'POST', body });
  }

  public generateEntityReference(entityId: string, body?: Record<string, unknown>): Promise<{ job_id: string }> {
    return this.request(`/api/entities/${entityId}/generate-reference`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    });
  }

  public getEntityReferenceSet(entityId: string): Promise<EntityReferenceSetRecord> {
    return this.request(`/api/entities/${entityId}/reference-set`);
  }

  public confirmEntityReference(
    entityId: string,
    body: Record<string, unknown>,
  ): Promise<EntityReferenceSetRecord> {
    return this.request(`/api/entities/${entityId}/reference/confirm`, { method: 'POST', body });
  }

  public deleteEntityReference(entityId: string, refId: string): Promise<EntityReferenceSetRecord> {
    return this.request(`/api/entities/${entityId}/reference/${refId}`, { method: 'DELETE' });
  }

  public getScenes(episodeId: string): Promise<{ scenes: SceneRecord[] }> {
    return this.request(`/api/episodes/${episodeId}/scenes`);
  }

  public createScene(episodeId: string, body: Record<string, unknown>): Promise<SceneRecord> {
    return this.request(`/api/episodes/${episodeId}/scenes`, { method: 'POST', body });
  }

  public updateScene(sceneId: string, body: Record<string, unknown>): Promise<SceneRecord> {
    return this.request(`/api/scenes/${sceneId}`, { method: 'PUT', body });
  }

  public getPages(episodeId: string): Promise<{ pages: PageRecord[] }> {
    return this.request(`/api/episodes/${episodeId}/pages`);
  }

  public generatePage(pageId: string): Promise<{ job_id: string }> {
    return this.request(`/api/pages/${pageId}/generate`, { method: 'POST' });
  }

  public confirmPage(pageId: string): Promise<void> {
    return this.requestVoid(`/api/pages/${pageId}/confirm`, { method: 'POST' });
  }

  public reopenPage(pageId: string): Promise<void> {
    return this.requestVoid(`/api/pages/${pageId}/reopen`, { method: 'POST' });
  }

  public getPanels(pageId: string): Promise<{ panels: PanelRecord[] }> {
    return this.request(`/api/pages/${pageId}/panels`);
  }

  public createPanel(pageId: string, body: Record<string, unknown>): Promise<PanelRecord> {
    return this.request(`/api/pages/${pageId}/panels`, { method: 'POST', body });
  }

  public updatePanel(panelId: string, body: Record<string, unknown>): Promise<PanelRecord> {
    return this.request(`/api/panels/${panelId}`, { method: 'PUT', body });
  }

  public deletePanel(panelId: string): Promise<void> {
    return this.requestVoid(`/api/panels/${panelId}`, { method: 'DELETE' });
  }

  public replacePanelAssignments(panelId: string, body: Record<string, unknown>): Promise<{
    entities: PanelRecord['entities'];
  }> {
    return this.request(`/api/panels/${panelId}/entities`, { method: 'PUT', body });
  }

  public getFrames(pageId: string): Promise<{ frames: PanelFrameRecord[] }> {
    return this.request(`/api/pages/${pageId}/frames`);
  }

  public applyFrameTemplate(pageId: string, templateId: string): Promise<{
    template_id: string;
    panel_count: number;
    frames: PanelFrameRecord[];
  }> {
    return this.request(`/api/pages/${pageId}/frames/apply-template`, {
      method: 'POST',
      body: { template_id: templateId },
    });
  }

  public replaceFrames(pageId: string, body: Record<string, unknown>): Promise<{ frames: PanelFrameRecord[] }> {
    return this.request(`/api/pages/${pageId}/frames`, { method: 'PUT', body });
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

  public getJob(jobId: string): Promise<GenerationJobRecord> {
    return this.request(`/api/jobs/${jobId}`);
  }

  public getBalance(): Promise<BillingBalanceRecord> {
    return this.request('/api/billing/balance');
  }

  public createSubscriptionCheckout(planCode: 'standard' | 'premium'): Promise<{ session_id: string; url: string }> {
    return this.request('/api/billing/checkout/subscription', {
      method: 'POST',
      body: { plan_code: planCode },
    });
  }

  public createCreditCheckout(
    packageCode: 'credits_200' | 'credits_1000' | 'credits_3000',
  ): Promise<{ session_id: string; package_code: string; url: string }> {
    return this.request('/api/billing/checkout/credits', {
      method: 'POST',
      body: { package_code: packageCode },
    });
  }

  public createCustomerPortal(): Promise<{ url: string }> {
    return this.request('/api/billing/customer-portal', { method: 'POST' });
  }

  private async request<T>(path: string, init: JsonRequestInit = {}): Promise<T> {
    const response = await fetch(this.toUrl(path), this.buildRequest(init));
    if (!response.ok) {
      throw await this.toApiError(response);
    }

    return (await response.json()) as T;
  }

  private async requestVoid(path: string, init: JsonRequestInit = {}): Promise<void> {
    const response = await fetch(this.toUrl(path), this.buildRequest(init));
    if (!response.ok) {
      throw await this.toApiError(response);
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
