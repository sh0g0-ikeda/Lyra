import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PageSettingsSection,
  type PageSettingsSectionHandle,
} from '../src/components/PageSettingsSection';
import type { PageRecord, SceneRecord, UpdatePageSettingsInput } from '../src/lib/api';
import { storyQueryKeys } from '../src/lib/storyQueryKeys';

vi.mock('react-native', () => ({
  ActivityIndicator: 'activity-indicator',
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    onPress?: () => void;
  }) => React.createElement(
    'button',
    { ...props, onClick: onPress },
    typeof children === 'function' ? children({ pressed: false }) : children,
  ),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  TextInput: 'text-input',
  View: 'view',
}));

vi.mock('../src/components/LoadingState', () => ({
  LoadingState: ({ label }: { label: string }) => React.createElement('loading', null, label),
}));

vi.mock('../src/components/Notice', () => ({
  Notice: ({ message, tone }: { message: string; tone?: string }) =>
    React.createElement('notice', { tone }, message),
}));

vi.mock('../src/components/PrimaryButton', () => ({
  PrimaryButton: ({
    disabled,
    label,
    loading,
    onPress,
  }: {
    disabled?: boolean;
    label: string;
    loading?: boolean;
    onPress: () => void;
  }) => React.createElement(
    'button',
    { disabled: disabled || loading, onClick: onPress },
    label,
  ),
}));

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const episodeId = '22222222-2222-4222-8222-222222222222';

describe('PageSettingsSection', () => {
  const mountedRenderers: ReactTestRenderer[] = [];
  const api = { updatePageSettings: vi.fn() };
  const refreshPages = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    refreshPages.mockResolvedValue([buildPage()]);
    api.updatePageSettings.mockImplementation(async (
      pageId: string,
      body: UpdatePageSettingsInput,
    ) => ({
      ...buildPage(),
      id: pageId,
      ...body,
      updated_at: '2026-08-01T00:00:01.000Z',
    }));
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  const renderSection = async ({
    editingBlocked = false,
    pages = [buildPage()],
    ref = createRef<PageSettingsSectionHandle>(),
    resolveDirtyAction,
    scenes = [buildScene()],
  }: {
    editingBlocked?: boolean;
    pages?: PageRecord[];
    ref?: React.RefObject<PageSettingsSectionHandle | null>;
    resolveDirtyAction?: () => Promise<'save' | 'discard' | 'cancel'>;
    scenes?: SceneRecord[];
  } = {}): Promise<{
    queryClient: QueryClient;
    ref: React.RefObject<PageSettingsSectionHandle | null>;
    renderer: ReactTestRenderer;
  }> => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      storyQueryKeys('session-1', organizationId).pages(episodeId),
      { pages },
    );
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <PageSettingsSection
            api={api}
            editingBlocked={editingBlocked}
            episodeId={episodeId}
            language="ja"
            organizationId={organizationId}
            pageListReady
            pages={pages}
            ref={ref}
            refreshPages={refreshPages}
            resolveDirtyAction={resolveDirtyAction}
            scenes={scenes}
            sessionKey="session-1"
          />
        </QueryClientProvider>,
      );
    });
    mountedRenderers.push(renderer!);
    return { queryClient, ref, renderer: renderer! };
  };

  const selectFirstPage = async (renderer: ReactTestRenderer): Promise<void> => {
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページ設定のページ 1を選択',
      }).props.onPress();
      await Promise.resolve();
    });
  };

  it('既存の吹き出し設定値は受け入れるが選択UIを表示しない', async () => {
    const legacyPage = { ...buildPage(), dialogue_mode: 'balloon_only' as const };
    refreshPages.mockResolvedValue([legacyPage]);
    const { renderer } = await renderSection({
      pages: [legacyPage],
    });
    await selectFirstPage(renderer);

    expect(renderer.root.findAllByProps({
      accessibilityLabel: 'セリフを吹き出しだけにする',
    })).toHaveLength(0);
    expect(renderer.root.findAllByProps({
      accessibilityLabel: 'セリフを画像と吹き出しに表示する',
    })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('セリフの表示方法');

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'このページの目的' })
        .props.onChangeText('既存設定を保った新しい目的');
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ設定を保存' }).props.onPress();
      await flushQueries();
    });
    expect(api.updatePageSettings).toHaveBeenCalledWith(
      legacyPage.id,
      { story_page_purpose: '既存設定を保った新しい目的' },
      organizationId,
    );
  });

  it('変更fieldだけをorganization scope付きでsingle-flight保存する', async () => {
    let resolveUpdate: ((page: PageRecord) => void) | undefined;
    api.updatePageSettings.mockReturnValue(new Promise<PageRecord>((resolve) => {
      resolveUpdate = resolve;
    }));
    const { renderer } = await renderSection();
    await selectFirstPage(renderer);

    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページのセリフを非表示にする',
      }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      const save = renderer.root.findByProps({ label: 'ページ設定を保存' });
      save.props.onPress();
      save.props.onPress();
      await flushQueries();
    });

    expect(refreshPages).toHaveBeenCalledTimes(1);
    expect(api.updatePageSettings).toHaveBeenCalledTimes(1);
    expect(api.updatePageSettings).toHaveBeenCalledWith(
      buildPage().id,
      { page_dialogue_toggle: false },
      organizationId,
    );

    await act(async () => {
      resolveUpdate?.({
        ...buildPage(),
        page_dialogue_toggle: false,
        updated_at: '2026-08-01T00:00:01.000Z',
      });
      await flushQueries();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('ページ設定を保存しました');
  });

  it('styleとprovenanceの変更fieldだけを保存しserver compiled styleをcacheへ採用する', async () => {
    api.updatePageSettings.mockResolvedValue({
      ...buildPage(),
      layout_config: {
        style_reference: {
          title: '水彩調',
          notes: '淡い背景',
          compiled_brief: 'server compiled brief',
          compiler_provider: 'openai',
        },
      },
      story_page_purpose: '静かな転換を示す',
      updated_at: '2026-08-01T00:00:04.000Z',
    });
    const { queryClient, renderer } = await renderSection();
    await selectFirstPage(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '画風リファレンス名' })
        .props.onChangeText('  水彩調  ');
      renderer.root.findByProps({ accessibilityLabel: '画風リファレンスの補足' })
        .props.onChangeText('  淡い背景  ');
      renderer.root.findByProps({ accessibilityLabel: 'このページの目的' })
        .props.onChangeText('  静かな転換を示す  ');
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ設定を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.updatePageSettings).toHaveBeenCalledWith(
      buildPage().id,
      {
        story_page_purpose: '静かな転換を示す',
        style_reference: {
          notes: '淡い背景',
          title: '水彩調',
        },
      },
      organizationId,
    );
    expect(queryClient.getQueryData<{ pages: PageRecord[] }>(
      storyQueryKeys('session-1', organizationId).pages(episodeId),
    )?.pages[0]?.layout_config).toMatchObject({
      style_reference: {
        compiled_brief: 'server compiled brief',
        title: '水彩調',
      },
    });
  });

  it('source sceneは保存ID順で表示し不明IDも黙って捨てない', async () => {
    const knownScene = buildScene();
    const missingSceneId = '77777777-7777-4777-8777-777777777777';
    const { renderer } = await renderSection({
      pages: [{
        ...buildPage(),
        story_source_scene_ids: [knownScene.id, missingSceneId],
      }],
      scenes: [knownScene, {
        ...knownScene,
        id: missingSceneId,
        episode_id: '88888888-8888-4888-8888-888888888888',
      }],
    });
    await selectFirstPage(renderer);

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain('シーン 2: 屋上');
    expect(rendered).toContain('不明または削除済みのシーン');
  });

  it('style titleなしでnotesだけある場合は再取得もPUTもせずdraftを保持する', async () => {
    const pageWithoutStyle = { ...buildPage(), layout_config: {} };
    const { renderer } = await renderSection({ pages: [pageWithoutStyle] });
    await selectFirstPage(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '画風リファレンスの補足' })
        .props.onChangeText('補足だけ');
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ設定を保存' }).props.onPress();
      await flushQueries();
    });

    expect(refreshPages).not.toHaveBeenCalled();
    expect(api.updatePageSettings).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: '画風リファレンスの補足' }).props.value)
      .toBe('補足だけ');
    expect(JSON.stringify(renderer.toJSON())).toContain('補足を保存するには画風リファレンス名が必要です');
  });

  it('対象設定がremote変更された場合はstale保存を拒否してdraftを保持する', async () => {
    refreshPages.mockResolvedValue([{
      ...buildPage(),
      dialogue_mode: 'mixed',
      updated_at: '2026-08-01T00:00:02.000Z',
    }]);
    const { renderer } = await renderSection();
    await selectFirstPage(renderer);
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページのセリフを非表示にする',
      }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ設定を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.updatePageSettings).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({
      accessibilityLabel: 'ページのセリフを表示する',
    }).props.accessibilityState).toMatchObject({ selected: false });
    expect(JSON.stringify(renderer.toJSON())).toContain('別の処理でページ設定が更新されました');
  });

  it('source sceneがremote変更された場合は古いpurposeの保存を拒否してdraftを保持する', async () => {
    refreshPages.mockResolvedValue([{
      ...buildPage(),
      story_source_scene_ids: ['77777777-7777-4777-8777-777777777777'],
      updated_at: '2026-08-01T00:00:02.000Z',
    }]);
    const { renderer } = await renderSection();
    await selectFirstPage(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'このページの目的' })
        .props.onChangeText('未保存の新しい目的');
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ設定を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.updatePageSettings).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: 'このページの目的' }).props.value)
      .toBe('未保存の新しい目的');
    expect(JSON.stringify(renderer.toJSON())).toContain('別の処理でページ設定が更新されました');
  });

  it('対象設定が同じなら無関係なupdated_at変更後も保存できる', async () => {
    refreshPages.mockResolvedValue([{
      ...buildPage(),
      panel_count: 3,
      updated_at: '2026-08-01T00:00:02.000Z',
    }]);
    const { renderer } = await renderSection();
    await selectFirstPage(renderer);
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページのセリフを非表示にする',
      }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ設定を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.updatePageSettings).toHaveBeenCalledWith(
      buildPage().id,
      { page_dialogue_toggle: false },
      organizationId,
    );
  });

  it.each(['confirmed', 'generating'] as const)('%s Pageはread-onlyで保存しない', async (status) => {
    const { renderer } = await renderSection({ pages: [{ ...buildPage(), status }] });
    await selectFirstPage(renderer);

    expect(renderer.root.findByProps({ accessibilityLabel: '画風リファレンス名' }).props.editable)
      .toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: 'このページの目的' }).props.editable)
      .toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: '次ページへ引き継ぐ連続性メモ' }).props.editable)
      .toBe(false);
    expect(renderer.root.findByProps({ label: 'ページ設定を保存' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('このページは現在編集できません');
    expect(api.updatePageSettings).not.toHaveBeenCalled();
  });

  it('job状態を安全に確認できない間は編集と保存を止める', async () => {
    const { renderer } = await renderSection({ editingBlocked: true });
    await selectFirstPage(renderer);

    expect(renderer.root.findByProps({
      accessibilityLabel: 'ページのセリフを非表示にする',
    }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(renderer.root.findByProps({ accessibilityLabel: '画風リファレンス名' }).props.editable)
      .toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: 'このページの目的' }).props.editable)
      .toBe(false);
    expect(renderer.root.findByProps({ label: 'ページ設定を保存' }).props.disabled).toBe(true);
    expect(api.updatePageSettings).not.toHaveBeenCalled();
  });

  it('dirtyのPage切替でcancelは保持しdiscardだけ次のPageへ進む', async () => {
    const second = { ...buildPage(), id: '33333333-3333-4333-8333-333333333333', page_number: 2 };
    const resolveDirtyAction = vi.fn()
      .mockResolvedValueOnce('cancel' as const)
      .mockResolvedValueOnce('discard' as const);
    const { renderer } = await renderSection({
      pages: [buildPage(), second],
      resolveDirtyAction,
    });
    await selectFirstPage(renderer);
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページのセリフを非表示にする',
      }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページ設定のページ 2を選択',
      }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({
      accessibilityLabel: 'ページ設定のページ 1を選択',
    }).props.accessibilityState).toEqual({ selected: true });

    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページ設定のページ 2を選択',
      }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({
      accessibilityLabel: 'ページ設定のページ 2を選択',
    }).props.accessibilityState).toEqual({ selected: true });
  });

  it('別episodeのsuccess responseを採用せずdraftを保持する', async () => {
    api.updatePageSettings.mockResolvedValue({
      ...buildPage(),
      episode_id: '44444444-4444-4444-8444-444444444444',
      dialogue_mode: 'balloon_only',
    });
    const { ref, renderer } = await renderSection({
      resolveDirtyAction: vi.fn().mockResolvedValue('save' as const),
    });
    await selectFirstPage(renderer);
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページのセリフを非表示にする',
      }).props.onPress();
      await Promise.resolve();
    });

    let canLeave: boolean | undefined;
    await act(async () => {
      canLeave = await ref.current?.prepareToLeave();
      await flushQueries();
    });
    expect(canLeave).toBe(false);
    expect(renderer.root.findByProps({
      accessibilityLabel: 'ページのセリフを表示する',
    }).props.accessibilityState).toMatchObject({ selected: false });
    expect(JSON.stringify(renderer.toJSON())).toContain('ページ設定を保存できませんでした');
  });

  it.each([
    {
      label: 'episode',
      nextEpisodeId: '44444444-4444-4444-8444-444444444444',
      nextOrganizationId: organizationId,
      nextSessionKey: 'session-1',
    },
    {
      label: 'session',
      nextEpisodeId: episodeId,
      nextOrganizationId: organizationId,
      nextSessionKey: 'session-2',
    },
    {
      label: 'organization',
      nextEpisodeId: episodeId,
      nextOrganizationId: '66666666-6666-4666-8666-666666666666',
      nextSessionKey: 'session-1',
    },
  ] as const)('$label scope切替後に完了した古い保存で新旧cacheを更新しない', async ({
    nextEpisodeId,
    nextOrganizationId,
    nextSessionKey,
  }) => {
    let resolveUpdate: ((page: PageRecord) => void) | undefined;
    api.updatePageSettings.mockReturnValue(new Promise<PageRecord>((resolve) => {
      resolveUpdate = resolve;
    }));
    const { queryClient, renderer } = await renderSection();
    await selectFirstPage(renderer);
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ページのセリフを非表示にする',
      }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'ページ設定を保存' }).props.onPress();
      await flushQueries();
    });
    expect(api.updatePageSettings).toHaveBeenCalledOnce();

    const nextPage = {
      ...buildPage(),
      id: '55555555-5555-4555-8555-555555555555',
      episode_id: nextEpisodeId,
    };
    await act(async () => {
      renderer.update(
        <QueryClientProvider client={queryClient}>
          <PageSettingsSection
            api={api}
            editingBlocked={false}
            episodeId={nextEpisodeId}
            language="ja"
            organizationId={nextOrganizationId}
            pageListReady
            pages={[nextPage]}
            refreshPages={refreshPages}
            scenes={[buildScene()]}
            sessionKey={nextSessionKey}
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      resolveUpdate?.({
        ...buildPage(),
        dialogue_mode: 'balloon_only',
        updated_at: '2026-08-01T00:00:03.000Z',
      });
      await flushQueries();
    });

    expect(queryClient.getQueryData<{ pages: PageRecord[] }>(
      storyQueryKeys('session-1', organizationId).pages(episodeId),
    )?.pages[0]?.dialogue_mode).toBe('image_baked');
    expect(queryClient.getQueryData(
      storyQueryKeys(nextSessionKey, nextOrganizationId).pages(nextEpisodeId),
    )).toBeUndefined();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('ページ設定を保存しました');
  });
});

async function flushQueries(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function buildPage(): PageRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    episode_id: episodeId,
    page_number: 1,
    layout_config: {
      style_reference: {
        title: '劇画調',
        notes: '硬質な都市背景',
      },
    },
    story_source_scene_ids: [],
    story_page_purpose: '屋上の危機を示す',
    story_continuity_note: '雨は次のページまで続く',
    dialogue_mode: 'image_baked',
    page_dialogue_toggle: true,
    generation_mode: null,
    generated_image: null,
    status: 'designing',
    panel_count: 2,
    frame_count: 2,
    balloon_count: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function buildScene(): SceneRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    episode_id: episodeId,
    order: 2,
    location: '屋上',
    time: null,
    atmosphere: null,
    involved_entity_ids: [],
    entity_states: [],
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}
