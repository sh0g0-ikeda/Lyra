export function sameStoryDraft<TDraft extends object>(left: TDraft, right: TDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Preserve edits made after submission and membership omitted by generation autosave.
export function reconcileSavedStoryDraft<TDraft extends { entities_involved: string }>(
  current: TDraft,
  submitted: TDraft,
  saved: TDraft,
  previousBaseline: TDraft,
  fullSave: boolean,
): { draft: TDraft; baseline: TDraft } {
  const membershipWasDirty = submitted.entities_involved !== previousBaseline.entities_involved;
  if (sameStoryDraft(current, submitted)) {
    const draft = !fullSave && membershipWasDirty
      ? { ...saved, entities_involved: current.entities_involved }
      : saved;
    return { draft, baseline: saved };
  }
  if (!fullSave && !membershipWasDirty && current.entities_involved === submitted.entities_involved) {
    return { draft: { ...current, entities_involved: saved.entities_involved }, baseline: saved };
  }
  return { draft: current, baseline: saved };
}
