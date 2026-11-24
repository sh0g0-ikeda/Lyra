import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigurationError } from '../../domain/errors/index.js';
import { GPT_IMAGE_25_SUNBURST, resolveOpenAIImageRuntimeProvenance } from '../../domain/constants/openAIImageModel.js';
import type { Env } from '../../lib/env.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import type { RepositorySchemaProfile } from '../../repositories/RepositorySchemaProfile.js';
import { PostgresGenerationBatchConfirmationRepository } from '../../repositories/GenerationBatchConfirmationRepository.js';
import { PostgresGenerationQuotePlanResolver } from '../../repositories/GenerationQuotePlanResolver.js';
import { PostgresGenerationJobRepository } from '../../repositories/GenerationJobRepository.js';
import { PostgresEntityStateReferenceRepository } from '../../repositories/EntityStateReferenceRepository.js';
import { PostgresCreditRepository } from '../../repositories/CreditRepository.js';
import { PostgresOrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { GenerationBatchService } from '../../services/generation/batch/GenerationBatchService.js';
import { GenerationBatchConfirmationService } from '../../services/generation/batch/GenerationBatchConfirmationService.js';
import { GenerationQuoteDispatcher } from '../../services/generation/GenerationQuoteDispatcher.js';
import { EntityStateReferenceService } from '../../services/entity/EntityStateReferenceService.js';
import { SqsEntityGenerationQueueAdapter } from '../../services/entity/EntityGenerationQueue.js';
import { CreditService } from '../../services/credit/CreditService.js';
import { OrganizationService } from '../../services/organization/OrganizationService.js';
import { JobService } from '../../services/job/JobService.js';
import { S3EntityImageStorage } from '../aws/S3EntityImageStorage.js';
import { S3StoredImageLoader } from '../aws/S3StoredImageLoader.js';
import { createPageImageStorageClient } from '../aws/S3PageImageStorage.js';
import { SqsGenerationQueue } from '../aws/SqsGenerationQueue.js';
import { resolveGenerationWorkerWarmService } from '../aws/GenerationWorkerWarmRuntime.js';
import { createFencedStateReferenceRuntime } from '../state/FencedStateReferenceRuntime.js';

/** API and worker construct the same sequencer. Feature-off startup never
 * touches new tables or constructs storage clients, supporting pre-055 rollout. */
export function createGenerationBatchRuntime(
  environment: Env,
  database: DatabaseClient & TransactionRunner,
  persistenceProfile: RepositorySchemaProfile,
): GenerationBatchService | undefined {
  if (!environment.GENERATION_BATCHES_ENABLED) return undefined;
  if (!environment.GENERATION_JOB_CANCELLATION_ENABLED) {
    throw new ConfigurationError('Generation batches require generation job cancellation');
  }
  if (!environment.GENERATION_QUOTES_ENABLED || !environment.OPENAI_IMAGE_SUNBURST_ENABLED
    || environment.S3_BUCKET_IMAGES === undefined || environment.SQS_QUEUE_URL_GENERATION === undefined
    || environment.LOCAL_IMAGE_FALLBACK_ENABLED) {
    throw new ConfigurationError('Generation batches require GPT Image 2.5 quotes, durable queue and image storage');
  }
  const storageClient = createPageImageStorageClient(environment.AWS_REGION);
  const imageStorage = new S3EntityImageStorage(storageClient, {
    bucketName: environment.S3_BUCKET_IMAGES,
    cdnBaseUrl: environment.IMAGE_DELIVERY_MODE === 'cloudfront_signed' ? environment.IMAGES_CDN_BASE_URL : undefined,
  });
  const loader = new S3StoredImageLoader(storageClient, environment.S3_BUCKET_IMAGES);
  const warm = resolveGenerationWorkerWarmService();
  const queue = new SqsGenerationQueue(new SQSClient({ region: environment.AWS_REGION }),
    environment.SQS_QUEUE_URL_GENERATION, warm);
  const capacityLimits = { perUser: environment.GENERATION_USER_ACTIVE_JOB_LIMIT, global: environment.GENERATION_GLOBAL_ACTIVE_JOB_LIMIT };
  const generationJobRepository = new PostgresGenerationJobRepository(database, persistenceProfile);
  const provenance = resolveOpenAIImageRuntimeProvenance(environment.OPENAI_IMAGE_MODEL, environment.OPENAI_IMAGE_SUNBURST_ENABLED);
  const stateConfirmation = new EntityStateReferenceService({
    stateRepository: new PostgresEntityStateReferenceRepository(database),
    generationJobRepository,
    creditService: new CreditService(new PostgresCreditRepository(database, database)),
    organizationService: new OrganizationService(new PostgresOrganizationRepository(database, database)),
    imageStorage, storedImageLoader: loader, generationQueue: new SqsEntityGenerationQueueAdapter(queue),
    imageModel: provenance.imageModel, providerModelId: provenance.providerModelId,
    fencedConfirmationService: createFencedStateReferenceRuntime(environment, database),
    generationEnabled: environment.GENERATION_ENABLED && environment.ENTITY_GENERATION_ENABLED && environment.ENTITY_STATE_REFERENCE_GENERATION_ENABLED,
    capacityLimits,
  });
  return new GenerationBatchService({
    database, persistenceProfile, enabled: true, requiredImageModel: GPT_IMAGE_25_SUNBURST,
    wake: async (): Promise<void> => { await warm?.requestWarm(); },
    resolver: new PostgresGenerationQuotePlanResolver({
      persistenceProfile, imageModel: environment.OPENAI_IMAGE_MODEL, sunburstEnabled: true,
      generationEnabled: environment.GENERATION_ENABLED, pageGenerationEnabled: environment.PAGE_GENERATION_ENABLED,
      entityGenerationEnabled: environment.ENTITY_GENERATION_ENABLED, stateGenerationEnabled: environment.ENTITY_STATE_REFERENCE_GENERATION_ENABLED,
      importEnabled: false, candidateImageLoader: loader,
    }),
    confirmation: new GenerationBatchConfirmationService(new PostgresGenerationBatchConfirmationRepository(database), imageStorage, stateConfirmation),
    dispatcher: new GenerationQuoteDispatcher(database, queue, { batchCancellationFenceEnabled: true }), capacityLimits,
    jobCancellation: new JobService(generationJobRepository, undefined, undefined, undefined, undefined, true, true),
  });
}
