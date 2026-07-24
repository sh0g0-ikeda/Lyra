import { z, type ZodType } from 'zod';
import { ConfigurationError } from '../../domain/errors/index.js';
import { OpenAIClient } from './OpenAIClient.js';

export interface OpenAICompilerResponse {
  output_text?: unknown;
  output?: unknown;
  status?: unknown;
  incomplete_details?: unknown;
}

export type StructuredOpenAIResponseFailureReason =
  | 'incomplete_max_output_tokens'
  | 'incomplete_other'
  | 'refusal'
  | 'unsuccessful_status'
  | 'no_output'
  | 'invalid_json'
  | 'invalid_payload';

export class StructuredOpenAIResponseError extends ConfigurationError {
  public constructor(
    message: string,
    public readonly reason: StructuredOpenAIResponseFailureReason,
    public readonly retryable: boolean,
    public readonly requestId: string | null,
  ) {
    super(message);
  }
}

export type OpenAIInputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };

export interface StructuredOpenAIRequest<T> {
  client: OpenAIClient;
  model: string;
  maxOutputTokens: number;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  responseSchema: ZodType<T>;
  errorLabel: string;
  input: Array<{
    role: 'system' | 'user' | 'assistant';
    content: OpenAIInputContent[];
  }>;
  sanitize?: (value: unknown) => unknown;
}

export async function requestStructuredOpenAIResponse<T>(
  options: StructuredOpenAIRequest<T>,
): Promise<T> {
  const response = await options.client.postJson<OpenAICompilerResponse>('/responses', {
    model: options.model,
    max_output_tokens: options.maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: options.schemaName,
        strict: true,
        schema: options.jsonSchema,
      },
    },
    input: options.input,
  });

  const responseStateFailure = inspectStructuredResponseState(
    response.body,
    options.errorLabel,
    response.requestId,
  );
  if (responseStateFailure !== null) {
    throw responseStateFailure;
  }

  const outputText = extractOpenAIOutputText(response.body);
  if (outputText === null) {
    throw new StructuredOpenAIResponseError(
      `${options.errorLabel} returned no text output`,
      'no_output',
      true,
      response.requestId,
    );
  }

  const normalized = normalizeCompiledJson(outputText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new StructuredOpenAIResponseError(
      `${options.errorLabel} returned invalid JSON`,
      'invalid_json',
      true,
      response.requestId,
    );
  }

  const sanitized = options.sanitize === undefined ? parsed : options.sanitize(parsed);
  const validated = options.responseSchema.safeParse(sanitized);
  if (!validated.success) {
    throw new StructuredOpenAIResponseError(
      `${options.errorLabel} returned an invalid payload: ${z.prettifyError(validated.error)}`,
      'invalid_payload',
      true,
      response.requestId,
    );
  }

  return validated.data;
}

function inspectStructuredResponseState(
  response: OpenAICompilerResponse,
  errorLabel: string,
  requestId: string | null,
): StructuredOpenAIResponseError | null {
  if (containsRefusal(response.output)) {
    return new StructuredOpenAIResponseError(
      `${errorLabel} refused structured output`,
      'refusal',
      false,
      requestId,
    );
  }

  if (response.status === 'incomplete') {
    const reason = readIncompleteReason(response.incomplete_details);
    if (reason === 'max_output_tokens') {
      return new StructuredOpenAIResponseError(
        `${errorLabel} reached its structured output limit`,
        'incomplete_max_output_tokens',
        true,
        requestId,
      );
    }

    return new StructuredOpenAIResponseError(
      `${errorLabel} returned incomplete structured output`,
      'incomplete_other',
      false,
      requestId,
    );
  }

  if (typeof response.status === 'string' && response.status !== 'completed') {
    return new StructuredOpenAIResponseError(
      `${errorLabel} did not complete structured output`,
      'unsuccessful_status',
      false,
      requestId,
    );
  }

  return null;
}

function containsRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) {
    return false;
  }

  return output.some((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      return false;
    }

    return item.content.some(
      (content) => isRecord(content) && content.type === 'refusal',
    );
  });
}

function readIncompleteReason(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value.reason === 'string' ? value.reason : null;
}

export async function requestOpenAIText(
  client: OpenAIClient,
  options: {
    model: string;
    maxOutputTokens: number;
    input: Array<{
      role: 'system' | 'user' | 'assistant';
      content: OpenAIInputContent[];
    }>;
    errorLabel: string;
  },
): Promise<string> {
  const response = await client.postJson<OpenAICompilerResponse>('/responses', {
    model: options.model,
    max_output_tokens: options.maxOutputTokens,
    input: options.input,
  });

  const outputText = extractOpenAIOutputText(response.body);
  if (outputText === null) {
    throw new ConfigurationError(`${options.errorLabel} returned no text output`);
  }

  return outputText;
}

export function extractOpenAIOutputText(response: OpenAICompilerResponse): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return null;
  }

  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }

      const text = content.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

export function normalizeCompiledJson(value: string): string {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '').trim();
  const extracted = extractFirstJsonObject(trimmed);
  return extracted ?? trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}
