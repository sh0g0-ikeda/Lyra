// Explicit reload must apply even when React Query retains an identical object.
// A late response may never replace a different user's/workspace's entity draft.
export async function reloadCharacterSnapshot<T>(input: {
  scope: string;
  getCurrentScope: () => string;
  load: () => Promise<T>;
  apply: (snapshot: T) => void;
}): Promise<boolean> {
  const snapshot = await input.load();
  if (input.getCurrentScope() !== input.scope) return false;
  input.apply(snapshot);
  return true;
}
