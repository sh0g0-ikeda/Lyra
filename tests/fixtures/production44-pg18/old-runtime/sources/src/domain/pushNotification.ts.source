import type { GenerationJobStatus, GenerationJobType } from './types/job.js';
import type { PushPlatform } from './pushToken.js';

export const PUSH_NOTIFICATION_LOCALES = ['ja', 'en'] as const;
export type PushNotificationLocale = (typeof PUSH_NOTIFICATION_LOCALES)[number];

export type PushNotificationJobStatus = Extract<
  GenerationJobStatus,
  'completed' | 'failed'
>;

export type PushNavigationPayload =
  | {
      job_id: string;
      organization_id: string | null;
      target_tab: 'Pages';
      work_id: string;
      chapter_id: string;
      episode_id: string;
      page_id: string;
    }
  | {
      job_id: string;
      organization_id: string | null;
      target_tab: 'Characters';
      work_id: string;
      entity_id: string;
    }
  | {
      job_id: string;
      organization_id: string | null;
      target_tab: 'Story';
      work_id: string;
      chapter_id: string;
      episode_id: string;
    };

export interface PushNotificationContent {
  title: string;
  body: string;
}

export interface PushNotificationDelivery {
  deliveryId: string;
  pushTokenId: string;
  leaseToken: string;
  userId: string;
  platform: PushPlatform;
  locale: PushNotificationLocale;
  tokenCiphertext: string;
  encryptionKeyId: string;
  jobStatus: PushNotificationJobStatus;
  attemptCount: number;
  navigation: PushNavigationPayload;
}

export interface PushNotificationDeliveryContext {
  jobId: string;
  organizationId: string | null;
  jobType: GenerationJobType;
  workId: string | null;
  chapterId: string | null;
  episodeId: string | null;
  pageId: string | null;
  entityId: string | null;
}

export function buildGenerationJobNotificationContent(
  locale: PushNotificationLocale,
  status: PushNotificationJobStatus,
): PushNotificationContent {
  if (locale === 'en') {
    return status === 'completed'
      ? {
          title: 'Generation completed',
          body: 'Open the app to review the result.',
        }
      : {
          title: 'Generation could not be completed',
          body: 'Open the app to review the status.',
        };
  }

  return status === 'completed'
    ? {
        title: '生成が完了しました',
        body: 'アプリで結果を確認できます。',
      }
    : {
        title: '生成を完了できませんでした',
        body: 'アプリで状況を確認してください。',
      };
}

export function buildPushNavigationPayload(
  context: PushNotificationDeliveryContext,
): PushNavigationPayload | null {
  const base = {
    job_id: context.jobId,
    organization_id: context.organizationId,
  };

  if (
    context.jobType === 'page_generate' &&
    context.workId !== null &&
    context.chapterId !== null &&
    context.episodeId !== null &&
    context.pageId !== null
  ) {
    return {
      ...base,
      target_tab: 'Pages',
      work_id: context.workId,
      chapter_id: context.chapterId,
      episode_id: context.episodeId,
      page_id: context.pageId,
    };
  }

  if (
    context.jobType === 'entity_generate' &&
    context.workId !== null &&
    context.entityId !== null
  ) {
    return {
      ...base,
      target_tab: 'Characters',
      work_id: context.workId,
      entity_id: context.entityId,
    };
  }

  if (
    (context.jobType === 'episode_page_skeleton' ||
      context.jobType === 'episode_story_autofill') &&
    context.workId !== null &&
    context.chapterId !== null &&
    context.episodeId !== null
  ) {
    return {
      ...base,
      target_tab: 'Story',
      work_id: context.workId,
      chapter_id: context.chapterId,
      episode_id: context.episodeId,
    };
  }

  return null;
}
