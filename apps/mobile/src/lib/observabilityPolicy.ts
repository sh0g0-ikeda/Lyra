export interface ObservabilityBuildMetadata {
  buildNumber: string;
  correlationId: string;
  release: string;
  updateId: string | null;
  version: string;
}

export type OperationalMetric =
  | {
      name: 'auth_failure';
      requestId: string | null;
      status: 401 | 403;
    }
  | {
      name: 'checkout_return_failure';
      intent: 'credits' | 'portal' | 'subscription';
      outcome: 'error' | 'unconfirmed';
      requestId: string | null;
    }
  | {
      name: 'job_failure';
      jobId: string;
      requestId: string | null;
    };

interface OperationalMetricEvent {
  level: 'warning';
  message: string;
  tags: Record<string, string>;
}

export type AiContentReportKind = 'generated_image' | 'story_proposal';
export type AiContentReportReason = 'unsafe_or_inappropriate';

export interface AiContentFeedback {
  message: string;
  source: string;
  tags: {
    content_kind: AiContentReportKind;
    content_id?: string;
    reason: AiContentReportReason;
  };
}

export interface CrashEventLike {
  breadcrumbs?: unknown;
  contexts?: Record<string, unknown>;
  event_id?: unknown;
  exception?: unknown;
  extra?: unknown;
  level?: unknown;
  platform?: unknown;
  request?: unknown;
  tags?: unknown;
  timestamp?: unknown;
  user?: unknown;
  [key: string]: unknown;
}

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const METADATA_VALUE_PATTERN = /^[A-Za-z0-9+._:@/-]{1,200}$/u;
const SAFE_CONTEXT_VALUE_PATTERN = /^[A-Za-z0-9+._ ():/-]{1,100}$/u;
const SAFE_CONTEXT_STRING_KEYS: Record<string, readonly string[]> = {
  app: ['app_identifier', 'app_name', 'app_build', 'app_version'],
  device: ['arch', 'brand', 'family', 'model'],
  os: ['name', 'version', 'build'],
  runtime: ['name', 'version']
};
const SAFE_CONTEXT_BOOLEAN_KEYS: Record<string, readonly string[]> = {
  device: ['simulator']
};
const SAFE_EVENT_LEVELS = new Set([
  'debug',
  'error',
  'fatal',
  'info',
  'warning'
]);
const SAFE_EVENT_PLATFORMS = new Set([
  'cocoa',
  'java',
  'javascript',
  'native',
  'node',
  'react-native'
]);
const AI_CONTENT_REPORT_KINDS = new Set<AiContentReportKind>([
  'generated_image',
  'story_proposal'
]);

const safeMetadataValue = (value: string): string | null =>
  METADATA_VALUE_PATTERN.test(value) ? value : null;

const safeOpaqueId = (value: string | null): string | null =>
  value !== null && OPAQUE_ID_PATTERN.test(value) ? value : null;

export const shouldEnableObservability = (input: {
  buildEnvironment: 'development' | 'preview' | 'production';
  configValid: boolean;
  sentryDsn: string;
}): boolean =>
  input.configValid &&
  input.buildEnvironment === 'production' &&
  input.sentryDsn.length > 0;

export const buildAiContentFeedback = (input: {
  contentKind: AiContentReportKind;
  contentId?: string | null;
  reason: AiContentReportReason;
}): AiContentFeedback => {
  if (!AI_CONTENT_REPORT_KINDS.has(input.contentKind)) {
    throw new Error('Unsupported AI content report category.');
  }
  const contentId = safeOpaqueId(input.contentId ?? null);
  return {
    message: 'AI-generated content was reported in Lyra Mobile.',
    source: 'lyra_mobile_ai_content_report',
    tags: {
      content_kind: input.contentKind,
      ...(contentId === null ? {} : { content_id: contentId }),
      reason: input.reason
    }
  };
};

const buildMetadataTags = (
  metadata: ObservabilityBuildMetadata
): Record<string, string> => {
  const candidates: Record<string, string | null> = {
    build_number: safeMetadataValue(metadata.buildNumber),
    correlation_id: safeOpaqueId(metadata.correlationId),
    release: safeMetadataValue(metadata.release),
    update_id:
      metadata.updateId === null ? null : safeOpaqueId(metadata.updateId),
    version: safeMetadataValue(metadata.version)
  };
  return Object.fromEntries(
    Object.entries(candidates).filter(
      (entry): entry is [string, string] => entry[1] !== null
    )
  );
};

export const buildOperationalMetric = (
  metric: OperationalMetric,
  metadata: ObservabilityBuildMetadata
): OperationalMetricEvent => {
  const tags: Record<string, string> = {
    ...buildMetadataTags(metadata),
    metric: metric.name
  };

  if (metric.name === 'auth_failure') {
    tags.status = String(metric.status);
  }
  if (metric.name === 'checkout_return_failure') {
    tags.intent = metric.intent;
    tags.outcome = metric.outcome;
  }

  const requestId = safeOpaqueId(metric.requestId);
  if (requestId !== null) {
    tags.request_id = requestId;
  }
  if (metric.name === 'job_failure') {
    const jobId = safeOpaqueId(metric.jobId);
    if (jobId !== null) {
      tags.job_id = jobId;
    }
  }

  return {
    level: 'warning',
    message: `lyra.mobile.${metric.name}`,
    tags
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeContexts = (
  contexts: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (contexts === undefined) {
    return undefined;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [contextName, allowedStringKeys] of Object.entries(
    SAFE_CONTEXT_STRING_KEYS
  )) {
    const context = contexts[contextName];
    if (!isRecord(context)) {
      continue;
    }
    const safeContext: Record<string, string | boolean> = {};
    allowedStringKeys.forEach((key) => {
      const value = context[key];
      if (
        typeof value === 'string' &&
        SAFE_CONTEXT_VALUE_PATTERN.test(value)
      ) {
        safeContext[key] = value;
      }
    });
    (SAFE_CONTEXT_BOOLEAN_KEYS[contextName] ?? []).forEach((key) => {
      const value = context[key];
      if (typeof value === 'boolean') {
        safeContext[key] = value;
      }
    });
    if (Object.keys(safeContext).length > 0) {
      sanitized[contextName] = safeContext;
    }
  }
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
};

const sanitizeStackFrame = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }
  const frame: Record<string, unknown> = {};
  if (typeof value.filename === 'string') {
    const filename = value.filename.split(/[\\/]/u).at(-1);
    if (filename !== undefined && filename.length > 0 && filename.length <= 200) {
      frame.filename = filename;
    }
  }
  if (
    typeof value.function === 'string' &&
    /^[A-Za-z0-9_.$<>-]{1,200}$/u.test(value.function)
  ) {
    frame.function = value.function;
  }
  (['colno', 'lineno'] as const).forEach((field) => {
    if (
      typeof value[field] === 'number' &&
      Number.isInteger(value[field]) &&
      value[field] >= 0
    ) {
      frame[field] = value[field];
    }
  });
  if (typeof value.in_app === 'boolean') {
    frame.in_app = value.in_app;
  }
  return Object.keys(frame).length === 0 ? null : frame;
};

const sanitizeException = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value) || !Array.isArray(value.values)) {
    return undefined;
  }
  const values = value.values.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }
    const sanitized: Record<string, unknown> = {};
    if (
      typeof candidate.type === 'string' &&
      /^[A-Za-z0-9_.$<>-]{1,200}$/u.test(candidate.type)
    ) {
      sanitized.type = candidate.type;
    }
    if (isRecord(candidate.stacktrace) && Array.isArray(candidate.stacktrace.frames)) {
      const frames = candidate.stacktrace.frames
        .map(sanitizeStackFrame)
        .filter((frame): frame is Record<string, unknown> => frame !== null);
      if (frames.length > 0) {
        sanitized.stacktrace = { frames };
      }
    }
    return Object.keys(sanitized).length === 0 ? [] : [sanitized];
  });
  return values.length === 0 ? undefined : { values };
};

export const sanitizeCrashEvent = (
  event: CrashEventLike,
  metadata: ObservabilityBuildMetadata
): CrashEventLike => {
  const sanitized: CrashEventLike = {
    tags: buildMetadataTags(metadata)
  };
  if (
    typeof event.event_id === 'string' &&
    /^[0-9a-f]{32}$/u.test(event.event_id)
  ) {
    sanitized.event_id = event.event_id;
  }
  if (typeof event.level === 'string' && SAFE_EVENT_LEVELS.has(event.level)) {
    sanitized.level = event.level;
  }
  if (
    typeof event.platform === 'string' &&
    SAFE_EVENT_PLATFORMS.has(event.platform)
  ) {
    sanitized.platform = event.platform;
  }
  if (
    typeof event.timestamp === 'number' &&
    Number.isFinite(event.timestamp) &&
    event.timestamp >= 0
  ) {
    sanitized.timestamp = event.timestamp;
  }
  const contexts = sanitizeContexts(event.contexts);
  if (contexts !== undefined) {
    sanitized.contexts = contexts;
  }
  const exception = sanitizeException(event.exception);
  if (exception !== undefined) {
    sanitized.exception = exception;
  }
  return sanitized;
};
