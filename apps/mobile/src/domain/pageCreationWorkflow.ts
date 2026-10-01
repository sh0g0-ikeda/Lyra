export type PageCreationStep = 'design' | 'settings' | 'create';
export const pageCreationSteps: readonly PageCreationStep[] = ['design', 'settings', 'create'];

// Read-only resume policy; selecting a step never saves, autofills, or generates.
export function inferPageCreationStep(input: { hasPage: boolean; hasFrames: boolean; hasSettings: boolean; hasImage: boolean }): PageCreationStep {
  if (!input.hasPage) return 'design';
  if (input.hasImage || input.hasSettings) return 'create';
  return input.hasFrames ? 'settings' : 'design';
}

export function nextPageInSequence<T extends { id: string; page_number: number }>(pages: readonly T[], selectedId: string | null): T | null {
  const ordered = [...pages].sort((left, right) => left.page_number - right.page_number);
  const index = ordered.findIndex((page) => page.id === selectedId);
  return index < 0 ? null : ordered[index + 1] ?? null;
}
