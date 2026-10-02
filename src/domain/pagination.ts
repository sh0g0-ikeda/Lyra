import { z } from 'zod';
import { ValidationError } from './errors/index.js';

const MAX_CURSOR_LENGTH = 512;
const generationJobHistoryCursorWireSchema = z
  .object({
    v: z.literal(1),
    k: z.literal('generation_job_history'),
    a: z.union([z.literal(0), z.literal(1)]),
    c: z.string().min(1),
    i: z.string().uuid(),
  })
  .strict();
const workListCursorWireSchema = z
  .object({
    v: z.literal(1),
    k: z.literal('works'),
    u: z.string().min(1),
    c: z.string().min(1),
    i: z.string().uuid(),
  })
  .strict();
const entityListCursorWireSchema = z
  .object({
    v: z.literal(1),
    k: z.literal('entities'),
    c: z.string().min(1),
    i: z.string().uuid(),
  })
  .strict();
const pageListCursorWireSchema = z
  .object({
    v: z.literal(1),
    k: z.literal('pages'),
    n: z.number().int().positive().max(2_147_483_647),
    i: z.string().uuid(),
  })
  .strict();
const organizationListCursorWireSchema = z
  .object({
    v: z.literal(1),
    k: z.literal('organizations'),
    u: z.string().min(1),
    c: z.string().min(1),
    i: z.string().uuid(),
  })
  .strict();

export interface GenerationJobHistoryCursor {
  format?: 'production-v1';
  activeRank: 0 | 1;
  createdAt: Date;
  id: string;
}

export type WorkListCursor = { updatedAt: Date; id: string } & (
  | { format: 'production-v1' }
  | { format?: 'candidate-v1'; createdAt: Date }
);

export interface EntityListCursor {
  createdAt: Date;
  id: string;
}

export interface PageListCursor {
  pageNumber: number;
  id: string;
}

export interface OrganizationListCursor {
  updatedAt: Date;
  createdAt: Date;
  id: string;
}

export function encodeGenerationJobHistoryCursor(
  cursor: GenerationJobHistoryCursor,
): string {
  const createdAt = cursor.createdAt.toISOString();
  if (cursor.format === 'production-v1') {
    return Buffer.from(JSON.stringify({ active_rank: cursor.activeRank, created_at: createdAt, id: cursor.id }), 'utf8').toString('base64url');
  }
  const payload = generationJobHistoryCursorWireSchema.parse({
    v: 1,
    k: 'generation_job_history',
    a: cursor.activeRank,
    c: createdAt,
    i: cursor.id,
  });

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeGenerationJobHistoryCursor(
  encoded: string,
): GenerationJobHistoryCursor {
  if (
    encoded.length === 0
    || encoded.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throwInvalidCursor();
  }

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
      throwInvalidCursor();
    }

    const parsedJson: unknown = JSON.parse(decoded);
    const deployed = z.object({ active_rank: z.union([z.literal(0), z.literal(1)]), created_at: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict().safeParse(parsedJson);
    if (deployed.success) return { activeRank: deployed.data.active_rank, createdAt: new Date(deployed.data.created_at), id: deployed.data.id, format: 'production-v1' };
    const parsed = generationJobHistoryCursorWireSchema.parse(parsedJson);
    if (JSON.stringify(parsed) !== decoded) {
      throwInvalidCursor();
    }

    const createdAt = new Date(parsed.c);
    if (
      !Number.isFinite(createdAt.getTime())
      || createdAt.toISOString() !== parsed.c
    ) {
      throwInvalidCursor();
    }

    return {
      activeRank: parsed.a,
      createdAt,
      id: parsed.i,
    };
  } catch {
    throwInvalidCursor();
  }
}

export function encodeWorkListCursor(cursor: WorkListCursor): string {
  if (cursor.format === 'production-v1') {
    return encodeProductionListCursor('works', cursor.updatedAt.toISOString(), cursor.id);
  }
  const payload = workListCursorWireSchema.parse({
    v: 1,
    k: 'works',
    u: cursor.updatedAt.toISOString(),
    c: cursor.createdAt.toISOString(),
    i: cursor.id,
  });

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeWorkListCursor(encoded: string): WorkListCursor {
  if (
    encoded.length === 0
    || encoded.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throwInvalidCursor();
  }

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
      throwInvalidCursor();
    }

    const parsedJson: unknown = JSON.parse(decoded);
    const legacy = parseProductionListCursor(decoded, parsedJson, 'works');
    if (legacy !== null) {
      return { format: 'production-v1', updatedAt: parseCanonicalCursorDate(legacy.sort as string), id: legacy.id };
    }
    const parsed = workListCursorWireSchema.parse(parsedJson);
    if (JSON.stringify(parsed) !== decoded) {
      throwInvalidCursor();
    }

    return {
      updatedAt: parseCanonicalCursorDate(parsed.u),
      createdAt: parseCanonicalCursorDate(parsed.c),
      id: parsed.i,
    };
  } catch {
    throwInvalidCursor();
  }
}

export function encodeEntityListCursor(cursor: EntityListCursor): string {
  const payload = entityListCursorWireSchema.parse({
    v: 1,
    k: 'entities',
    c: cursor.createdAt.toISOString(),
    i: cursor.id,
  });

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeEntityListCursor(encoded: string): EntityListCursor {
  if (
    encoded.length === 0
    || encoded.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throwInvalidCursor();
  }

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
      throwInvalidCursor();
    }

    const parsedJson: unknown = JSON.parse(decoded);
    const legacy = parseProductionListCursor(decoded, parsedJson, 'entities');
    if (legacy !== null) {
      return { createdAt: parseCanonicalCursorDate(legacy.sort as string), id: legacy.id };
    }
    const parsed = entityListCursorWireSchema.parse(parsedJson);
    if (JSON.stringify(parsed) !== decoded) {
      throwInvalidCursor();
    }

    return {
      createdAt: parseCanonicalCursorDate(parsed.c),
      id: parsed.i,
    };
  } catch {
    throwInvalidCursor();
  }
}

export function encodePageListCursor(cursor: PageListCursor): string {
  const payload = pageListCursorWireSchema.parse({
    v: 1,
    k: 'pages',
    n: cursor.pageNumber,
    i: cursor.id,
  });

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodePageListCursor(encoded: string): PageListCursor {
  if (
    encoded.length === 0
    || encoded.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throwInvalidCursor();
  }

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
      throwInvalidCursor();
    }

    const parsedJson: unknown = JSON.parse(decoded);
    const legacy = parseProductionListCursor(decoded, parsedJson, 'pages');
    if (legacy !== null) {
      return { pageNumber: legacy.sort as number, id: legacy.id };
    }
    const parsed = pageListCursorWireSchema.parse(parsedJson);
    if (JSON.stringify(parsed) !== decoded) {
      throwInvalidCursor();
    }

    return {
      pageNumber: parsed.n,
      id: parsed.i,
    };
  } catch {
    throwInvalidCursor();
  }
}

export function encodeOrganizationListCursor(
  cursor: OrganizationListCursor,
): string {
  const payload = organizationListCursorWireSchema.parse({
    v: 1,
    k: 'organizations',
    u: cursor.updatedAt.toISOString(),
    c: cursor.createdAt.toISOString(),
    i: cursor.id,
  });

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeOrganizationListCursor(
  encoded: string,
): OrganizationListCursor {
  if (
    encoded.length === 0
    || encoded.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throwInvalidCursor();
  }

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
      throwInvalidCursor();
    }

    const parsedJson: unknown = JSON.parse(decoded);
    const parsed = organizationListCursorWireSchema.parse(parsedJson);
    if (JSON.stringify(parsed) !== decoded) {
      throwInvalidCursor();
    }

    return {
      updatedAt: parseCanonicalCursorDate(parsed.u),
      createdAt: parseCanonicalCursorDate(parsed.c),
      id: parsed.i,
    };
  } catch {
    throwInvalidCursor();
  }
}

function throwInvalidCursor(): never {
  throw new ValidationError('cursor is invalid');
}

function parseCanonicalCursorDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throwInvalidCursor();
  }

  return date;
}

// Exact production-v1 shape, kept distinct from candidate-v1 despite sharing v=1.
const productionListCursorSchema = z.object({
  v: z.literal(1),
  k: z.enum(['works', 'entities', 'pages']),
  sort: z.union([z.string().min(1).max(128), z.number().int().positive().max(2_147_483_647)]),
  id: z.string().uuid(),
}).strict();

function parseProductionListCursor(
  decoded: string,
  value: unknown,
  kind: 'works' | 'entities' | 'pages',
): z.infer<typeof productionListCursorSchema> | null {
  const result = productionListCursorSchema.safeParse(value);
  if (!result.success) return null;
  const parsed = result.data;
  if (parsed.k !== kind || JSON.stringify(parsed) !== decoded ||
      (kind === 'pages' ? typeof parsed.sort !== 'number' : typeof parsed.sort !== 'string')) {
    throwInvalidCursor();
  }
  if (typeof parsed.sort === 'string') parseCanonicalCursorDate(parsed.sort);
  return parsed;
}

function encodeProductionListCursor(kind: 'works', sort: string, id: string): string {
  const payload = productionListCursorSchema.parse({ v: 1, k: kind, sort, id });
  parseCanonicalCursorDate(sort);
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
