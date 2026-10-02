import { ConfigurationError } from '../domain/errors/index.js';
import { createPageImageStorageClient } from '../infrastructure/aws/S3PageImageStorage.js';
import { S3EpisodeExportArtifactStorage } from '../infrastructure/aws/S3EpisodeExportStorage.js';
import { createEpisodeExportQueueClient, SqsEpisodeExportQueue } from '../infrastructure/aws/SqsEpisodeExportQueue.js';
import { PostgresEpisodeExportJobRepository } from '../repositories/EpisodeExportJobRepository.js';
import { EpisodeExportDispatchService } from '../services/export/EpisodeExportDispatchService.js';
import { EpisodeExportCleanupService } from '../services/export/EpisodeExportCleanupService.js';
import type { DatabaseClient, TransactionRunner } from './db.js';
import { resolveEpisodeExportQueueConfig, type EpisodeExportQueueConfigInput } from './episodeExportRuntime.js';
import type { EpisodeExportMaintenanceRuntime } from './episodeExportMaintenance.js';
export function createEpisodeExportMaintenanceRuntime(config: EpisodeExportQueueConfigInput & { AWS_REGION?: string; S3_BUCKET_IMAGES?: string }, database: DatabaseClient & TransactionRunner): EpisodeExportMaintenanceRuntime | null {
  const queue = resolveEpisodeExportQueueConfig(config);
  if (queue === null) return null;
  if (config.S3_BUCKET_IMAGES === undefined) throw new ConfigurationError('Episode export requires configured artifact storage');
  const repository = new PostgresEpisodeExportJobRepository(database, database);
  return {
    dispatcher: new EpisodeExportDispatchService(repository, new SqsEpisodeExportQueue(createEpisodeExportQueueClient(config.AWS_REGION), queue.queueUrl, queue.shared ? 'deployed' : 'v1')),
    cleanup: new EpisodeExportCleanupService(repository, new S3EpisodeExportArtifactStorage(createPageImageStorageClient(config.AWS_REGION), { bucketName: config.S3_BUCKET_IMAGES }))
  };
}
