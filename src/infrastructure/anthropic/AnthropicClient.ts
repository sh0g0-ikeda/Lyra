import { ConfigurationError } from '../../domain/errors/index.js';
import { sanitizeExternalErrorMessage } from '../../lib/errorSanitizer.js';

export interface AnthropicClientOptions {
  apiKey: string;
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
  maxRetries?: number;
}

export interface AnthropicMessageTextResponse {
  text: string;
  requestId: string | null;
}

interface AnthropicMessageResponse {
  content?: Array<{
    type?: unknown;
    text?: unknown;
  }>;
}

interface SseEvent {
  event: string | null;
  data: string;
}

export class AnthropicClient {
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;

  public constructor(private readonly options: AnthropicClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
  }

  public async createMessageText(body: Record<string, unknown>): Promise<AnthropicMessageTextResponse> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

      try {
        const response = await this.fetchFn(buildUrl(this.options.baseUrl, '/v1/messages'), {
          method: 'POST',
          headers: buildHeaders(this.options),
          body: JSON.stringify(body),
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

        const payload = (await response.json()) as AnthropicMessageResponse;
        return {
          text: extractMessageText(payload),
          requestId: response.headers.get('request-id'),
        };
      } catch (error) {
        if (attempt < this.maxRetries && isRetryableError(error)) {
          await sleep(attempt);
          continue;
        }

        throw normalizeError(error);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new ConfigurationError('Anthropic request failed');
  }

  public async *streamMessageText(body: Record<string, unknown>): AsyncGenerator<string, void, void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

      try {
        const response = await this.fetchFn(buildUrl(this.options.baseUrl, '/v1/messages'), {
          method: 'POST',
          headers: buildHeaders(this.options),
          body: JSON.stringify({ ...body, stream: true }),
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

        if (response.body === null) {
          throw new ConfigurationError('Anthropic streaming response body is empty');
        }

        for await (const chunk of parseSseStream(response.body)) {
          const payload = parseSsePayload(chunk);
          if (payload === null) {
            continue;
          }

          if (payload.type === 'error' && isErrorPayload(payload.error)) {
            throw new ConfigurationError(sanitizeExternalErrorMessage(payload.error.message));
          }

          if (
            payload.type === 'content_block_delta' &&
            isTextDelta(payload.delta) &&
            payload.delta.text.length > 0
          ) {
            yield payload.delta.text;
          }
        }

        return;
      } catch (error) {
        if (attempt < this.maxRetries && isRetryableError(error)) {
          await sleep(attempt);
          continue;
        }

        throw normalizeError(error);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new ConfigurationError('Anthropic streaming request failed');
  }
}

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/gu, '\n');

      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsed = parseSseEvent(rawEvent);
        if (parsed !== null) {
          yield parsed;
        }
        separatorIndex = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode().replace(/\r\n/gu, '\n');
    const finalEvent = parseSseEvent(buffer);
    if (finalEvent !== null) {
      yield finalEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseEvent(rawEvent: string): SseEvent | null {
  const trimmed = rawEvent.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let event: string | null = null;
  const dataParts: string[] = [];

  for (const line of trimmed.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataParts.push(line.slice('data:'.length).trim());
    }
  }

  if (dataParts.length === 0) {
    return null;
  }

  return {
    event,
    data: dataParts.join('\n'),
  };
}

function parseSsePayload(event: SseEvent): Record<string, unknown> | null {
  if (event.data.length === 0) {
    return null;
  }

  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    throw new ConfigurationError('Anthropic streaming payload was not valid JSON');
  }
}

function extractMessageText(payload: AnthropicMessageResponse): string {
  const textParts = (payload.content ?? [])
    .filter((block): block is { type: string; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0);

  if (textParts.length === 0) {
    throw new ConfigurationError('Anthropic response did not include text content');
  }

  return textParts.join('\n').trim();
}

function buildHeaders(options: AnthropicClientOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': options.apiKey,
    'anthropic-version': options.apiVersion,
  };
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//u, ''), `${baseUrl.replace(/\/+$/u, '')}/`).toString();
}

async function buildErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = `Anthropic request failed with status ${response.status}`;

  try {
    const payload = (await response.json()) as {
      error?: {
        message?: unknown;
      };
    };
    if (typeof payload.error?.message === 'string' && payload.error.message.length > 0) {
      return sanitizeExternalErrorMessage(payload.error.message);
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
  return !(error instanceof ConfigurationError) && error instanceof Error;
}

function normalizeError(error: unknown): ConfigurationError {
  if (error instanceof ConfigurationError) {
    return error;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new ConfigurationError('Anthropic request timed out');
  }

  return new ConfigurationError(
    sanitizeExternalErrorMessage(error instanceof Error ? error.message : 'Anthropic request failed'),
  );
}

function isTextDelta(value: unknown): value is { type: 'text_delta'; text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text_delta' &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

function isErrorPayload(value: unknown): value is { message: string } {
  return typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string';
}

async function sleep(attempt: number): Promise<void> {
  const delayMs = 250 * 2 ** (attempt - 1);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
