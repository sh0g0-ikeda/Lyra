import type { PersistedWorkspaceSelection } from '@/domain/types';
import { MOBILE_LIST_PAGE_SIZE } from '@/lib/listPagination';

export const sessionQueryKey = (sessionKey: string) => ['session', sessionKey] as const;
export const balanceQueryKey = (sessionKey: string, organizationId: string | null) =>
  ['balance', sessionKey, organizationId ?? 'personal'] as const;
export const worksQueryKey = (sessionKey: string, organizationId: string | null) =>
  ['works', sessionKey, organizationId ?? 'personal'] as const;
export const worksInfiniteQueryKey = (sessionKey: string, organizationId: string | null) =>
  [...worksQueryKey(sessionKey, organizationId), 'cursor', MOBILE_LIST_PAGE_SIZE] as const;
export const workDetailQueryKey = (
  sessionKey: string,
  workId: string | null,
  organizationId: string | null,
) => ['work-detail', sessionKey, workId ?? 'none', organizationId ?? 'personal'] as const;
export const chaptersQueryKey = (sessionKey: string, workId: string | null, organizationId: string | null) =>
  ['chapters', sessionKey, workId ?? 'none', organizationId ?? 'personal'] as const;
export const episodesQueryKey = (sessionKey: string, chapterId: string | null, organizationId: string | null) =>
  ['episodes', sessionKey, chapterId ?? 'none', organizationId ?? 'personal'] as const;
export const entitiesQueryKey = (sessionKey: string, workId: string | null, organizationId: string | null) =>
  ['entities', sessionKey, workId ?? 'none', organizationId ?? 'personal'] as const;
export const entitiesInfiniteQueryKey = (
  sessionKey: string,
  workId: string | null,
  organizationId: string | null,
) => [...entitiesQueryKey(sessionKey, workId, organizationId), 'cursor', MOBILE_LIST_PAGE_SIZE] as const;
export const entityDetailQueryKey = (
  sessionKey: string,
  entityId: string | null,
  organizationId: string | null,
) => ['entity-detail', sessionKey, entityId ?? 'none', organizationId ?? 'personal'] as const;
export const pagesQueryKey = (sessionKey: string, episodeId: string | null, organizationId: string | null) =>
  ['pages', sessionKey, episodeId ?? 'none', organizationId ?? 'personal'] as const;
export const pagesInfiniteQueryKey = (
  sessionKey: string,
  episodeId: string | null,
  organizationId: string | null,
) => [...pagesQueryKey(sessionKey, episodeId, organizationId), 'cursor', MOBILE_LIST_PAGE_SIZE] as const;
export const pageDetailQueryKey = (
  sessionKey: string,
  pageId: string | null,
  organizationId: string | null,
) => ['page-detail', sessionKey, pageId ?? 'none', organizationId ?? 'personal'] as const;
export const pageGenerationReadinessQueryKey = (
  sessionKey: string,
  pageId: string | null,
  organizationId: string | null
) => ['page-generation-readiness', sessionKey, pageId ?? 'none', organizationId ?? 'personal'] as const;
export const pageLayoutTemplatesQueryKey = (sessionKey: string) =>
  ['page-layout-templates', sessionKey] as const;
export const exportJobQueryKey = (
  sessionKey: string,
  jobId: string | null,
  organizationId: string | null
) => ['export-job', sessionKey, jobId ?? 'none', organizationId ?? 'personal'] as const;
export const scenesQueryKey = (sessionKey: string, episodeId: string | null, organizationId: string | null) =>
  ['scenes', sessionKey, episodeId ?? 'none', organizationId ?? 'personal'] as const;
export const entityStatesQueryKey = (sessionKey: string, entityId: string | null, organizationId: string | null) =>
  ['entity-states', sessionKey, entityId ?? 'none', organizationId ?? 'personal'] as const;
export const panelsQueryKey = (sessionKey: string, pageId: string | null, organizationId: string | null) =>
  ['panels', sessionKey, pageId ?? 'none', organizationId ?? 'personal'] as const;
export const framesQueryKey = (sessionKey: string, pageId: string | null, organizationId: string | null) =>
  ['frames', sessionKey, pageId ?? 'none', organizationId ?? 'personal'] as const;
export const balloonsQueryKey = (
  sessionKey: string,
  pageId: string | null,
  organizationId: string | null
) => ['balloons', sessionKey, pageId ?? 'none', organizationId ?? 'personal'] as const;
export const compositionsQueryKey = (sessionKey: string) => ['compositions', sessionKey] as const;
export const jobQueryKey = (
  sessionKey: string,
  jobId: string | null,
  organizationId: string | null = null
) => ['job', sessionKey, organizationId ?? 'personal', jobId ?? 'none'] as const;
export const jobsQueryKey = (sessionKey: string, organizationId: string | null) =>
  ['jobs', sessionKey, organizationId ?? 'personal'] as const;
export const activeResourceJobQueryKey = (
  sessionKey: string,
  organizationId: string | null,
  resourceParam: 'entity_id' | 'episode_id' | 'page_id',
  resourceId: string | null,
  jobTypeKey: string
) => [
  'active-resource-job',
  sessionKey,
  organizationId ?? 'personal',
  resourceParam,
  resourceId ?? 'none',
  jobTypeKey
] as const;
export const entityReferenceSetQueryKey = (
  sessionKey: string,
  entityId: string | null,
  organizationId: string | null
) => ['entity-reference-set', sessionKey, entityId ?? 'none', organizationId ?? 'personal'] as const;
export const organizationWorkspaceQueryKey = (sessionKey: string, organizationId: string) =>
  ['organization-workspace', sessionKey, organizationId] as const;
export const organizationMembersQueryKey = (sessionKey: string, organizationId: string) =>
  ['organization-members', sessionKey, organizationId] as const;
export const organizationMembersInfiniteQueryKey = (sessionKey: string, organizationId: string) =>
  [...organizationMembersQueryKey(sessionKey, organizationId), 'cursor', MOBILE_LIST_PAGE_SIZE] as const;
export const organizationInvitationsQueryKey = (sessionKey: string, organizationId: string) =>
  ['organization-invitations', sessionKey, organizationId] as const;
export const organizationInvitationsInfiniteQueryKey = (sessionKey: string, organizationId: string) =>
  [...organizationInvitationsQueryKey(sessionKey, organizationId), 'cursor', MOBILE_LIST_PAGE_SIZE] as const;
export const organizationBillingQueryKey = (sessionKey: string, organizationId: string) =>
  ['organization-billing', sessionKey, organizationId] as const;
export const organizationInvoicesQueryKey = (sessionKey: string, organizationId: string) =>
  ['organization-invoices', sessionKey, organizationId] as const;
export const organizationUsageQueryKey = (sessionKey: string, organizationId: string) =>
  ['organization-usage', sessionKey, organizationId] as const;
export const organizationUsageInfiniteQueryKey = (sessionKey: string, organizationId: string) =>
  [...organizationUsageQueryKey(sessionKey, organizationId), 'cursor', MOBILE_LIST_PAGE_SIZE] as const;
export const organizationAuditLogsQueryKey = (sessionKey: string, organizationId: string) =>
  ['organization-audit-logs', sessionKey, organizationId] as const;
export const organizationAuditLogsInfiniteQueryKey = (sessionKey: string, organizationId: string) =>
  [...organizationAuditLogsQueryKey(sessionKey, organizationId), 'cursor', MOBILE_LIST_PAGE_SIZE] as const;

export const defaultSelection: PersistedWorkspaceSelection = {
  workId: null,
  chapterId: null,
  episodeId: null,
  pageId: null,
  entityId: null,
  organizationId: null
};
