export type CompletedStorySaveResolution =
  | 'discard'
  | 'hydrate-server'
  | 'preserve-local'
  | 'wait';

export function resolveCompletedStorySave<TDraft extends object>(input: {
  latestDraft: TDraft;
  savedId: string;
  savedVersion: number;
  selectedId: string;
  selectedVersion: number;
  submittedDraft: TDraft;
}): CompletedStorySaveResolution {
  if (input.selectedId !== input.savedId) {
    return 'discard';
  }
  if (input.selectedVersion < input.savedVersion) {
    return 'wait';
  }
  return areStoryDraftsEqual(input.latestDraft, input.submittedDraft)
    ? 'hydrate-server'
    : 'preserve-local';
}

function areStoryDraftsEqual<TDraft extends object>(left: TDraft, right: TDraft): boolean {
  const leftKeys = Object.keys(left) as Array<keyof TDraft>;
  const rightKeys = Object.keys(right) as Array<keyof TDraft>;
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.is(left[key], right[key]));
}
