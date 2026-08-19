export const ACCOUNT_DELETION_WORKER_ENTRYPOINT_IMAGE_PATH =
  'app/dist/scripts/startProductionAccountDeletionWorker.js';

const MINIMUM_RETAINED_WORKER_IMAGES = 5;
const IMMUTABLE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{7,64}$/u;

export interface AccountDeletionWorkerArtifactInput {
  repositoryName: string;
  imageDigest: string;
  sourceRevision?: string;
  architecture: string;
  os: string;
  filesystemPaths: ReadonlySet<string>;
  lifecyclePolicy: string;
}

export function assertAccountDeletionWorkerArtifact(
  input: AccountDeletionWorkerArtifactInput,
): void {
  if (!isDedicatedAccountDeletionRepository(input.repositoryName)) {
    throw new Error('Account deletion worker must use a dedicated ECR repository');
  }
  if (!IMMUTABLE_DIGEST_PATTERN.test(input.imageDigest)) {
    throw new Error('Account deletion worker image must use an immutable digest');
  }
  if (
    input.sourceRevision !== undefined
    && !SOURCE_REVISION_PATTERN.test(input.sourceRevision)
  ) {
    throw new Error('Account deletion worker source revision is invalid');
  }
  if (input.os !== 'linux' || input.architecture !== 'arm64') {
    throw new Error('Account deletion worker image must target Linux ARM64');
  }
  if (!input.filesystemPaths.has(ACCOUNT_DELETION_WORKER_ENTRYPOINT_IMAGE_PATH)) {
    throw new Error('Account deletion worker image does not contain its entrypoint');
  }
  if (!retainsWorkerRollbackImages(input.lifecyclePolicy)) {
    throw new Error('Account deletion worker lifecycle policy must retain the current image plus four rollback images');
  }
}

export function selectLinuxArm64ManifestDigest(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.manifests)) {
    throw new Error('Account deletion worker manifest list is invalid');
  }
  const candidate = value.manifests.find((manifest) => (
    isRecord(manifest)
    && typeof manifest.digest === 'string'
    && isRecord(manifest.platform)
    && manifest.platform.os === 'linux'
    && manifest.platform.architecture === 'arm64'
  ));
  if (candidate === undefined || !isRecord(candidate) || typeof candidate.digest !== 'string') {
    throw new Error('Account deletion worker manifest has no Linux ARM64 image');
  }
  if (!IMMUTABLE_DIGEST_PATTERN.test(candidate.digest)) {
    throw new Error('Account deletion worker manifest digest is invalid');
  }
  return candidate.digest;
}

export function readImageConfigPlatform(value: unknown): {
  architecture: string;
  os: string;
  sourceRevision: string | undefined;
} {
  if (!isRecord(value) || typeof value.architecture !== 'string' || typeof value.os !== 'string') {
    throw new Error('Account deletion worker image config is invalid');
  }
  const labels = isRecord(value.config) && isRecord(value.config.Labels)
    ? value.config.Labels
    : undefined;
  const revision = labels?.['org.opencontainers.image.revision'];
  return {
    architecture: value.architecture,
    os: value.os,
    sourceRevision: typeof revision === 'string' ? revision : undefined,
  };
}

export function isDedicatedAccountDeletionRepository(repositoryName: string): boolean {
  return (
    repositoryName.trim().length > 0
    && repositoryName !== 'lyra-prod-api'
    && repositoryName.includes('account-deletion')
  );
}

function retainsWorkerRollbackImages(policyText: string): boolean {
  let policy: unknown;
  try {
    policy = JSON.parse(policyText) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(policy) || !Array.isArray(policy.rules) || policy.rules.length !== 1) {
    return false;
  }
  const rule = policy.rules[0];
  return (
    isRecord(rule)
    && rule.rulePriority === 1
    && isRecord(rule.selection)
    && rule.selection.tagStatus === 'any'
    && rule.selection.countType === 'imageCountMoreThan'
    && typeof rule.selection.countNumber === 'number'
    && Number.isSafeInteger(rule.selection.countNumber)
    && rule.selection.countNumber >= MINIMUM_RETAINED_WORKER_IMAGES
    && isRecord(rule.action)
    && rule.action.type === 'expire'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
