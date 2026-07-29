import type { OrganizationInvitationStatus } from '@/domain/types';

export type InvitationUnavailableReason =
  | 'accepted'
  | 'email_mismatch'
  | 'expired'
  | 'revoked';

interface InvitationAvailabilityInput {
  expiresAt: string;
  invitedEmail: string;
  nowMs: number;
  signedInEmail: string | null;
  status: OrganizationInvitationStatus;
}

export function invitationUnavailableReason({
  expiresAt,
  invitedEmail,
  nowMs,
  signedInEmail,
  status,
}: InvitationAvailabilityInput): InvitationUnavailableReason | null {
  if (status === 'accepted') {
    return 'accepted';
  }
  if (status === 'revoked') {
    return 'revoked';
  }
  if (status === 'expired' || Date.parse(expiresAt) <= nowMs) {
    return 'expired';
  }
  if (
    signedInEmail !== null &&
    normalizeEmail(signedInEmail) !== normalizeEmail(invitedEmail)
  ) {
    return 'email_mismatch';
  }
  return null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
