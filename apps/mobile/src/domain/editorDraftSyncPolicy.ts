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
