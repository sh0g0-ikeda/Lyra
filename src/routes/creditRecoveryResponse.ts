export function creditRecoveryResponse(
  requestedVersion: string | undefined,
  balance: { paidGenerationBlocked?: boolean; recoveryCreditsDue?: number } | null | undefined,
): Record<string, boolean | number> {
  // Older mobile clients use strict response schemas. Opt-in changes only the
  // response shape; server-side credit admission is enforced for every client.
  return requestedVersion === '1' ? {
    paid_generation_blocked: balance?.paidGenerationBlocked ?? false,
    recovery_credits_due: balance?.recoveryCreditsDue ?? 0,
  } : {};
}
