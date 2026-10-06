export type ReleaseProfile = 'backend-only' | 'new-mobile';

export interface ReleaseCompatibilityRuntime {
  generationQuotesEnabled: boolean;
  generationEnabled: boolean;
  pageGenerationEnabled: boolean;
  entityGenerationEnabled: boolean;
  entityImportAnalysisEnabled: boolean;
  entityReferenceDirectUploadEnabled: boolean;
  openAiApiKeyConfigured: boolean;
  openAiImageModel: string;
  generationQueueConfigured: boolean;
  imageStorageConfigured: boolean;
  awsRegionConfigured: boolean;
  localImageFallbackEnabled: boolean;
  webImageDeliveryClientIds: readonly string[];
  stateReferenceCopyV2AdmissionEnabled: boolean;
  stateReferenceCopyV2StorageContractAttested: boolean;
  stateReferenceCopyV2ImageRoleArn?: string;
  stateReferenceCopyV2RecoveryRoleArn?: string;
  stateReferenceCopyV2ExpectedBucketOwner?: string;
  stateReferenceCopyV2VersioningHistory?: 'never-versioned' | 'versioned' | 'suspended';
  stateReferenceCopyV2BucketName?: string;
  stateReferenceCopyV2Region?: string;
}

export interface ReleaseCompatibilityPolicyInput {
  profile: ReleaseProfile;
  journalPresent: boolean;
  mobileClientIds: readonly string[];
  runtime: ReleaseCompatibilityRuntime;
}

export type ReleaseCompatibilityViolationCategory = 'generation' | 'state_recovery' | 'web_delivery';

export interface ReleaseCompatibilityPolicyViolation {
  category: ReleaseCompatibilityViolationCategory;
  code: string;
}

export interface ReleaseCompatibilityPolicyReport {
  ok: boolean;
  checkedCount: number;
  violations: ReleaseCompatibilityPolicyViolation[];
}

const IMAGE_ROLE_ARN = /^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]{1,512}$/u;
const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/u;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;

/** Declared release compatibility only; remote IAM, storage and providers remain unverified. */
export function evaluateReleaseCompatibility(input: ReleaseCompatibilityPolicyInput): ReleaseCompatibilityPolicyReport {
  const violations: ReleaseCompatibilityPolicyViolation[] = [];
  let checkedCount = 0;
  const check = (condition: boolean, category: ReleaseCompatibilityViolationCategory, code: string): void => {
    checkedCount += 1;
    if (!condition) violations.push({ category, code });
  };

  if (input.profile === 'new-mobile') {
    check(input.runtime.generationQuotesEnabled, 'generation', 'MOBILE_QUOTES_REQUIRED');
    check(input.runtime.generationEnabled, 'generation', 'MOBILE_GENERATION_REQUIRED');
    check(input.runtime.pageGenerationEnabled, 'generation', 'MOBILE_PAGE_GENERATION_REQUIRED');
    check(input.runtime.entityGenerationEnabled, 'generation', 'MOBILE_ENTITY_GENERATION_REQUIRED');
    check(input.runtime.entityImportAnalysisEnabled, 'generation', 'MOBILE_ENTITY_IMPORT_REQUIRED');
    check(input.runtime.entityReferenceDirectUploadEnabled, 'generation', 'MOBILE_ENTITY_UPLOAD_REQUIRED');
    check(input.runtime.openAiApiKeyConfigured, 'generation', 'MOBILE_PROVIDER_REQUIRED');
    check(input.runtime.openAiImageModel === 'gpt-image-2', 'generation', 'MOBILE_IMAGE_MODEL_UNSUPPORTED');
    check(input.runtime.generationQueueConfigured, 'generation', 'MOBILE_DURABLE_QUEUE_REQUIRED');
    check(input.runtime.imageStorageConfigured, 'generation', 'MOBILE_IMAGE_STORAGE_REQUIRED');
    check(input.runtime.awsRegionConfigured, 'generation', 'MOBILE_AWS_REGION_REQUIRED');
    check(!input.runtime.localImageFallbackEnabled, 'generation', 'MOBILE_LOCAL_IMAGE_FALLBACK_FORBIDDEN');
  }

  const webClientIds = normalizedIds(input.runtime.webImageDeliveryClientIds);
  const mobileClientIds = normalizedIds(input.mobileClientIds);
  if (webClientIds.length > 0) {
    check(mobileClientIds.length > 0, 'web_delivery', 'WEB_MOBILE_CLIENT_INVENTORY_REQUIRED');
    if (mobileClientIds.length > 0) {
      const mobileSet = new Set(mobileClientIds);
      check(!webClientIds.some((clientId) => mobileSet.has(clientId)), 'web_delivery', 'WEB_IMAGE_CLIENT_SHARED_WITH_MOBILE');
    }
  }

  const state = stateRecoveryConfiguration(input.runtime);
  checkedCount += 1;
  if (state.kind === 'partial') {
    violations.push({ category: 'state_recovery', code: 'STATE_RECOVERY_CONFIG_INCOMPLETE' });
  } else if ((input.journalPresent || input.runtime.stateReferenceCopyV2AdmissionEnabled) && state.kind === 'none') {
    violations.push({ category: 'state_recovery', code: 'STATE_RECOVERY_CONFIG_REQUIRED' });
  } else if (state.kind === 'configured') {
    if (!state.validShape) violations.push({ category: 'state_recovery', code: 'STATE_RECOVERY_CONFIG_INVALID' });
    if (state.sameRole) violations.push({ category: 'state_recovery', code: 'STATE_RECOVERY_ROLES_MUST_BE_DISTINCT' });
  }

  return { ok: violations.length === 0, checkedCount, violations };
}

function normalizedIds(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

type StateRecoveryConfiguration =
  | { kind: 'none' }
  | { kind: 'partial' }
  | { kind: 'configured'; validShape: boolean; sameRole: boolean };

function stateRecoveryConfiguration(runtime: ReleaseCompatibilityRuntime): StateRecoveryConfiguration {
  const values = [
    runtime.stateReferenceCopyV2ImageRoleArn,
    runtime.stateReferenceCopyV2RecoveryRoleArn,
    runtime.stateReferenceCopyV2ExpectedBucketOwner,
    runtime.stateReferenceCopyV2VersioningHistory,
    runtime.stateReferenceCopyV2BucketName,
    runtime.stateReferenceCopyV2Region,
  ];
  // Shared AWS region/bucket settings alone do not opt into the v2 storage
  // contract. This matches the runtime resolver's independent admission gate.
  const anyDeclared = runtime.stateReferenceCopyV2StorageContractAttested
    || values.slice(0, 4).some((value) => value !== undefined);
  if (!anyDeclared) return { kind: 'none' };
  const [imageRole, recoveryRole, owner, versioning, bucket, region] = values;
  if (!runtime.stateReferenceCopyV2StorageContractAttested
    || imageRole === undefined || recoveryRole === undefined || owner === undefined
    || versioning === undefined || bucket === undefined || region === undefined) return { kind: 'partial' };

  const sameRole = imageRole.toLowerCase() === recoveryRole.toLowerCase();
  const validShape = IMAGE_ROLE_ARN.test(imageRole) && IMAGE_ROLE_ARN.test(recoveryRole)
    && /^\d{12}$/u.test(owner) && ['never-versioned', 'versioned', 'suspended'].includes(versioning)
    && AWS_REGION.test(region) && BUCKET_NAME.test(bucket) && !bucket.includes('..')
    && !/^\d+\.\d+\.\d+\.\d+$/u.test(bucket);
  return { kind: 'configured', validShape, sameRole };
}
