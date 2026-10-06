import { ConfigurationError } from '../domain/errors/index.js';
export interface EpisodeExportQueueConfigInput { EPISODE_EXPORT_ENABLED?: boolean; SQS_QUEUE_URL_EXPORT?: string; SQS_QUEUE_URL_GENERATION?: string; }
export interface EpisodeExportQueueConfig { queueUrl: string; shared: boolean; }
export function resolveEpisodeExportQueueConfig(config: EpisodeExportQueueConfigInput): EpisodeExportQueueConfig | null {
  if (config.EPISODE_EXPORT_ENABLED !== true) return null;
  const queueUrl = config.SQS_QUEUE_URL_EXPORT ?? config.SQS_QUEUE_URL_GENERATION;
  if (queueUrl === undefined || queueUrl.trim() === '') throw new ConfigurationError('Episode export requires a configured export or generation queue');
  return { queueUrl, shared: queueUrl === config.SQS_QUEUE_URL_GENERATION };
}
