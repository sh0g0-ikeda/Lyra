import { ConfigurationError } from '../../domain/errors/index.js';
import { sanitizeExternalErrorMessage } from '../../lib/errorSanitizer.js';

export interface OpenAIClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
  maxRetries?: number;
}

export interface OpenAIResponse<TBody> {
  body: TBody;
  requestId: string | null;
}

export class OpenAIClient {
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;

  public constructor(private readonly options: OpenAIClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
  }

  public async postJson<TBody>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<OpenAIResponse<TBody>> {
    return this.request<TBody>(path, () => ({
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }));
  }

  public async postFormData<TBody>(
    path: string,
    buildFormData: () => FormData,
  ): Promise<OpenAIResponse<TBody>> {
    return this.request<TBody>(path, () => ({
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: buildFormData(),
    }));
  }

  private async request<TBody>(
    path: string,
    buildRequest: () => {
      headers: NonNullable<RequestInit['headers']>;
      body: NonNullable<RequestInit['body']>;
    },
  ): Promise<OpenAIResponse<TBody>> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

      try {
        const request = buildRequest();
        const response = await this.fetchFn(buildUrl(this.options.baseUrl, path), {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorMessage = await buildErrorMessage(response);
          if (attempt < this.maxRetries && isRetryableStatus(response.status)) {
            await sleep(attempt);
            continue;
          }

          throw new ConfigurationError(errorMessage);
        }

        const parsedBody = (await response.json()) as TBody;
        return {
          body: parsedBody,
          requestId: response.headers.get('x-request-id'),
        };
      } catch (error) {
        if (attempt < this.maxRetries && isRetryableError(error)) {
          await sleep(attempt);
          continue;
        }

        if (error instanceof ConfigurationError) {
          throw error;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          throw new ConfigurationError('OpenAI request timed out');
        }

        throw new ConfigurationError(
          sanitizeExternalErrorMessage(error instanceof Error ? error.message : 'OpenAI request failed'),
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new ConfigurationError('OpenAI request failed');
  }
}

async function sleep(attempt: number): Promise<void> {
  const delayMs = 250 * 2 ** (attempt - 1);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//u, ''), `${baseUrl.replace(/\/+$/u, '')}/`).toString();
}

async function buildErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = `OpenAI request failed with status ${response.status}`;

  try {
    const payload = (await response.json()) as { error?: { message?: unknown } };
    const message = payload.error?.message;
    if (typeof message === 'string' && message.length > 0) {
      return sanitizeExternalErrorMessage(message);
    }
  } catch {
    return fallbackMessage;
  }

  return sanitizeExternalErrorMessage(fallbackMessage);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ConfigurationError) {
    return false;
  }

  return error instanceof Error;
}
