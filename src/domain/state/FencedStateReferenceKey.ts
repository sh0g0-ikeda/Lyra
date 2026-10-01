import { createHash } from 'node:crypto';
import { ConfigurationError } from '../errors/index.js';

export const STATE_REFERENCE_COPY_V2_PROTOCOL = 'state-reference-fenced-v2' as const;
export const STATE_REFERENCE_COPY_V2_PREFIX = 'state-reference-v2/';
export type FencedStateReferenceMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const KEY = /^state-reference-v2\/([0-9a-f-]{36})\/([0-9a-f]{64})\.(png|jpeg|webp)$/u;

/** Pseudonymous, not anonymous: no raw owner IDs are retained in the object key.
 * The random attempt prevents a stable cross-attempt hash. This binding proves
 * scope equality only; authorized DB descriptors and durable admission remain
 * necessary. A known owner/entity tuple can still be tested against a known key.
 */
export function buildFencedStateReferenceKey(input: {
  ownerUserId: string;
  entityId: string;
  attemptToken: string;
  mimeType: FencedStateReferenceMimeType;
}): string {
  if (![input.ownerUserId, input.entityId, input.attemptToken].every((id) => UUID.test(id))) {
    throw new ConfigurationError('Fenced state reference scope is invalid');
  }
  const extension = input.mimeType === 'image/png' ? 'png'
    : input.mimeType === 'image/jpeg' ? 'jpeg'
      : input.mimeType === 'image/webp' ? 'webp' : null;
  if (extension === null) throw new ConfigurationError('Fenced state reference MIME is invalid');
  const digest = createHash('sha256').update(JSON.stringify([
    STATE_REFERENCE_COPY_V2_PROTOCOL, input.ownerUserId, input.entityId,
    input.attemptToken, extension,
  ])).digest('hex');
  return `${STATE_REFERENCE_COPY_V2_PREFIX}${input.attemptToken}/${digest}.${extension}`;
}

export function isReservedFencedStateReferenceNamespace(key: string): boolean {
  return key.startsWith(STATE_REFERENCE_COPY_V2_PREFIX);
}

export function ensureOwnedFencedStateReferenceKey(
  key: string,
  ownerUserId: string,
  entityId: string,
): void {
  const match = KEY.exec(key);
  if (match === null || !UUID.test(match[1])) {
    throw new ConfigurationError('Fenced state reference key is invalid');
  }
  const mimeType: FencedStateReferenceMimeType = match[3] === 'png' ? 'image/png'
    : match[3] === 'jpeg' ? 'image/jpeg' : 'image/webp';
  if (buildFencedStateReferenceKey({ ownerUserId, entityId, attemptToken: match[1], mimeType }) !== key) {
    throw new ConfigurationError('Fenced state reference key is outside the owner scope');
  }
}
