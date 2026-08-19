import { describe, expect, it, vi } from 'vitest';
import {
  isEpisodeExportRuntimeEnabled,
  runEpisodeExportRuntimeWhenEnabled,
} from '../../../src/lib/episodeExportRuntime.js';

describe('episode export runtime containment', () => {
  it('flag=false ならS3とSQSが設定されてもexport runtimeを有効化しない', () => {
    expect(
      isEpisodeExportRuntimeEnabled({
        EPISODE_EXPORT_ENABLED: false,
        S3_BUCKET_IMAGES: 'lyra-images',
        SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/generation',
      }),
    ).toBe(false);
  });

  it('flag=trueでもexport用S3またはSQS設定がなければ無効にする', () => {
    expect(
      isEpisodeExportRuntimeEnabled({
        EPISODE_EXPORT_ENABLED: true,
        S3_BUCKET_IMAGES: 'lyra-images',
        SQS_QUEUE_URL_GENERATION: undefined,
      }),
    ).toBe(false);
  });

  it('flag=trueと必要なS3・SQS設定がそろった場合だけ有効にする', () => {
    expect(
      isEpisodeExportRuntimeEnabled({
        EPISODE_EXPORT_ENABLED: true,
        S3_BUCKET_IMAGES: 'lyra-images',
        SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/generation',
      }),
    ).toBe(true);
  });

  it('無効時はexport DB・S3・SQS・初回処理・timerを一切起動しない', () => {
    const activity = {
      repository: vi.fn(),
      storage: vi.fn(),
      queue: vi.fn(),
      initialDispatch: vi.fn(),
      initialCleanup: vi.fn(),
      timer: vi.fn(),
    };

    runEpisodeExportRuntimeWhenEnabled(
      {
        EPISODE_EXPORT_ENABLED: false,
        S3_BUCKET_IMAGES: 'lyra-images',
        SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/generation',
      },
      () => {
        activity.repository();
        activity.storage();
        activity.queue();
        activity.initialDispatch();
        activity.initialCleanup();
        activity.timer();
        activity.timer();
      },
    );

    expect(activity.repository).not.toHaveBeenCalled();
    expect(activity.storage).not.toHaveBeenCalled();
    expect(activity.queue).not.toHaveBeenCalled();
    expect(activity.initialDispatch).not.toHaveBeenCalled();
    expect(activity.initialCleanup).not.toHaveBeenCalled();
    expect(activity.timer).not.toHaveBeenCalled();
  });
});
