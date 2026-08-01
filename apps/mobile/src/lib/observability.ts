import type { ComponentType } from 'react';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import * as Sentry from '@sentry/react-native';

import { config, configValidation } from '@/lib/config';
import {
  buildOperationalMetric,
  buildAiContentFeedback,
  sanitizeCrashEvent,
  shouldEnableObservability,
  type AiContentReportKind,
  type CrashEventLike,
  type ObservabilityBuildMetadata,
  type OperationalMetric
} from '@/lib/observabilityPolicy';
import { setOperationalEventSinks } from '@/lib/operationalEvents';

let initialized = false;
let enabled = false;

const createCorrelationId = (): string =>
  `MOB-SESSION-${Crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;

const buildMetadata = (): ObservabilityBuildMetadata => {
  const version =
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    'unknown';
  const buildNumber = Application.nativeBuildVersion ?? 'unknown';
  const applicationId = Application.applicationId ?? 'com.lyra.mobile';
  return {
    buildNumber,
    correlationId: createCorrelationId(),
    release: `${applicationId}@${version}+${buildNumber}`,
    updateId: Updates.updateId,
    version
  };
};

const metadata = buildMetadata();

const captureMetric = (metric: OperationalMetric): void => {
  const event = buildOperationalMetric(metric, metadata);
  Sentry.withScope((scope) => {
    Object.entries(event.tags).forEach(([key, value]) => {
      scope.setTag(key, value);
    });
    Sentry.captureMessage(event.message, event.level);
  });
};

export const initializeObservability = (): void => {
  if (initialized) {
    return;
  }
  initialized = true;
  enabled = shouldEnableObservability({
    buildEnvironment: config.buildEnvironment,
    configValid: configValidation.valid,
    sentryDsn: config.sentryDsn
  });
  if (!enabled) {
    return;
  }

  Sentry.init({
    attachScreenshot: false,
    attachStacktrace: true,
    attachViewHierarchy: false,
    beforeBreadcrumb: () => null,
    beforeSend: (event) =>
      sanitizeCrashEvent(
        event as unknown as CrashEventLike,
        metadata
      ) as unknown as typeof event,
    dist: metadata.buildNumber,
    dsn: config.sentryDsn,
    enableAutoPerformanceTracing: false,
    enabled: true,
    environment: 'production',
    maxBreadcrumbs: 0,
    release: metadata.release,
    sendDefaultPii: false,
    tracesSampleRate: 0
  });
  setOperationalEventSinks({
    exception: (error) => {
      Sentry.captureException(error);
    },
    metric: captureMetric
  });
};

export const withObservability = (
  component: ComponentType
): ComponentType =>
  enabled
    ? (Sentry.wrap(
        component as unknown as ComponentType<Record<string, unknown>>
      ) as unknown as ComponentType)
    : component;

export const submitAiContentReport = async (
  contentKind: AiContentReportKind,
  contentId?: string | null
): Promise<void> => {
  if (!enabled) {
    throw new Error('AI content reporting is unavailable.');
  }
  Sentry.captureFeedback(
    buildAiContentFeedback({
      contentKind,
      contentId,
      reason: 'unsafe_or_inappropriate'
    })
  );
  const flushed = await Sentry.flush();
  if (!flushed) {
    throw new Error('AI content report could not be delivered.');
  }
};
