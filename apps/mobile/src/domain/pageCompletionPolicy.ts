import type { RemoteImageSource } from '@/domain/imageSourceCandidates';
export interface PageCompletionContext {
  targetKey: string;
  focused: boolean;
  foreground: boolean;
  dirty: boolean;
  presentationBusy: boolean;
}
export interface CompletedPageResult { jobId: string; targetKey: string; pageId: string; pageNumber: number; imageSources?: readonly RemoteImageSource[]; }
export function canPresentPageCompletion(result: CompletedPageResult, context: PageCompletionContext): boolean {
  return result.targetKey === context.targetKey && context.focused && context.foreground && !context.dirty && !context.presentationBusy;
}
