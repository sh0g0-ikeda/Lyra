import { z } from 'zod';
import { ValidationError } from './errors/index.js';

export const ORGANIZATION_COLLECTION_KINDS = [
  'organization-members',
  'organization-invitations',
  'organization-usage',
  'organization-audit-logs',
] as const;
export type OrganizationCollectionKind = typeof ORGANIZATION_COLLECTION_KINDS[number];

// Keep the deployed cursor's exact shape. It is a sort boundary, never authority.
const cursorSchema = z.object({
  v: z.literal(1),
  k: z.enum(ORGANIZATION_COLLECTION_KINDS),
  sort: z.string().min(1).max(128),
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu),
}).strict();
export interface OrganizationCollectionCursor {
  sort: string;
  id: string;
}
export interface OrganizationCollectionPageRequest {
  limit: number;
  cursor: OrganizationCollectionCursor | null;
}
export interface OrganizationCollectionPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeOrganizationCollectionCursor(
  kind: OrganizationCollectionKind,
  sort: string,
  id: string,
): string {
  const payload = cursorSchema.parse({ v: 1, k: kind, sort, id });
  assertCanonicalTimestamp(sort);
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeOrganizationCollectionCursor(
  encoded: string,
  expectedKind: OrganizationCollectionKind,
): OrganizationCollectionCursor {
  try {
    if (encoded.length === 0 || encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
      throw new Error('Invalid encoding');
    }
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
      throw new Error('Non-canonical encoding');
    }
    const payload = cursorSchema.parse(JSON.parse(decoded));
    if (payload.k !== expectedKind) throw new Error('Wrong endpoint');
    assertCanonicalTimestamp(payload.sort);
    return { sort: payload.sort, id: payload.id };
  } catch {
    throw new ValidationError('cursor is invalid for this endpoint');
  }
}

function assertCanonicalTimestamp(value: string): void {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new ValidationError('cursor timestamp is invalid');
  }
}
