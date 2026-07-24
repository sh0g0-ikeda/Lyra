export interface MobileWebParityEvidence {
  path: string;
  markers: readonly string[];
}

export interface MobileWebParityContract {
  kind: string;
  reason?: string;
  web?: readonly MobileWebParityEvidence[];
  mobile?: readonly MobileWebParityEvidence[];
}

export interface MobileWebParityRequirement {
  requirement: string;
  behavior: string;
  web: readonly MobileWebParityEvidence[];
  mobile: readonly MobileWebParityEvidence[];
  contract: MobileWebParityContract;
  verification: readonly MobileWebParityEvidence[];
}

export interface MobileWebParityAuditOptions {
  projectRoot?: string;
  specPath?: string;
  requirements?: readonly MobileWebParityRequirement[];
}

export interface MobileWebParityAuditResult {
  inventory: string;
  requirements: readonly MobileWebParityRequirement[];
  specRequirements: readonly string[];
}

export const auditCRequirements: readonly MobileWebParityRequirement[];

export function auditMobileWebParity(
  options?: MobileWebParityAuditOptions
): MobileWebParityAuditResult;
