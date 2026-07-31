import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EntityStateSection,
  type EntityStateSectionHandle,
} from '../src/components/EntityStateSection';
import type {
  ChapterRecord,
  CreateEntityStateInput,
  EntityRecord,
  EntityStateRecord,
  EpisodeRecord,
  SceneRecord,
  UpdateEntityStateInput,
} from '../src/lib/api';
import { storyQueryKeys } from '../src/lib/storyQueryKeys';

vi.mock('react-native', () => ({
  ActivityIndicator: 'activity-indicator',
  Pressable: ({ children, onPress, ...props }: {
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
  PrimaryButton: ({ disabled, label, loading, onPress }: {
    disabled?: boolean;
    label: string;
    loading?: boolean;
    onPress: () => void;
  }) => React.createElement(
    'button',
    { disabled: disabled || loading, label, onClick: onPress },
    label,
  ),
}));

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('EntityStateSection', () => {
  const mountedRenderers: ReactTestRenderer[] = [];
  const api = {
    createEntityState: vi.fn(),
    getChapters: vi.fn(),
    getEntityStates: vi.fn(),
    getEpisodes: vi.fn(),
    getScenes: vi.fn(),
    updateEntityState: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.getEntityStates.mockResolvedValue({ entity_states: [buildState()] });
    api.getChapters.mockResolvedValue({ chapters: [buildChapter()] });
    api.getEpisodes.mockResolvedValue({ episodes: [buildEpisode()] });
    api.getScenes.mockResolvedValue({ scenes: [buildScene()] });
    api.createEntityState.mockImplementation(async (
      entityId: string,
      body: CreateEntityStateInput,
    ) => ({
      ...buildState(),
      id: '99999999-9999-4999-8999-999999999999',
      entity_id: entityId,
      scene_id: body.scene_id ?? null,
      costume_note: body.costume_note ?? null,
      costume_ref_id: null,
      condition_note: body.condition_note ?? null,
      hair_note: body.hair_note ?? null,
      expression_default: body.expression_default,
      extra_note: body.extra_note ?? null,
    }));
    api.updateEntityState.mockImplementation(async (
      entityId: string,
      stateId: string,
      body: UpdateEntityStateInput,
    ) => ({
      ...buildState(),
      ...body,
      id: stateId,
      entity_id: entityId,
    }));
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of mountedRenderers.splice(0)) renderer.unmount();
    });
  });

  async function renderSection({
    entity = buildEntity(),
    onOperationActiveChange,
    ref = createRef<EntityStateSectionHandle>(),
    resolveDirtyAction,
    sessionKey = 'session-1',
  }: {
    entity?: EntityRecord;
    onOperationActiveChange?: (operationId: string, active: boolean) => void;
    ref?: React.RefObject<EntityStateSectionHandle | null>;
    resolveDirtyAction?: () => Promise<'save' | 'discard' | 'cancel'>;
    sessionKey?: string;
  } = {}): Promise<{
    queryClient: QueryClient;
    ref: React.RefObject<EntityStateSectionHandle | null>;
    renderer: ReactTestRenderer;
    rerender(next: { entity?: EntityRecord; sessionKey?: string }): Promise<void>;
  }> {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let currentEntity = entity;
    let currentSessionKey = sessionKey;
    let renderer: ReactTestRenderer;
    const element = (): React.ReactElement => (
      <QueryClientProvider client={queryClient}>
        <EntityStateSection
          api={api}
          editingBlocked={false}
          entity={currentEntity}
          language="ja"
          onOperationActiveChange={onOperationActiveChange}
          organizationId={organizationId}
          ref={ref}
          resolveDirtyAction={resolveDirtyAction}
          sessionKey={currentSessionKey}
        />
      </QueryClientProvider>
    );
    await act(async () => {
      renderer = create(element());
    });
    await act(async () => {
      await flushQueries();
    });
    mountedRenderers.push(renderer!);
    return {
      queryClient,
      ref,
      renderer: renderer!,
      rerender: async (next) => {
        currentEntity = next.entity ?? currentEntity;
        currentSessionKey = next.sessionKey ?? currentSessionKey;
        await act(async () => {
          renderer!.update(element());
          await flushQueries();
        });
      },
    };
  }

  it('0件を正常emptyとして表示し取得失敗だけ再試行可能にする', async () => {
    api.getEntityStates.mockResolvedValueOnce({ entity_states: [] });
    const empty = await renderSection();

    expect(textOf(empty.renderer)).toContain('保存済みの服装・状態はありません');
    expect(textOf(empty.renderer)).not.toContain('服装・状態を読み込めませんでした');

    api.getEntityStates.mockRejectedValueOnce(new Error('network'));
    const failed = await renderSection({ sessionKey: 'session-2' });
    expect(textOf(failed.renderer)).toContain('服装・状態を読み込めませんでした');
    expect(failed.renderer.root.findByProps({ label: '服装・状態を再試行' })).toBeDefined();
  });

  it('同一workのSceneを選びcostume_ref_idなしでorganization scopeへ一度だけ作成する', async () => {
    api.getEntityStates.mockResolvedValue({ entity_states: [] });
    let resolveCreate: ((state: EntityStateRecord) => void) | undefined;
    api.createEntityState.mockReturnValue(new Promise<EntityStateRecord>((resolve) => {
      resolveCreate = resolve;
    }));
    const onOperationActiveChange = vi.fn();
    const { queryClient, renderer } = await renderSection({ onOperationActiveChange });
    queryClient.setQueryData(
      storyQueryKeys('session-1', organizationId).scenes(buildEpisode().id),
      { scenes: [buildScene()] },
    );
    await press(renderer, '新しい服装・状態');
    await press(renderer, 'シーン候補を読み込む');

    expect(api.getChapters).toHaveBeenCalledWith(buildEntity().work_id, organizationId);
    expect(api.getEpisodes).toHaveBeenCalledWith(buildChapter().id, organizationId);
    expect(api.getScenes).toHaveBeenCalledWith(buildEpisode().id, organizationId);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '第1章 / 第1話 / シーン1: ベーカー街を選択' })
        .props.onPress();
      renderer.root.findByProps({ accessibilityLabel: '服装' }).props.onChangeText('  黒い外套  ');
      renderer.root.findByProps({ accessibilityLabel: '通常の表情' }).props.onChangeText('  calm  ');
    });
    await act(async () => {
      const button = renderer.root.findByProps({ label: '服装・状態を作成' });
      button.props.onPress();
      button.props.onPress();
      await flushQueries();
    });

    expect(api.createEntityState).toHaveBeenCalledOnce();
    expect(api.createEntityState).toHaveBeenCalledWith(
      buildEntity().id,
      {
        scene_id: buildScene().id,
        costume_note: '黒い外套',
        condition_note: null,
        hair_note: null,
        expression_default: 'calm',
        extra_note: null,
      },
      organizationId,
    );
    expect(api.createEntityState.mock.calls[0]?.[1]).not.toHaveProperty('costume_ref_id');
    expect(onOperationActiveChange).toHaveBeenCalledWith(expect.any(String), true);

    await act(async () => {
      resolveCreate?.({
        ...buildState(),
        id: '99999999-9999-4999-8999-999999999999',
        scene_id: buildScene().id,
        costume_note: '黒い外套',
        costume_ref_id: null,
        condition_note: null,
        hair_note: null,
        expression_default: 'calm',
        extra_note: null,
      });
      await flushQueries();
    });
    expect(onOperationActiveChange).toHaveBeenCalledWith(expect.any(String), false);
    expect(queryClient.getQueryData<{ entity_states: EntityStateRecord[] }>(
      storyQueryKeys('session-1', organizationId).entityStates(buildEntity().id),
    )?.entity_states).toHaveLength(1);
    expect(queryClient.getQueryState(
      storyQueryKeys('session-1', organizationId).scenes(buildEpisode().id),
    )?.isInvalidated).toBe(true);
  });

  it('Scene関連作成後のcache無効化が失敗しても作成成功を失敗扱いしない', async () => {
    api.getEntityStates.mockResolvedValue({ entity_states: [] });
    const { queryClient, renderer } = await renderSection();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('cache failure'));
    await press(renderer, '新しい服装・状態');
    await press(renderer, 'シーン候補を読み込む');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '第1章 / 第1話 / シーン1: ベーカー街を選択' })
        .props.onPress();
    });
    await press(renderer, '服装・状態を作成');

    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(textOf(renderer)).toContain('服装・状態を作成しました');
    expect(textOf(renderer)).not.toContain('作成結果を確認できませんでした');
    expect(queryClient.getQueryData<{ entity_states: EntityStateRecord[] }>(
      storyQueryKeys('session-1', organizationId).entityStates(buildEntity().id),
    )?.entity_states).toHaveLength(1);
  });

  it('更新前にremote snapshotを確認し変更fieldだけ保存してcostume refを保持する', async () => {
    const { renderer } = await renderSection();
    await selectState(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '髪の状態' })
        .props.onChangeText('  乾いた短髪  ');
    });
    await press(renderer, '服装・状態を保存');

    expect(api.getEntityStates).toHaveBeenCalledTimes(2);
    expect(api.updateEntityState).toHaveBeenCalledWith(
      buildEntity().id,
      buildState().id,
      { hair_note: '乾いた短髪' },
      organizationId,
    );
    expect(api.updateEntityState.mock.calls[0]?.[2]).not.toHaveProperty('costume_ref_id');
    expect(textOf(renderer)).toContain('服装・状態を保存しました');
  });

  it('更新応答で未変更のcostume refが欠落した場合はcacheへ採用せずdraftを保持する', async () => {
    api.updateEntityState.mockResolvedValue({
      ...buildState(),
      costume_ref_id: null,
      hair_note: '乾いた短髪',
    });
    const { queryClient, renderer } = await renderSection();
    await selectState(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '髪の状態' })
        .props.onChangeText('乾いた短髪');
    });
    await press(renderer, '服装・状態を保存');

    expect(textOf(renderer)).toContain('服装・状態を保存できませんでした');
    expect(renderer.root.findByProps({ accessibilityLabel: '髪の状態' }).props.value)
      .toBe('乾いた短髪');
    expect(queryClient.getQueryData<{ entity_states: EntityStateRecord[] }>(
      storyQueryKeys('session-1', organizationId).entityStates(buildEntity().id),
    )?.entity_states).toEqual([buildState()]);
  });

  it('Scene関連を変えないEntity state保存ではScene cacheを無効化しない', async () => {
    const { queryClient, renderer } = await renderSection();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    await selectState(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '髪の状態' })
        .props.onChangeText('乾いた短髪');
    });
    await press(renderer, '服装・状態を保存');

    expect(textOf(renderer)).toContain('服装・状態を保存しました');
    expect(textOf(renderer)).not.toContain('服装・状態を保存できませんでした');
    expect(renderer.root.findByProps({ accessibilityLabel: '髪の状態' }).props.value)
      .toBe('乾いた短髪');
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('保存前にremote変更を見つけた場合はPUTせずdraftを保持する', async () => {
    api.getEntityStates
      .mockResolvedValueOnce({ entity_states: [buildState()] })
      .mockResolvedValueOnce({
        entity_states: [{ ...buildState(), costume_note: '別端末の服装' }],
      });
    const { renderer } = await renderSection();
    await selectState(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '髪の状態' })
        .props.onChangeText('乾いた短髪');
    });
    await press(renderer, '服装・状態を保存');

    expect(api.updateEntityState).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain('別の処理で服装・状態が更新されました');
    expect(renderer.root.findByProps({ accessibilityLabel: '髪の状態' }).props.value)
      .toBe('乾いた短髪');
  });

  it('POST結果不明では自動再送せず明示再読込まで作成を止める', async () => {
    api.getEntityStates.mockResolvedValue({ entity_states: [] });
    api.createEntityState.mockRejectedValue(new Error('response lost'));
    const { renderer } = await renderSection();
    await press(renderer, '新しい服装・状態');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '服装' }).props.onChangeText('黒い外套');
    });
    await press(renderer, '服装・状態を作成');

    expect(api.createEntityState).toHaveBeenCalledOnce();
    expect(textOf(renderer)).toContain('作成結果を確認できませんでした');
    expect(renderer.root.findByProps({ label: '最新の服装・状態を確認' })).toBeDefined();
  });

  it('作成応答が別entityを指す場合はcacheへ採用せず結果不明として再送を止める', async () => {
    api.getEntityStates.mockResolvedValue({ entity_states: [] });
    api.createEntityState.mockResolvedValue({
      ...buildState(),
      id: '99999999-9999-4999-8999-999999999999',
      entity_id: '66666666-6666-4666-8666-666666666666',
      scene_id: null,
      costume_note: '黒い外套',
      condition_note: null,
      hair_note: null,
      expression_default: 'neutral',
      extra_note: null,
    });
    const { queryClient, renderer } = await renderSection();
    await press(renderer, '新しい服装・状態');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '服装' }).props.onChangeText('黒い外套');
    });
    await press(renderer, '服装・状態を作成');

    expect(api.createEntityState).toHaveBeenCalledOnce();
    expect(textOf(renderer)).toContain('作成結果を確認できませんでした');
    expect(queryClient.getQueryData<{ entity_states: EntityStateRecord[] }>(
      storyQueryKeys('session-1', organizationId).entityStates(buildEntity().id),
    )?.entity_states).toEqual([]);
  });

  it('選択中の状態が再取得結果から消えてもdraftを保持して警告する', async () => {
    const { queryClient, renderer } = await renderSection();
    await selectState(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '髪の状態' })
        .props.onChangeText('乾いた短髪');
      queryClient.setQueryData(
        storyQueryKeys('session-1', organizationId).entityStates(buildEntity().id),
        { entity_states: [] },
      );
      await flushQueries();
    });

    expect(textOf(renderer)).toContain('別の処理で服装・状態が更新されました');
    expect(renderer.root.findByProps({ accessibilityLabel: '髪の状態' }).props.value)
      .toBe('乾いた短髪');
  });

  it.each([
    ['cancel', false, '乾いた短髪'],
    ['discard', true, '雨で濡れている'],
    ['save', true, '乾いた短髪'],
  ] as const)('dirty状態で%sを選ぶと遷移契約を守る', async (
    action,
    expected,
    expectedValue,
  ) => {
    const ref = createRef<EntityStateSectionHandle>();
    const { renderer } = await renderSection({
      ref,
      resolveDirtyAction: vi.fn().mockResolvedValue(action),
    });
    await selectState(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '髪の状態' })
        .props.onChangeText('乾いた短髪');
    });

    let result: boolean | undefined;
    await act(async () => {
      result = await ref.current?.prepareToLeave();
      await flushQueries();
    });
    expect(result).toBe(expected);
    expect(renderer.root.findByProps({ accessibilityLabel: '髪の状態' }).props.value)
      .toBe(expectedValue);
    if (action === 'save') expect(api.updateEntityState).toHaveBeenCalledOnce();
    else expect(api.updateEntityState).not.toHaveBeenCalled();
  });

  it('別workのScene chainは候補に採用せず共通状態だけ作成可能にする', async () => {
    api.getChapters.mockResolvedValue({
      chapters: [{ ...buildChapter(), work_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
    });
    api.getEntityStates.mockResolvedValue({ entity_states: [] });
    const { renderer } = await renderSection();
    await press(renderer, '新しい服装・状態');
    await press(renderer, 'シーン候補を読み込む');

    expect(textOf(renderer)).toContain('シーン候補を読み込めませんでした');
    expect(textOf(renderer)).not.toContain('第1章 / 第1話 / シーン1: ベーカー街');
    await press(renderer, '服装・状態を作成');
    expect(api.createEntityState).toHaveBeenCalledWith(
      buildEntity().id,
      expect.objectContaining({ scene_id: null }),
      organizationId,
    );
  });
});

async function selectState(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: '状態1: 黒い外套を選択' })
      .props.onPress();
  });
}

async function press(renderer: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => {
    const button = renderer.root.findByProps({ label });
    (button.props.onPress ?? button.props.onClick)();
    await flushQueries();
  });
}

async function flushQueries(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function textOf(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

function buildEntity(): EntityRecord {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    work_id: '22222222-2222-4222-8222-222222222222',
    entity_type: 'character',
    name: 'ホームズ',
    free_description: null,
    structured_fields: {},
    prompt_supplement: null,
    speech_profile: {},
    status: 'ready',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function buildState(): EntityStateRecord {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    entity_id: buildEntity().id,
    scene_id: buildScene().id,
    costume_note: '黒い外套',
    costume_ref_id: 'reference-1',
    condition_note: '左腕を負傷',
    hair_note: '雨で濡れている',
    expression_default: 'determined',
    extra_note: null,
    created_at: '2026-08-01T00:00:00.000Z',
  };
}

function buildChapter(): ChapterRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    work_id: buildEntity().work_id,
    order: 1,
    title: '第一章',
    purpose: null,
    starting_state: null,
    ending_state: null,
    emotion_curve: null,
    entities_involved: [],
    key_beats: [],
    version: 1,
    status: 'draft',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function buildEpisode(): EpisodeRecord {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    chapter_id: buildChapter().id,
    order: 1,
    title: '第一話',
    purpose: null,
    story_input_mode: 'full',
    story_full_draft: null,
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    estimated_pages: 1,
    entities_involved: [],
    page_skeleton_generated: false,
    version: 1,
    status: 'draft',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}

function buildScene(): SceneRecord {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    episode_id: buildEpisode().id,
    order: 1,
    location: 'ベーカー街',
    time: '夜',
    atmosphere: null,
    involved_entity_ids: [],
    entity_states: [],
    status: 'draft',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  };
}
