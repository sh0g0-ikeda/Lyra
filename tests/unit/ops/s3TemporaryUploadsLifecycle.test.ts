import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('temporary entity upload S3 lifecycle', () => {
  it('tmp prefixを24時間以内に期限切れにし未完了multipartも1日で中断する', async () => {
    const raw = await readFile(
      resolve('ops/security/s3-temporary-uploads-lifecycle-rule.example.json'),
      'utf8'
    );
    const rule = JSON.parse(raw) as {
      Status?: unknown;
      Filter?: { Prefix?: unknown };
      Expiration?: { Days?: unknown };
      NoncurrentVersionExpiration?: { NoncurrentDays?: unknown };
      AbortIncompleteMultipartUpload?: { DaysAfterInitiation?: unknown };
    };

    expect(rule.Status).toBe('Enabled');
    expect(rule.Filter?.Prefix).toBe('tmp/');
    expect(rule.Expiration?.Days).toBe(1);
    expect(rule.NoncurrentVersionExpiration?.NoncurrentDays).toBe(1);
    expect(rule.AbortIncompleteMultipartUpload?.DaysAfterInitiation).toBe(1);
  });
});
