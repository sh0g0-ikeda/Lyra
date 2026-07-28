export function shouldHydrateEditorDraft(input: {
  hasServerSnapshot: boolean;
  hasUnsavedChanges: boolean;
  lastResourceId: string | null;
  resourceId: string | null;
}): boolean {
  if (!input.hasServerSnapshot) {
    return false;
  }
  return (
    input.lastResourceId !== input.resourceId ||
    !input.hasUnsavedChanges
  );
}

export function editorDraftHasUnsavedChanges(input: {
  hasServerSnapshot: boolean;
  lastResourceId: string | null;
  resourceId: string | null;
  valuesDiffer: boolean;
}): boolean {
  return (
    input.hasServerSnapshot &&
    input.lastResourceId === input.resourceId &&
    input.valuesDiffer
  );
}
