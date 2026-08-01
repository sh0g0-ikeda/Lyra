export interface StoryEditorDirtyFlags {
  work: boolean;
  chapter: boolean;
  episode: boolean;
  scene: boolean;
}

export type EntityDirtySaveIntent = 'create' | 'update';

export function storyEditorIsDirty(flags: StoryEditorDirtyFlags): boolean {
  return flags.work || flags.chapter || flags.episode || flags.scene;
}

export function entityDirtySaveIntent(input: {
  dirty: boolean;
  selectedEntityId: string | null;
}): EntityDirtySaveIntent | null {
  if (!input.dirty) {
    return null;
  }
  return input.selectedEntityId === null ? 'create' : 'update';
}
