import { createHash } from 'node:crypto';

export interface PersistedPromptDiagnostics {
  sha256: string;
  bytes: number;
}

// Store prompt fingerprints for support/debugging without duplicating user story text in job results.
export function buildPersistedPromptDiagnostics(value: string): PersistedPromptDiagnostics {
  return {
    sha256: createHash('sha256').update(value, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(value, 'utf8'),
  };
}
