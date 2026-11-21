export interface SavedPageDraftRevision {
  readonly submittedRevision: string;
}

// A quote may proceed only after every requested draft write has resolved. The
// receipt records that exact submitted payload; render-delayed dirty flags are
// not save evidence, while a changed revision reliably identifies later edits,
// page switches, and server-canonicalized values that need another review.
export function acknowledgeSavedPageDraftRevision(
  submittedRevision: string,
): SavedPageDraftRevision {
  return { submittedRevision };
}

export function isSavedPageDraftRevisionCurrent(
  receipt: SavedPageDraftRevision | null,
  currentRevision: string,
): boolean {
  return receipt?.submittedRevision === currentRevision;
}
