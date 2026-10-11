import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceHierarchyNavigator } from '@/components/WorkspaceHierarchyNavigator';
import type { WorkspaceContextData } from '@/components/WorkspaceContextPicker';

vi.mock('react-native', () => ({
  Pressable: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('pressable', props, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));
vi.mock('lucide-react-native', () => ({ BookOpen: 'book-open', ChevronRight: 'chevron-right' }));
vi.mock('@/components/ActionableErrorNotice', () => ({ ActionableErrorNotice: () => null }));
vi.mock('@/components/StoryHierarchySheet', () => ({ StoryHierarchySheet: (props: Record<string, unknown>) => React.createElement('hierarchy', props) }));
vi.mock('@/navigation/navigationRef', () => ({ navigationRef: { isReady: () => false } }));
const { appState, resolveDirtyEditors, updateSelection } = vi.hoisted(() => ({
  appState: { canEdit: false },
  resolveDirtyEditors: vi.fn(),
  updateSelection: vi.fn()
}));
vi.mock('@/state/dirtyState', () => ({ useDirtyState: () => ({ resolveDirtyEditors }) }));
vi.mock('@/state/appState', () => ({
  useAppState: () => ({
    api: {}, hasCapability: (capability: string) => capability === 'edit_work' && appState.canEdit, language: 'ja', logout: vi.fn(), session: null, sessionKey: 'session',
    selection: { organizationId: null, workId: 'work-1', chapterId: 'chapter-1', episodeId: 'episode-1' }, updateSelection
  })
}));

const context = {
  works: [{ id: 'work-1', organization_id: null, title: 'とても長い作品名'.repeat(12), genre: null, world_setting: null, theme: null, main_entity_ids: [], starting_point: null, ending_point: null, overall_flow: null, version: 1, status: 'draft', created_at: '', updated_at: '' }],
  chapters: [{ id: 'chapter-1', work_id: 'work-1', order: 1, title: 'とても長い章名'.repeat(12), purpose: null, starting_state: null, ending_state: null, emotion_curve: null, entities_involved: [], key_beats: [], version: 1, status: 'draft', created_at: '', updated_at: '' }],
  episodes: [{ id: 'episode-1', chapter_id: 'chapter-1', order: 1, title: '第1話: 必ず表示される話名', purpose: null, story_input_mode: 'structured', story_full_draft: null, introduction: null, middle: null, climax: null, ending_hook: null, estimated_pages: 1, entities_involved: [], page_skeleton_generated: false, version: 1, status: 'draft', created_at: '', updated_at: '' }],
  error: null, isLoadingWorks: false, isLoadingChapters: false, isLoadingEpisodes: false, hasMoreWorks: false, isFetchingMoreWorks: false, loadMoreWorks: vi.fn(), retry: vi.fn(), selectedWorkId: 'work-1', selectedChapterId: 'chapter-1', selectedEpisodeId: 'episode-1'
} satisfies WorkspaceContextData;

describe('WorkspaceHierarchyNavigator', () => {
  beforeEach(() => {
    appState.canEdit = false;
    resolveDirtyEditors.mockReset().mockResolvedValue(true);
    updateSelection.mockReset().mockResolvedValue(true);
  });
  it('長い作品名と章名があっても話名をprimary行に残す', () => {
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<WorkspaceHierarchyNavigator context={context} />); });
    expect(renderer!.root.findByProps({ testID: 'workspace-current-episode' }).props.children).toBe('第1話: 必ず表示される話名');
    expect(renderer!.root.findByProps({ testID: 'workspace-current-context' }).props.children).toContain('とても長い作品名');
  });
  it('制作中の階層にも読み込みとエラーと再試行を渡す', () => {
    const value = { ...context, works: [], isLoadingWorks: true, error: new Error('temporarily unavailable') };
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<WorkspaceHierarchyNavigator context={value} />); });
    const sheet = renderer!.root.findByType('hierarchy');
    expect(sheet.props.isLoadingWorks).toBe(true);
    expect(sheet.props.hierarchyError).toBe(value.error);
    expect(sheet.props.onRetryHierarchy).toBe(value.retry);
    act(() => { renderer!.unmount(); });
  });

  it('制作画面からの作品削除もdirty確認後に選択を再確認なしで解除する', async () => {
    appState.canEdit = true;
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<WorkspaceHierarchyNavigator context={context} />); });
    await act(async () => renderer!.root.findByType('pressable').props.onPress());
    const sheet = renderer!.root.findByType('hierarchy');
    await expect(sheet.props.onBeforeWorkDelete('work-1')).resolves.toBe(true);
    await act(async () => sheet.props.onWorkDeletionAccepted({
      deletion_id: '11111111-1111-4111-8111-111111111111',
      work_id: 'work-1',
      status: 'pending',
      blocker_code: null
    }));

    expect(resolveDirtyEditors).toHaveBeenCalledWith('ja');
    expect(updateSelection).toHaveBeenLastCalledWith(
      { workId: null, chapterId: null, episodeId: null, pageId: null, entityId: null },
      { skipDirtyCheck: true }
    );
  });

});
