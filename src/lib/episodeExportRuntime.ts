import type { Env } from './env.js';

export type EpisodeExportRuntimeConfig = Pick<
  Env,
  'EPISODE_EXPORT_ENABLED' | 'S3_BUCKET_IMAGES' | 'SQS_QUEUE_URL_GENERATION'
>;

export type EnabledEpisodeExportRuntimeConfig = EpisodeExportRuntimeConfig & {
  EPISODE_EXPORT_ENABLED: true;
  S3_BUCKET_IMAGES: string;
  SQS_QUEUE_URL_GENERATION: string;
};

/**
 * Returns whether the legacy in-process episode-export runtime is safe to
 * compose.  The feature is intentionally fail-closed until its schema is
 * separately verified and enabled.
 */
export function isEpisodeExportRuntimeEnabled(
  config: EpisodeExportRuntimeConfig,
): config is EnabledEpisodeExportRuntimeConfig {
  return (
    config.EPISODE_EXPORT_ENABLED &&
    config.S3_BUCKET_IMAGES !== undefined &&
    config.SQS_QUEUE_URL_GENERATION !== undefined
  );
}

export function runEpisodeExportRuntimeWhenEnabled(
  config: EpisodeExportRuntimeConfig,
  startRuntime: (enabledConfig: EnabledEpisodeExportRuntimeConfig) => void,
): void {
  if (!isEpisodeExportRuntimeEnabled(config)) {
    return;
  }

  startRuntime(config);
}
