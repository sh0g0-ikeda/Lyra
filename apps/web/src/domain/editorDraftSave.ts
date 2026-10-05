function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function reconcileSavedEditorDraft<TDraft extends object>(
  current: TDraft,
  submitted: TDraft,
  authoritative: TDraft,
  previousBaseline: TDraft,
  omittedFields: readonly (keyof TDraft)[] = [],
): { draft: TDraft; baseline: TDraft } {
  if (!sameJsonValue(current, submitted)) {
    return { draft: current, baseline: authoritative };
  }

  const draft = structuredClone(authoritative);
  for (const field of omittedFields) {
    if (!sameJsonValue(submitted[field], previousBaseline[field])) {
      draft[field] = submitted[field];
    }
  }

  return { draft, baseline: authoritative };
}

export function isOlderEditorRevision(incoming: string, baseline: string): boolean {
  const incomingTimestamp = Date.parse(incoming);
  const baselineTimestamp = Date.parse(baseline);

  return Number.isFinite(incomingTimestamp) && Number.isFinite(baselineTimestamp) && incomingTimestamp < baselineTimestamp;
}
