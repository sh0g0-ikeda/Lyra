import type { OrganizationRole } from '@/domain/types';

export type OrganizationCapability =
  | 'manage_organization'
  | 'manage_members'
  | 'manage_billing'
  | 'view_billing'
  | 'view_usage'
  | 'view_audit_logs'
  | 'create_work'
  | 'edit_work'
  | 'generate'
  | 'export'
  | 'view_work';

const roleCapabilities: Record<
  OrganizationRole,
  readonly OrganizationCapability[]
> = {
  owner: [
    'manage_organization',
    'manage_members',
    'manage_billing',
    'view_billing',
    'view_usage',
    'view_audit_logs',
    'create_work',
    'edit_work',
    'generate',
    'export',
    'view_work'
  ],
  admin: [
    'manage_members',
    'view_usage',
    'view_audit_logs',
    'create_work',
    'edit_work',
    'generate',
    'export',
    'view_work'
  ],
  billing: ['manage_billing', 'view_billing'],
  editor: ['create_work', 'edit_work', 'generate', 'export', 'view_work'],
  viewer: ['view_work']
};

export const hasWorkspaceCapability = (
  organizationId: string | null,
  role: OrganizationRole | null,
  capability: OrganizationCapability
): boolean => {
  if (organizationId === null) {
    return true;
  }
  return role !== null && roleCapabilities[role].includes(capability);
};
