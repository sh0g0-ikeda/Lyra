import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_DELETION_WORKER_ENTRYPOINT_IMAGE_PATH,
  assertAccountDeletionWorkerArtifact,
  selectLinuxArm64ManifestDigest,
} from '../../../../src/infrastructure/account/AccountDeletionWorkerArtifactPreflight.js';

describe('account-deletion worker artifact preflight', () => {
  it('専用ECRのimmutable ARM64 imageとworker entrypointと現行1+rollback4保持policyを受け入れる', () => {
    expect(() => assertAccountDeletionWorkerArtifact({
      repositoryName: 'lyra-prod-account-deletion-worker',
      imageDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      architecture: 'arm64',
      os: 'linux',
      filesystemPaths: new Set([ACCOUNT_DELETION_WORKER_ENTRYPOINT_IMAGE_PATH]),
      lifecyclePolicy: lifecyclePolicy(5),
    })).not.toThrow();
  });

  it('manifest listからLinux ARM64だけを選択する', () => {
    expect(selectLinuxArm64ManifestDigest({
      manifests: [
        {
          digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          platform: { architecture: 'amd64', os: 'linux' },
        },
        {
          digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          platform: { architecture: 'arm64', os: 'linux' },
        },
      ],
    })).toBe('sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
  });

  it('shared API repository・mutable reference・entrypointなし・不足保持policyを拒否する', () => {
    const valid = {
      repositoryName: 'lyra-prod-account-deletion-worker',
      imageDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      architecture: 'arm64' as const,
      os: 'linux' as const,
      filesystemPaths: new Set([ACCOUNT_DELETION_WORKER_ENTRYPOINT_IMAGE_PATH]),
      lifecyclePolicy: lifecyclePolicy(5),
    };

    expect(() => assertAccountDeletionWorkerArtifact({
      ...valid,
      repositoryName: 'lyra-prod-api',
    })).toThrow('dedicated');
    expect(() => assertAccountDeletionWorkerArtifact({
      ...valid,
      imageDigest: 'page-workflow-current',
    })).toThrow('immutable');
    expect(() => assertAccountDeletionWorkerArtifact({
      ...valid,
      filesystemPaths: new Set<string>(),
    })).toThrow('entrypoint');
    expect(() => assertAccountDeletionWorkerArtifact({
      ...valid,
      lifecyclePolicy: lifecyclePolicy(4),
    })).toThrow('retain');
  });

  it('expire以外のactionと先行する広いexpiry ruleを拒否する', () => {
    const valid = {
      repositoryName: 'lyra-prod-account-deletion-worker',
      imageDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      architecture: 'arm64',
      os: 'linux',
      filesystemPaths: new Set([ACCOUNT_DELETION_WORKER_ENTRYPOINT_IMAGE_PATH]),
    };

    expect(() => assertAccountDeletionWorkerArtifact({
      ...valid,
      lifecyclePolicy: lifecyclePolicy(5, 'retain'),
    })).toThrow('retain');
    expect(() => assertAccountDeletionWorkerArtifact({
      ...valid,
      lifecyclePolicy: lifecyclePolicy(5, 'expire', [{
        rulePriority: 1,
        selection: {
          tagStatus: 'any',
          countType: 'imageCountMoreThan',
          countNumber: 1,
        },
        action: { type: 'expire' },
      }]),
    })).toThrow('retain');
  });
});

function lifecyclePolicy(
  retainCount: number,
  actionType = 'expire',
  earlierRules: unknown[] = [],
): string {
  return JSON.stringify({
    rules: [
      ...earlierRules,
      {
        rulePriority: earlierRules.length + 1,
        description: 'Retain current worker image plus four rollback images',
        selection: {
          tagStatus: 'any',
          countType: 'imageCountMoreThan',
          countNumber: retainCount,
        },
        action: { type: actionType },
      },
    ],
  });
}
