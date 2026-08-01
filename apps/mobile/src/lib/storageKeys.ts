const workspaceScope = (organizationId: string | null): string =>
  organizationId === null ? 'personal' : organizationId;

export const selectionStorageKey = (userId: string, organizationId: string | null): string =>
  `lyra.mobile.selection.${userId}.${workspaceScope(organizationId)}`;

export const activeOrganizationStorageKey = (userId: string): string =>
  `lyra.mobile.active-organization.${userId}`;

export const storyHierarchyExpansionStorageKey = (
  userId: string,
  organizationId: string | null
): string =>
  `lyra.mobile.story-hierarchy.${userId}.${workspaceScope(organizationId)}`;
