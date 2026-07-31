import {
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ValidationError } from '../../domain/errors/index.js';
import type { AccountAssetDeletionPort } from '../../services/account/AccountDeletionService.js';
import {
  ACCOUNT_DELETION_AWS_TIMEOUT_MS,
  runAwsCommandWithTimeout,
} from './AwsCommandTimeout.js';

interface S3AccountDeletionClient {
  send(
    command: DeleteObjectCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<unknown>;
}

export class S3AccountAssetDeletion implements AccountAssetDeletionPort {
  public constructor(
    private readonly client: S3AccountDeletionClient,
    private readonly bucket: string,
    private readonly timeoutMs = ACCOUNT_DELETION_AWS_TIMEOUT_MS,
  ) {
    if (bucket.trim().length === 0) {
      throw new Error('Account deletion S3 bucket is required');
    }
  }

  public async deleteExactObject(key: string): Promise<void> {
    const exactKey = validateExactObjectKey(key);
    await runAwsCommandWithTimeout(
      'Account asset deletion',
      this.timeoutMs,
      (abortSignal) => this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: exactKey,
        }),
        { abortSignal },
      ),
    );
  }
}

export function createS3AccountAssetDeletion(input: {
  region: string;
  bucket: string;
}): S3AccountAssetDeletion {
  return new S3AccountAssetDeletion(
    new S3Client({ region: input.region }),
    input.bucket,
  );
}

function validateExactObjectKey(key: string): string {
  if (
    key.length < 1
    || key.length > 1024
    || key !== key.trim()
    || /[\u0000-\u001f\u007f]/u.test(key)
    || key.startsWith('/')
    || key.endsWith('/')
    || key.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new ValidationError('Account asset key is invalid');
  }
  return key;
}
