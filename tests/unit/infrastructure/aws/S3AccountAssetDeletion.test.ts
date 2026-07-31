import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3AccountAssetDeletion } from '../../../../src/infrastructure/aws/S3AccountAssetDeletion.js';

class FakeS3Client {
  public readonly commands: unknown[] = [];
  public readonly abortSignals: AbortSignal[] = [];
  public async send(
    command: unknown,
    options: { abortSignal: AbortSignal },
  ): Promise<Record<string, never>> {
    this.commands.push(command);
    this.abortSignals.push(options.abortSignal);
    return {};
  }
}

class HangingS3Client {
  public async send(
    _command: unknown,
    options: { abortSignal: AbortSignal },
  ): Promise<Record<string, never>> {
    return new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener(
        'abort',
        () => reject(new Error('provider aborted')),
        { once: true },
      );
    });
  }
}

describe('S3AccountAssetDeletion', () => {
  it('設定bucket内のexact keyだけを削除する', async () => {
    const client = new FakeS3Client();
    const adapter = new S3AccountAssetDeletion(client, 'private-images');

    await adapter.deleteExactObject('users/u1/pages/p1.webp');

    expect(client.commands).toHaveLength(1);
    expect(client.commands[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(client.commands[0]).toMatchObject({
      input: {
        Bucket: 'private-images',
        Key: 'users/u1/pages/p1.webp',
      },
    });
    expect(client.abortSignals[0]).toBeInstanceOf(AbortSignal);
  });

  it('空key・制御文字・path segmentを拒否しprefix deleteを行わない', async () => {
    const adapter = new S3AccountAssetDeletion(new FakeS3Client(), 'private-images');

    await expect(adapter.deleteExactObject('')).rejects.toThrow('key');
    await expect(adapter.deleteExactObject('users/u1/../org/a.png')).rejects.toThrow(
      'key',
    );
    await expect(adapter.deleteExactObject('users/u1/\u0000.png')).rejects.toThrow(
      'key',
    );
  });

  it('S3が応答しない場合はbounded timeoutで中断する', async () => {
    const adapter = new S3AccountAssetDeletion(
      new HangingS3Client(),
      'private-images',
      1,
    );

    await expect(
      adapter.deleteExactObject('saved/user-1/pages/p1.webp'),
    ).rejects.toThrow('timed out');
  });
});
