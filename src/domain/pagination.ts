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

export interface GenerationJobHistoryCursor {
  activeRank: 0 | 1;
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

function throwInvalidCursor(): never {
  throw new ValidationError('cursor is invalid');
}
