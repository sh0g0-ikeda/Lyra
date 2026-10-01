import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import type { Env } from '../../lib/env.js';
import {
  PostgresFencedStateReferenceRepository, type FencedStateReferenceRepository,
} from '../../repositories/FencedStateReferenceRepository.js';
import {
  FencedStateReferenceConfirmationService, type FencedStateReferenceConfirmationPort,
  type PersonalStateReferenceFencingPort,
} from '../../services/entity/FencedStateReferenceConfirmationService.js';
import {
  FencedStateReferenceStorage, type FencedStateReferenceImageCreatePort,
  type FencedStateReferenceRecoveryPort, type FencedStorageClient,
} from '../aws/FencedStateReferenceStorage.js';

export interface FencedStateReferenceConfig {
  admissionEnabled: boolean;
  storageContractAttested: true;
  bucketName: string;
  region: string;
  imageRoleArn: string;
  recoveryRoleArn: string;
  expectedBucketOwner: string;
  versioning: 'never-versioned' | 'versioned' | 'suspended';
}
export interface FencedStateReferenceStoragePorts {
  imageCreator: FencedStateReferenceImageCreatePort;
  recovery: FencedStateReferenceRecoveryPort;
}
export type FencedStateReferenceRuntime = FencedStateReferenceConfirmationPort & PersonalStateReferenceFencingPort;
export interface FencedStateReferenceRuntimeOverrides {
  repository?: FencedStateReferenceRepository;
  /** Trusted process-local DI only. Never populated from HTTP request data. */
  storage?: FencedStateReferenceStoragePorts;
  storageFactory?: (config: FencedStateReferenceConfig) => FencedStateReferenceStoragePorts;
}
export interface FencedStateReferenceClientFactories {
  temporaryCredentials: typeof fromTemporaryCredentials;
  createClient: (config: S3ClientConfig) => FencedStorageClient;
}

/** Spec §5–6: admission and recovery have independent lifetimes. Startup validates
 * complete operator attestations before creating lazy SDK clients. Attestations
 * are NOT evidence of IAM enforcement, bucket settings, retention approval or
 * erasure acceptance. No settings, policies or persistent credentials are made.
 */
export function resolveFencedStateReferenceConfig(environment: Env): FencedStateReferenceConfig | null {
  const admissionEnabled = environment.STATE_REFERENCE_COPY_V2_ADMISSION_ENABLED;
  const attested = environment.STATE_REFERENCE_COPY_V2_STORAGE_CONTRACT_ATTESTED;
  const imageRoleArn = environment.STATE_REFERENCE_COPY_V2_IMAGE_ROLE_ARN;
  const recoveryRoleArn = environment.STATE_REFERENCE_COPY_V2_RECOVERY_ROLE_ARN;
  const expectedBucketOwner = environment.STATE_REFERENCE_COPY_V2_EXPECTED_BUCKET_OWNER;
  const versioning = environment.STATE_REFERENCE_COPY_V2_VERSIONING_HISTORY;
  const configured = attested || imageRoleArn !== undefined || recoveryRoleArn !== undefined
    || expectedBucketOwner !== undefined || versioning !== undefined;
  if (!admissionEnabled && !configured) return null;
  const region = environment.AWS_REGION;
  const bucketName = environment.S3_BUCKET_IMAGES;
  if (!attested || imageRoleArn === undefined || recoveryRoleArn === undefined
    || expectedBucketOwner === undefined || versioning === undefined || region === undefined || bucketName === undefined) throw invalidConfig();
  const config: FencedStateReferenceConfig = { admissionEnabled, storageContractAttested: true,
    bucketName, region, imageRoleArn, recoveryRoleArn, expectedBucketOwner, versioning };
  assertConfig(config);
  return config;
}

export function createConfiguredFencedStateReferenceStorage(
  config: FencedStateReferenceConfig,
  factories: FencedStateReferenceClientFactories = {
    temporaryCredentials: fromTemporaryCredentials,
    createClient: (options) => new S3Client(options),
  },
): FencedStateReferenceStoragePorts {
  assertConfig(config);
  const clientConfig = { region: config.region, maxAttempts: 1,
    requestHandler: { requestTimeout: 15_000, connectionTimeout: 3_000, socketTimeout: 15_000, throwOnRequestTimeout: true } };
  // Providers only resolve temporary credentials when an authorized operation
  // sends. Constructing the runtime does not call STS, S3 or the source provider.
  const imageCredentials = factories.temporaryCredentials({
    params: { RoleArn: config.imageRoleArn, RoleSessionName: 'lyra-state-reference-image' }, clientConfig,
  });
  const recoveryCredentials = factories.temporaryCredentials({
    params: { RoleArn: config.recoveryRoleArn, RoleSessionName: 'lyra-state-reference-recovery' }, clientConfig,
  });
  const storage = new FencedStateReferenceStorage({
    sourceReader: factories.createClient(clientConfig),
    imageCreator: factories.createClient({ ...clientConfig, credentials: imageCredentials }),
    recovery: factories.createClient({ ...clientConfig, credentials: recoveryCredentials }),
  }, {
    bucketName: config.bucketName, expectedBucketOwner: config.expectedBucketOwner,
    environmentAssumptions: { versioning: config.versioning,
      exclusiveConditionalImageWriters: true, ordinaryMarkersRetained: true, noUnmanagedReplicationOrRestore: true },
  });
  return { imageCreator: storage, recovery: storage };
}

/** Always install the journal coordinator, even with no storage configuration.
 * Existing v2 attempts then fail closed; they cannot silently choose v1. */
export function createFencedStateReferenceRuntime(
  environment: Env,
  database: DatabaseClient & TransactionRunner,
  overrides: FencedStateReferenceRuntimeOverrides = {},
): FencedStateReferenceRuntime {
  const config = resolveFencedStateReferenceConfig(environment);
  const storage = overrides.storage ?? (config === null ? undefined
    : (overrides.storageFactory ?? createConfiguredFencedStateReferenceStorage)(config));
  return new FencedStateReferenceConfirmationService({
    repository: overrides.repository ?? new PostgresFencedStateReferenceRepository(database),
    admissionEnabled: config?.admissionEnabled ?? false,
    imageCreator: storage?.imageCreator, recovery: storage?.recovery,
  });
}

function validRoleArn(value: string): boolean {
  return /^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]{1,512}$/u.test(value);
}

function assertConfig(config: FencedStateReferenceConfig): void {
  if (config.storageContractAttested !== true || !validRoleArn(config.imageRoleArn) || !validRoleArn(config.recoveryRoleArn)
    || config.imageRoleArn.toLowerCase() === config.recoveryRoleArn.toLowerCase()
    || !/^\d{12}$/u.test(config.expectedBucketOwner)
    || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/u.test(config.region)
    || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(config.bucketName)
    || config.bucketName.includes('..') || /^\d+\.\d+\.\d+\.\d+$/u.test(config.bucketName)
    || !['never-versioned', 'versioned', 'suspended'].includes(config.versioning)) throw invalidConfig();
}

function invalidConfig(): ConfigurationError {
  return new ConfigurationError('State reference v2 requires complete storage contract attestations and distinct role configuration');
}
