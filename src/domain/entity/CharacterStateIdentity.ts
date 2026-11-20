/**
 * Identifies the same source-backed character state across retryable writers.
 * A shared quote alone is not enough: one sentence can contain several deltas.
 */
export function hasMatchingCharacterState(
  states: readonly CharacterStateIdentity[],
  change: CharacterStateChangeIdentity,
): boolean {
  const contentKey = `${normalizeText(change.name)}\u0000${normalizeText(change.description)}`;
  return states.some((state) =>
    (state.name !== null && state.description !== null
      && `${normalizeText(state.name)}\u0000${normalizeText(state.description)}` === contentKey)
    || (state.sourceQuote !== null && state.description !== null
      && describesSameSourceChange(
        state.sourceQuote,
        state.description,
        change.sourceQuote,
        change.description,
      )));
}

export interface CharacterStateIdentity {
  name: string | null;
  description: string | null;
  sourceQuote: string | null;
}

export interface CharacterStateChangeIdentity {
  name: string;
  description: string;
  sourceQuote: string;
}

export function describesSameSourceChange(
  savedQuote: string,
  savedDescription: string,
  candidateQuote: string,
  candidateDescription: string,
): boolean {
  const leftQuote = normalizeSourceSpan(savedQuote);
  const rightQuote = normalizeSourceSpan(candidateQuote);
  const leftDescription = normalizeSourceSpan(savedDescription);
  const rightDescription = normalizeSourceSpan(candidateDescription);
  return substantivelyContainsEither(leftQuote, rightQuote)
    && substantivelyContainsEither(leftDescription, rightDescription);
}

/** New episode drafts must retain a shared literal source as well as the delta. */
export function hasMatchingSourceBackedState(
  states: readonly CharacterStateIdentity[],
  change: CharacterStateChangeIdentity,
): boolean {
  const description = normalizeSourceSpan(change.description);
  const quote = normalizeSourceSpan(change.sourceQuote);
  return states.some((state) => state.sourceQuote !== null && state.description !== null
    && normalizeSourceSpan(state.description) === description
    && substantivelyContainsEither(normalizeSourceSpan(state.sourceQuote), quote));
}

function substantivelyContainsEither(left: string, right: string): boolean {
  if (left === right) return left.length > 0;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  return [...shorter].length >= 4 && longer.includes(shorter);
}

function normalizeSourceSpan(value: string): string {
  return normalizeText(value).replace(/[\p{P}\p{S}\s]+/gu, '');
}

function normalizeText(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}
