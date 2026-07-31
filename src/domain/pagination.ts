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

export interface GenerationJobHistoryCursor {
  activeRank: 0 | 1;
  createdAt: Date;
  id: string;
}

export interface WorkListCursor {
  updatedAt: Date;
  createdAt: Date;
  id: string;
}

export interface EntityListCursor {
  createdAt: Date;
  id: string;
}

export function encodeGenerationJobHistoryCursor(
  cursor: GenerationJobHistoryCursor,
): string {
  const createdAt = cursor.createdAt.toISOString();
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
