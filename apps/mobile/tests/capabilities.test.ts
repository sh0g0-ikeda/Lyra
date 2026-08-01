import { describe, expect, it } from 'vitest';

import { hasWorkspaceCapability } from '@/domain/capabilities';

describe('hasWorkspaceCapability', () => {
  it('個人ワークスペースでは全操作を許可する', () => {
    expect(hasWorkspaceCapability(null, null, 'manage_billing')).toBe(true);
    expect(hasWorkspaceCapability(null, null, 'generate')).toBe(true);
  });

  it('法人billing roleは請求だけを操作できる', () => {
    expect(
      hasWorkspaceCapability('organization-1', 'billing', 'manage_billing')
    ).toBe(true);
    expect(
      hasWorkspaceCapability('organization-1', 'billing', 'view_work')
    ).toBe(false);
  });

  it('法人viewer roleは閲覧できるが編集・生成できない', () => {
    expect(
      hasWorkspaceCapability('organization-1', 'viewer', 'view_work')
    ).toBe(true);
    expect(
      hasWorkspaceCapability('organization-1', 'viewer', 'edit_work')
    ).toBe(false);
    expect(
      hasWorkspaceCapability('organization-1', 'viewer', 'generate')
    ).toBe(false);
  });

  it('roleが取得できない法人では全操作を拒否する', () => {
    expect(
      hasWorkspaceCapability('organization-1', null, 'view_work')
    ).toBe(false);
  });
});
