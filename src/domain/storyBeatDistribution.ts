function normalizeBeatSource(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return normalized.length === 0 ? null : normalized;
}

function truncateBeat(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function splitIntoSentences(value: string): string[] {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    return [];
  }

  const parts = normalized
    .split(/(?<=[\u3002\uff01\uff1f!?])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts.length > 0 ? parts : [normalized];
}

function splitLongClause(value: string, maxLength: number): string[] {
  if (value.length <= maxLength) {
    return [value];
  }

  const clauses = value
    .split(/(?<=[\u3001,;:])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (clauses.length <= 1) {
    return [truncateBeat(value, maxLength)];
  }

  const chunks: string[] = [];
  let current = '';

  for (const clause of clauses) {
    if (current.length === 0) {
      current = clause;
      continue;
    }

    const candidate = `${current} ${clause}`.trim();
    if (candidate.length > maxLength) {
      chunks.push(truncateBeat(current, maxLength));
      current = clause;
      continue;
    }

    current = candidate;
  }

  if (current.length > 0) {
    chunks.push(truncateBeat(current, maxLength));
  }

  return chunks;
}

function extractStoryBeatUnits(
  segments: Array<string | null | undefined>,
  maxLength: number,
): string[] {
  const units: string[] = [];

  for (const segment of segments) {
    const normalized = normalizeBeatSource(segment);
    if (normalized === null) {
      continue;
    }

    const paragraphs = normalized
      .split(/\n\s*\n+/u)
      .map((paragraph) => paragraph.replace(/\n+/gu, ' ').trim())
      .filter((paragraph) => paragraph.length > 0);

    for (const paragraph of paragraphs) {
      const sentences = splitIntoSentences(paragraph);
      let current = '';

      for (const sentence of sentences) {
        for (const piece of splitLongClause(sentence, maxLength)) {
          if (current.length === 0) {
            current = piece;
            continue;
          }

          const candidate = `${current} ${piece}`.trim();
          if (current.length < 36 && candidate.length <= maxLength) {
            current = candidate;
            continue;
          }

          units.push(truncateBeat(current, maxLength));
          current = piece;
        }
      }

      if (current.length > 0) {
        units.push(truncateBeat(current, maxLength));
      }
    }
  }

  return units;
}

export function distributeStoryBeats(
  segments: Array<string | null | undefined>,
  totalPages: number,
  maxLength = 140,
): string[] {
  if (totalPages <= 0) {
    return [];
  }

  const units = extractStoryBeatUnits(segments, maxLength);
  if (units.length === 0) {
    return [];
  }

  return Array.from({ length: totalPages }, (_value, pageIndex) => {
    const start = Math.floor((pageIndex * units.length) / totalPages);
    const end = Math.floor(((pageIndex + 1) * units.length) / totalPages);
    const slice = units.slice(start, Math.max(start + 1, end));
    return truncateBeat(slice.join(' '), maxLength);
  });
}
