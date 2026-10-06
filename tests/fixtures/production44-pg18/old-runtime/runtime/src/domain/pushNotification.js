export const PUSH_NOTIFICATION_LOCALES = ['ja', 'en'];
export function buildGenerationJobNotificationContent(locale, status) {
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
export function buildPushNavigationPayload(context) {
    const base = {
        job_id: context.jobId,
        organization_id: context.organizationId,
    };
    if (context.jobType === 'page_generate' &&
        context.workId !== null &&
        context.chapterId !== null &&
        context.episodeId !== null &&
        context.pageId !== null) {
        return {
            ...base,
            target_tab: 'Pages',
            work_id: context.workId,
            chapter_id: context.chapterId,
            episode_id: context.episodeId,
            page_id: context.pageId,
        };
    }
    if (context.jobType === 'entity_generate' &&
        context.workId !== null &&
        context.entityId !== null) {
        return {
            ...base,
            target_tab: 'Characters',
            work_id: context.workId,
            entity_id: context.entityId,
        };
    }
    if ((context.jobType === 'episode_page_skeleton' ||
        context.jobType === 'episode_story_autofill') &&
        context.workId !== null &&
        context.chapterId !== null &&
        context.episodeId !== null) {
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
