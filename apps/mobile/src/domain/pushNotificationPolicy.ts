import { z } from 'zod';

import type { PersistedWorkspaceSelection } from '@/domain/types';

const id = z.string().uuid();
const targetTab = z.enum(['Story', 'Characters', 'Pages', 'Account']);

const pushNavigationDataSchema = z
  .object({
    job_id: id,
    organization_id: id.nullish(),
    target_tab: targetTab,
    work_id: id.optional(),
    chapter_id: id.optional(),
    episode_id: id.optional(),
    page_id: id.optional(),
    entity_id: id.optional()
  })
  .strict()
  .superRefine((value, context) => {
    const invalid = (message: string): void => {
      context.addIssue({ code: 'custom', message });
    };
    if (
      value.target_tab === 'Pages' &&
      (value.work_id === undefined ||
        value.chapter_id === undefined ||
        value.episode_id === undefined ||
        value.page_id === undefined ||
        value.entity_id !== undefined)
    ) {
      invalid('Pages target requires work, chapter, episode, and page IDs only');
    }
    if (
      value.target_tab === 'Characters' &&
      (value.work_id === undefined ||
        value.entity_id === undefined ||
        value.chapter_id !== undefined ||
        value.episode_id !== undefined ||
        value.page_id !== undefined)
    ) {
      invalid('Characters target requires work and entity IDs only');
    }
    if (
      value.target_tab === 'Story' &&
      (value.work_id === undefined ||
        value.chapter_id === undefined ||
        value.episode_id === undefined ||
        value.page_id !== undefined ||
        value.entity_id !== undefined)
    ) {
      invalid('Story target requires work, chapter, and episode IDs only');
    }
    if (
      value.target_tab === 'Account' &&
      [
        value.work_id,
        value.chapter_id,
        value.episode_id,
        value.page_id,
        value.entity_id
      ].some((entry) => entry !== undefined)
    ) {
      invalid('Account target must not include content IDs');
    }
  });

export type PushNavigationData = z.infer<typeof pushNavigationDataSchema>;

export function parsePushNavigationData(value: unknown): PushNavigationData | null {
  const parsed = pushNavigationDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function pushNavigationSelection(
  data: PushNavigationData
): PersistedWorkspaceSelection {
  return {
    organizationId: data.organization_id ?? null,
    workId: data.work_id ?? null,
    chapterId: data.chapter_id ?? null,
    episodeId: data.episode_id ?? null,
    pageId: data.page_id ?? null,
    entityId: data.entity_id ?? null
  };
}
