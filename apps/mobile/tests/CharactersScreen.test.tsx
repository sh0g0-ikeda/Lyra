import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharactersScreen,
  type CharactersScreenHandle,
} from '../src/screens/CharactersScreen';
import { ApiError } from '../src/lib/api';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  ActivityIndicator: 'activity-indicator',
  Pressable: ({
    children,
    disabled,
    onPress,
    ...props
  }: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    disabled?: boolean;
    onPress?: () => void;
  }) => React.createElement(
    'button',
    { ...props, disabled, onClick: disabled ? undefined : onPress },
    typeof children === 'function' ? children({ pressed: false }) : children,
  ),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  TextInput: ({
    onChangeText,
    ...props
  }: {
    onChangeText: (value: string) => void;
  }) => React.createElement('input', {
    ...props,
    onChange: onChangeText,
    onChangeText,
  }),
  View: 'view',
}));

vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => React.createElement('expo-image', props),
}));

vi.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: {
    Compatible: 'compatible',
  },
  launchImageLibraryAsync: vi.fn(),
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

const timestamp = '2026-08-01T00:00:00.000Z';

const work = (id: string, title: string) => ({
  id,
  organization_id: null,
  title,
  genre: null,
  world_setting: null,
  theme: null,
  main_entity_ids: [],
  starting_point: null,
  ending_point: null,
  overall_flow: null,
  version: 1,
  status: 'draft' as const,
  created_at: timestamp,
  updated_at: timestamp,
});

const entity = (
  id: string,
  name: string,
  overrides: Partial<ReturnType<typeof baseEntity>> = {},
) => ({ ...baseEntity(id, name), ...overrides });

const baseEntity = (id: string, name: string) => ({
  id,
  work_id: 'work-1',
  entity_type: 'character' as const,
  name,
  free_description: null,
  structured_fields: { age_range: '成人' },
  prompt_supplement: 'hidden prompt',
  speech_profile: { tone: 'calm' },
  status: 'ready' as const,
  created_at: timestamp,
  updated_at: timestamp,
});

function entityGenerationJob(input: {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  candidates?: string[];
  entityId?: string;
}) {
  return {
    id: input.id,
    job_type: 'entity_generate' as const,
    status: input.status,
    generation_mode: null,
    credit_cost: 1,
    params: { entity_id: input.entityId ?? 'entity-1', entity_type: 'character' as const },
    result: input.status === 'completed'
      ? {
          provider_result: true,
          candidates: (input.candidates ?? []).map((candidate_token) => ({
            candidate_token,
          })),
        }
      : null,
    error_message: null,
    retry_count: 0,
    created_at: timestamp,
    started_at: null,
    completed_at: input.status === 'completed' ? timestamp : null,
    expires_at: null,
    cancel_requested_at: null,
    cancelled_at: null,
    commit_started_at: null,
  };
}

const flushQueries = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function textOf(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe('CharactersScreen', () => {
  const api = {
    confirmEntityReference: vi.fn(),
    createEntity: vi.fn(),
    createEntityState: vi.fn(),
    generateEntityReference: vi.fn(),
    getChapters: vi.fn(),
    getEntitiesPage: vi.fn(),
    getEntityReferenceSet: vi.fn(),
    getEntityStates: vi.fn(),
    getEpisodes: vi.fn(),
    getJob: vi.fn(),
    getJobs: vi.fn(),
    getScenes: vi.fn(),
    getWorksPage: vi.fn(),
    importEntityReferenceImage: vi.fn(),
    refreshImageAuthorizationHeader: vi.fn(),
    updateEntity: vi.fn(),
    updateEntityGenerationContext: vi.fn(),
    updateEntityState: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.getWorksPage.mockResolvedValue({
      works: [work('work-1', '緋色の研究'), work('work-2', '四つの署名')],
      next_cursor: null,
    });
    api.getEntitiesPage.mockResolvedValue({
      entities: [
        entity('entity-1', 'ホームズ'),
        entity('entity-2', 'ワトスン'),
      ],
      next_cursor: null,
    });
    api.getEntityReferenceSet.mockImplementation(async (entityId: string) => ({
      entity_id: entityId,
      primary_ref_id: null,
      status: 'empty',
      updated_at: timestamp,
      reference_images: [],
    }));
    api.getEntityStates.mockImplementation(async (entityId: string) => ({
      entity_states: [{
        id: `state-${entityId}`,
        entity_id: entityId,
        scene_id: null,
        costume_note: '黒い外套',
        costume_ref_id: null,
        condition_note: null,
        hair_note: '雨で濡れている',
        expression_default: 'determined',
        extra_note: null,
        created_at: timestamp,
      }],
    }));
    api.getChapters.mockResolvedValue({ chapters: [] });
    api.getEpisodes.mockResolvedValue({ episodes: [] });
    api.getScenes.mockResolvedValue({ scenes: [] });
    api.createEntityState.mockImplementation(async (entityId: string, input: {
      scene_id?: string | null;
      costume_note?: string | null;
      condition_note?: string | null;
      hair_note?: string | null;
      expression_default: string;
      extra_note?: string | null;
    }) => ({
      id: `created-state-${entityId}`,
      entity_id: entityId,
      scene_id: input.scene_id ?? null,
      costume_note: input.costume_note ?? null,
      costume_ref_id: null,
      condition_note: input.condition_note ?? null,
      hair_note: input.hair_note ?? null,
      expression_default: input.expression_default,
      extra_note: input.extra_note ?? null,
      created_at: timestamp,
    }));
    api.updateEntityState.mockImplementation(async (entityId: string, stateId: string, input: Record<string, unknown>) => ({
      id: stateId,
      entity_id: entityId,
      scene_id: null,
      costume_note: '黒い外套',
      costume_ref_id: null,
      condition_note: null,
      hair_note: '雨で濡れている',
      expression_default: 'determined',
      extra_note: null,
      created_at: timestamp,
      ...input,
    }));
    api.refreshImageAuthorizationHeader.mockResolvedValue('Bearer refreshed-token');
    api.importEntityReferenceImage.mockResolvedValue({
      suggested_fields: { art_style: 'manga' },
      prompt_supplement: '黒髪、長身、鋭い目つき',
      tmp_image_token: 'opaque-candidate-token',
    });
    api.confirmEntityReference.mockImplementation(async (entityId: string) => ({
      entity_id: entityId,
      primary_ref_id: 'uploaded-reference',
      status: 'partial',
      updated_at: '2026-08-01T01:00:00.000Z',
      reference_images: [{
        ref_id: 'uploaded-reference',
        source: 'upload',
        created_at: '2026-08-01T01:00:00.000Z',
      }],
    }));
    api.generateEntityReference.mockResolvedValue({ job_id: 'entity-job-1' });
    api.getJobs.mockResolvedValue({ jobs: [], next_cursor: null });
    api.getJob.mockResolvedValue(entityGenerationJob({
      id: 'entity-job-1',
      status: 'completed',
      candidates: ['generated-candidate-1', 'generated-candidate-2'],
    }));
    api.createEntity.mockImplementation(async (
      workId: string,
      input: { entity_type: 'character' | 'nonhuman' | 'object'; name: string; free_description: string | null },
    ) => entity('entity-new', input.name, {
      work_id: workId,
      entity_type: input.entity_type,
      free_description: input.free_description,
      structured_fields: {},
      prompt_supplement: null,
      speech_profile: {},
      status: 'draft',
    }));
    api.updateEntity.mockImplementation(async (
      id: string,
      input: { name?: string; free_description?: string | null },
    ) => ({
      ...entity(id, input.name ?? 'ホームズ'),
      free_description: input.free_description ?? null,
    }));
    api.updateEntityGenerationContext.mockImplementation(async (
      id: string,
      promptSupplement: string | null,
    ) => entity(id, 'ホームズ', { prompt_supplement: promptSupplement }));
  });

  const renderScreen = async (
    overrides: Partial<React.ComponentProps<typeof CharactersScreen>> = {},
    ref = createRef<CharactersScreenHandle>(),
  ): Promise<{
    renderer: ReactTestRenderer;
    ref: React.RefObject<CharactersScreenHandle | null>;
    rerender(nextOverrides: Partial<React.ComponentProps<typeof CharactersScreen>>): Promise<void>;
  }> => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderTree = (
      nextOverrides: Partial<React.ComponentProps<typeof CharactersScreen>>,
    ): React.JSX.Element => (
      <QueryClientProvider client={queryClient}>
        <CharactersScreen
          api={api}
          imageApiBaseUrl="https://api.example.com"
          imageAuthorizationHeader="Bearer id-token"
          language="ja"
          organizationId={null}
          ref={ref}
          sessionKey="session-1"
          {...nextOverrides}
        />
      </QueryClientProvider>
    );
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(renderTree(overrides));
    });
    await act(async () => {
      await flushQueries();
    });
    return {
      renderer: renderer!,
      ref,
      rerender: async (nextOverrides): Promise<void> => {
        await act(async () => {
          renderer.update(renderTree({ ...overrides, ...nextOverrides }));
        });
        await act(async () => {
          await flushQueries();
        });
      },
    };
  };

  const press = async (renderer: ReactTestRenderer, label: string): Promise<void> => {
    const button = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === label,
    );
    expect(button, `button ${label}`).toBeDefined();
    await act(async () => {
      button?.props.onClick();
      await flushQueries();
    });
  };

  const selectWork = async (renderer: ReactTestRenderer, label = '緋色の研究を選択') => {
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: label }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
  };

  const selectEntity = async (renderer: ReactTestRenderer, label = 'ホームズを選択') => {
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: label }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
  };

  const changeInput = async (
    renderer: ReactTestRenderer,
    accessibilityLabel: string,
    value: string,
  ): Promise<void> => {
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel }).props.onChangeText(value);
    });
  };

  it('キャラ0件を正常empty stateとして表示しerrorにしない', async () => {
    api.getEntitiesPage.mockResolvedValue({ entities: [], next_cursor: null });
    const { renderer } = await renderScreen();
    await selectWork(renderer);

    expect(textOf(renderer)).toContain('キャラはまだありません');
    expect(renderer.root.findAllByType('notice').filter(
      (notice) => notice.props.tone === 'danger',
    )).toHaveLength(0);
  });

  it('next_cursorがある場合だけ追加ページを読み込んで重複なく表示する', async () => {
    api.getEntitiesPage
      .mockResolvedValueOnce({
        entities: [entity('entity-1', 'ホームズ')],
        next_cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        entities: [entity('entity-2', 'ワトスン')],
        next_cursor: null,
      });
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await press(renderer, 'さらに読み込む');

    expect(textOf(renderer)).toContain('ホームズ');
    expect(textOf(renderer)).toContain('ワトスン');
    expect(api.getEntitiesPage.mock.calls).toEqual([
      ['work-1', { limit: 50, cursor: null }, null],
      ['work-1', { limit: 50, cursor: 'page-2' }, null],
    ]);
  });

  it('追加ページ取得に失敗しても表示済み一覧を隠さず再試行できる', async () => {
    api.getEntitiesPage
      .mockResolvedValueOnce({
        entities: [entity('entity-1', 'ホームズ')],
        next_cursor: 'page-2',
      })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        entities: [entity('entity-2', 'ワトスン')],
        next_cursor: null,
      });
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await press(renderer, 'さらに読み込む');

    expect(textOf(renderer)).toContain('ホームズ');
    expect(textOf(renderer)).toContain('表示済みのキャラはそのまま利用できます');
    expect(textOf(renderer)).not.toContain('キャラはまだありません');
    await press(renderer, 'さらに読み込む');
    expect(textOf(renderer)).toContain('ワトスン');
  });

  it('新規作成時だけ種類を選べ、最小payloadで1件作成する', async () => {
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '人外を種類として選択' }).props.onPress();
    });
    await changeInput(renderer, 'キャラ名', '  魔犬  ');
    await changeInput(renderer, 'キャラの説明', '巨大な猟犬');
    await press(renderer, '作成');

    expect(api.createEntity).toHaveBeenCalledOnce();
    expect(api.createEntity).toHaveBeenCalledWith(
      'work-1',
      {
        entity_type: 'nonhuman',
        name: '魔犬',
        free_description: '巨大な猟犬',
      },
      null,
    );
    expect(textOf(renderer)).toContain('作成しました');
  });

  it('初回一覧取得中に作成しても成功後にcanonical一覧を再取得する', async () => {
    let resolveInitialList: ((value: { entities: ReturnType<typeof baseEntity>[]; next_cursor: null }) => void) | undefined;
    const created = baseEntity('entity-new', 'レストレード');
    api.getEntitiesPage
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveInitialList = resolve;
      }))
      .mockResolvedValueOnce({ entities: [created], next_cursor: null });
    api.createEntity.mockResolvedValue(created);
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await changeInput(renderer, 'キャラ名', 'レストレード');
    await press(renderer, '作成');

    await act(async () => {
      resolveInitialList?.({ entities: [], next_cursor: null });
      await flushQueries();
    });
    expect(api.getEntitiesPage).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByProps({
      accessibilityLabel: 'レストレードを選択',
    })).toBeDefined();
  });

  it('既存キャラは種類を変更できず、変更された表示項目だけを更新する', async () => {
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);

    expect(renderer.root.findAllByProps({
      accessibilityLabel: '人外を種類として選択',
    })).toHaveLength(0);
    expect(textOf(renderer)).toContain('人物');
    await changeInput(renderer, 'キャラ名', 'シャーロック・ホームズ');
    await press(renderer, '保存');

    expect(api.updateEntity).toHaveBeenCalledWith(
      'entity-1',
      { name: 'シャーロック・ホームズ' },
      null,
    );
    const payload = api.updateEntity.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('entity_type');
    expect(payload).not.toHaveProperty('structured_fields');
    expect(payload).not.toHaveProperty('prompt_supplement');
    expect(payload).not.toHaveProperty('speech_profile');
  });

  it('更新responseが別作品を指す場合は成功として採用せずdraftを保持する', async () => {
    api.updateEntity.mockResolvedValue(entity('entity-1', '誤った応答', {
      work_id: 'work-2',
    }));
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '変更中');
    await press(renderer, '保存');

    expect(renderer.root.findByProps({ accessibilityLabel: 'キャラ名' }).props.value)
      .toBe('変更中');
    expect(textOf(renderer)).toContain('入力内容は保持されています');
    expect(textOf(renderer)).not.toContain('誤った応答');
  });

  it('下書きを戻すと最後に保存した名前と説明へ戻す', async () => {
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '変更中');
    await press(renderer, '下書きを戻す');

    expect(renderer.root.findByProps({ accessibilityLabel: 'キャラ名' }).props.value)
      .toBe('ホームズ');
    expect(api.updateEntity).not.toHaveBeenCalled();
  });

  it('dirtyなキャラ切替を取消した場合は選択と入力を維持する', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('cancel');
    const { renderer } = await renderScreen({ resolveDirtyAction });
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '変更中');
    await selectEntity(renderer, 'ワトスンを選択');

    expect(resolveDirtyAction).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ accessibilityLabel: 'キャラ名' }).props.value)
      .toBe('変更中');
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズを選択' })
      .props.accessibilityState).toEqual({ selected: true });
  });

  it('dirtyなキャラ切替を破棄した場合だけ次のキャラへ移る', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('discard');
    const { renderer } = await renderScreen({ resolveDirtyAction });
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '変更中');
    await selectEntity(renderer, 'ワトスンを選択');

    expect(api.updateEntity).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: 'キャラ名' }).props.value)
      .toBe('ワトスン');
  });

  it('dirtyの保存に失敗した場合はキャラもdraftも切り替えない', async () => {
    api.updateEntity.mockRejectedValue(new Error('provider secret'));
    const resolveDirtyAction = vi.fn().mockResolvedValue('save');
    const { renderer } = await renderScreen({ resolveDirtyAction });
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '変更中');
    await selectEntity(renderer, 'ワトスンを選択');

    expect(renderer.root.findByProps({ accessibilityLabel: 'キャラ名' }).props.value)
      .toBe('変更中');
    expect(textOf(renderer)).toContain('入力内容は保持されています');
    expect(textOf(renderer)).not.toContain('provider secret');
  });

  it('作品切替前にdirtyを保存し、成功後だけ別作品へ移る', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('save');
    const { renderer } = await renderScreen({ resolveDirtyAction });
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラの説明', '更新した説明');
    await selectWork(renderer, '四つの署名を選択');

    expect(api.updateEntity).toHaveBeenCalledWith(
      'entity-1',
      { free_description: '更新した説明' },
      null,
    );
    expect(api.getEntitiesPage).toHaveBeenLastCalledWith(
      'work-2',
      { limit: 50, cursor: null },
      null,
    );
  });

  it('tab離脱もdirty解決を経由し、取消ならfalseを返す', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('cancel');
    const screenRef = createRef<CharactersScreenHandle>();
    const { renderer, ref } = await renderScreen({ resolveDirtyAction }, screenRef);
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '変更中');

    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);
    expect(resolveDirtyAction).toHaveBeenCalledOnce();
  });

  it('保存済みキャラに服装・状態を表示しstate dirtyの取消でキャラ切替を止める', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('cancel');
    const { renderer } = await renderScreen({ resolveDirtyAction });
    await selectWork(renderer);
    await selectEntity(renderer);

    expect(textOf(renderer)).toContain('服装・状態');
    expect(api.getEntityStates).toHaveBeenCalledWith('entity-1', null);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '状態1: 黒い外套を選択' })
        .props.onPress();
      await flushQueries();
    });
    await changeInput(renderer, '髪の状態', '乾いた短髪');
    await selectEntity(renderer, 'ワトスンを選択');

    expect(resolveDirtyAction).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズを選択' })
      .props.accessibilityState).toEqual({ selected: true });
    expect(renderer.root.findByProps({ accessibilityLabel: '髪の状態' }).props.value)
      .toBe('乾いた短髪');
  });

  it('tab離脱ではキャラ本体より先にstate dirtyを解決する', async () => {
    const resolveDirtyAction = vi.fn().mockResolvedValue('cancel');
    const screenRef = createRef<CharactersScreenHandle>();
    const { renderer, ref } = await renderScreen({ resolveDirtyAction }, screenRef);
    await selectWork(renderer);
    await selectEntity(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '状態1: 黒い外套を選択' })
        .props.onPress();
      await flushQueries();
    });
    await changeInput(renderer, '髪の状態', '乾いた短髪');

    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);
    expect(resolveDirtyAction).toHaveBeenCalledOnce();
    expect(api.updateEntity).not.toHaveBeenCalled();
    expect(api.updateEntityState).not.toHaveBeenCalled();
  });

  it('作成ボタンを連打してもPOSTを1回だけ実行する', async () => {
    let resolveCreate: ((value: ReturnType<typeof baseEntity>) => void) | undefined;
    api.createEntity.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await changeInput(renderer, 'キャラ名', 'レストレード');
    const button = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '作成',
    );

    await act(async () => {
      button?.props.onClick();
      button?.props.onClick();
      await Promise.resolve();
    });
    expect(api.createEntity).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ accessibilityLabel: 'キャラ名' }).props.editable)
      .toBe(false);
    expect(renderer.root.findByProps({
      accessibilityLabel: '人外を種類として選択',
    }).props.disabled).toBe(true);

    await act(async () => {
      resolveCreate?.(baseEntity('entity-new', 'レストレード'));
      await flushQueries();
    });
  });

  it('保存ボタンを連打してもPUTを1回だけ実行する', async () => {
    let resolveUpdate: ((value: ReturnType<typeof baseEntity>) => void) | undefined;
    api.updateEntity.mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve;
    }));
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '更新後');
    const button = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '保存',
    );

    await act(async () => {
      button?.props.onClick();
      button?.props.onClick();
      await Promise.resolve();
    });
    expect(api.updateEntity).toHaveBeenCalledOnce();

    await act(async () => {
      resolveUpdate?.(baseEntity('entity-1', '更新後'));
      await flushQueries();
    });
  });

  it('保存待ち中のキャラ切替を連打しても保存と遷移を1回だけ実行する', async () => {
    let resolveUpdate: ((value: ReturnType<typeof baseEntity>) => void) | undefined;
    api.updateEntity.mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve;
    }));
    const resolveDirtyAction = vi.fn().mockResolvedValue('save');
    const { renderer } = await renderScreen({ resolveDirtyAction });
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '更新後');
    const nextEntity = renderer.root.findByProps({
      accessibilityLabel: 'ワトスンを選択',
    });

    await act(async () => {
      nextEntity.props.onPress();
      nextEntity.props.onPress();
      await Promise.resolve();
    });
    expect(resolveDirtyAction).toHaveBeenCalledOnce();
    expect(api.updateEntity).toHaveBeenCalledOnce();

    await act(async () => {
      resolveUpdate?.(baseEntity('entity-1', '更新後'));
      await flushQueries();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'キャラ名' }).props.value)
      .toBe('ワトスン');
  });

  it('organization scopeを一覧・作成・更新の全APIへ渡す', async () => {
    const organizationId = 'organization-1';
    const { renderer } = await renderScreen({ organizationId });
    await selectWork(renderer);
    await selectEntity(renderer);
    await changeInput(renderer, 'キャラ名', '更新');
    await press(renderer, '保存');
    await press(renderer, '新規キャラ');
    await changeInput(renderer, 'キャラ名', '新規');
    await press(renderer, '作成');

    expect(api.getEntitiesPage).toHaveBeenCalledWith(
      'work-1',
      { limit: 50, cursor: null },
      organizationId,
    );
    expect(api.updateEntity.mock.calls[0]?.[2]).toBe(organizationId);
    expect(api.createEntity.mock.calls[0]?.[2]).toBe(organizationId);
  });

  it('一覧取得失敗はempty stateと混同せず再試行導線を出す', async () => {
    api.getEntitiesPage.mockRejectedValue(new Error('network'));
    const { renderer } = await renderScreen();
    await selectWork(renderer);

    expect(textOf(renderer)).toContain('キャラ一覧を読み込めませんでした');
    expect(textOf(renderer)).not.toContain('キャラはまだありません');
    expect(textOf(renderer)).toContain('再試行');
  });

  it('未選択と新規draftではreference setを取得しない', async () => {
    const { renderer } = await renderScreen();
    await selectWork(renderer);

    expect(api.getEntityReferenceSet).not.toHaveBeenCalled();
    await changeInput(renderer, 'キャラ名', '新規キャラ');
    expect(api.getEntityReferenceSet).not.toHaveBeenCalled();
  });

  it('保存済みキャラのreference状態・primary・確定画像metadataを表示する', async () => {
    api.getEntityReferenceSet.mockResolvedValue({
      entity_id: 'entity-1',
      primary_ref_id: 'reference-1',
      status: 'ready',
      updated_at: timestamp,
      reference_images: [
        {
          ref_id: 'reference-1',
          cdn_url: 'https://cdn.example.com/reference.png?Signature=signed',
          source: 'generated',
          created_at: timestamp,
        },
      ],
    });
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);

    expect(api.getEntityReferenceSet).toHaveBeenCalledWith('entity-1', null);
    expect(textOf(renderer)).toContain('準備完了');
    expect(textOf(renderer)).toContain('メイン画像: 設定済み');
    expect(textOf(renderer)).toContain('確定画像: 1枚');
    expect(textOf(renderer)).toContain('AI生成');
    expect(textOf(renderer)).toContain('2026-08-01');
    expect(renderer.root.findByType('expo-image').props.cachePolicy).toBe('memory');
  });

  it('reference 0件は正常emptyとして表示しerrorにしない', async () => {
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);

    expect(textOf(renderer)).toContain('参照画像はまだ確定されていません');
    expect(textOf(renderer)).not.toContain('参照画像を読み込めませんでした');
  });

  it('reference取得失敗をemptyと混同せず再試行する', async () => {
    api.getEntityReferenceSet
      .mockRejectedValueOnce(new Error('private provider detail'))
      .mockResolvedValueOnce({
        entity_id: 'entity-1',
        primary_ref_id: null,
        status: 'empty',
        updated_at: timestamp,
        reference_images: [],
      });
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);

    expect(textOf(renderer)).toContain('参照画像を読み込めませんでした');
    expect(textOf(renderer)).not.toContain('private provider detail');
    expect(textOf(renderer)).not.toContain('参照画像はまだ確定されていません');
    await press(renderer, '参照画像を再試行');
    expect(textOf(renderer)).toContain('参照画像はまだ確定されていません');
  });

  it('reference取得と画像fallbackへorganization scopeを渡す', async () => {
    api.getEntityReferenceSet.mockResolvedValue({
      entity_id: 'entity-1',
      primary_ref_id: 'reference-1',
      status: 'partial',
      updated_at: timestamp,
      reference_images: [{
        ref_id: 'reference-1',
        source: 'upload',
        created_at: timestamp,
      }],
    });
    const { renderer } = await renderScreen({ organizationId: 'organization-1' });
    await selectWork(renderer);
    await selectEntity(renderer);

    expect(api.getEntityReferenceSet).toHaveBeenCalledWith('entity-1', 'organization-1');
    expect(renderer.root.findByType('expo-image').props.source.uri).toContain(
      'organization_id=organization-1',
    );
  });

  it('複数のprotected画像が失敗しても同じ表示中の認証更新は1回に束ねる', async () => {
    api.getEntityReferenceSet.mockResolvedValue({
      entity_id: 'entity-1',
      primary_ref_id: 'reference-1',
      status: 'ready',
      updated_at: timestamp,
      reference_images: [
        { ref_id: 'reference-1', source: 'upload', created_at: timestamp },
        { ref_id: 'reference-2', source: 'generated', created_at: timestamp },
      ],
    });
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);
    const images = renderer.root.findAllByType('expo-image');

    await act(async () => {
      images[0]?.props.onError();
      images[1]?.props.onError();
      await Promise.resolve();
    });

    expect(api.refreshImageAuthorizationHeader).toHaveBeenCalledOnce();
  });

  it('逐次画像失敗でも更新済みheaderを再利用し手動再試行後だけ再更新する', async () => {
    api.getEntityReferenceSet.mockResolvedValue({
      entity_id: 'entity-1',
      primary_ref_id: 'reference-1',
      status: 'ready',
      updated_at: timestamp,
      reference_images: [
        { ref_id: 'reference-1', source: 'upload', created_at: timestamp },
        { ref_id: 'reference-2', source: 'generated', created_at: timestamp },
      ],
    });
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);
    const failImage = (label: string): void => {
      const image = renderer.root.findAllByType('expo-image').find(
        (candidate) => candidate.props.accessibilityLabel === label,
      );
      expect(image).toBeDefined();
      image?.props.onError();
    };

    await act(async () => {
      failImage('ホームズの参照画像 1');
      await Promise.resolve();
    });
    await act(async () => {
      failImage('ホームズの参照画像 2');
      await Promise.resolve();
    });
    expect(api.refreshImageAuthorizationHeader).toHaveBeenCalledOnce();

    await act(async () => {
      failImage('ホームズの参照画像 1');
    });
    await press(renderer, '画像を再試行');
    await act(async () => {
      failImage('ホームズの参照画像 1');
      await Promise.resolve();
    });

    expect(api.refreshImageAuthorizationHeader).toHaveBeenCalledTimes(2);
  });

  it('保存済みキャラへ画像1枚を取り込みpreview成功後だけ明示確定する', async () => {
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const confirmReferenceCandidate = vi.fn().mockResolvedValue(true);
    const { renderer } = await renderScreen({
      confirmReferenceCandidate,
      referenceImagePicker,
    });
    await selectWork(renderer);
    await selectEntity(renderer);

    expect(textOf(renderer)).toContain('画像を取り込む（1クレジット）');
    await press(renderer, '画像を取り込む（1クレジット）');

    expect(api.importEntityReferenceImage).toHaveBeenCalledWith(
      'entity-1',
      'character',
      'data:image/jpeg;base64,/9j/AA==',
      null,
    );
    expect(textOf(renderer)).toContain('黒髪、長身、鋭い目つき');
    let confirmButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '取り込み候補を確定',
    );
    expect(confirmButton?.props.disabled).toBe(true);

    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ホームズの取り込み候補',
      }).props.onLoad();
    });
    confirmButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '取り込み候補を確定',
    );
    expect(confirmButton?.props.disabled).toBe(false);
    await press(renderer, '取り込み候補を確定');

    expect(confirmReferenceCandidate).toHaveBeenCalledWith({
      existingCount: 0,
      language: 'ja',
    });
    expect(api.confirmEntityReference).toHaveBeenCalledWith(
      'entity-1',
      {
        selected_candidate_tokens: ['opaque-candidate-token'],
        primary_candidate_token: 'opaque-candidate-token',
        prompt_supplement: '黒髪、長身、鋭い目つき',
      },
      null,
    );
    expect(textOf(renderer)).toContain('確定画像: 1枚');
    expect(textOf(renderer)).not.toContain('黒髪、長身、鋭い目つき');
  });

  it('dirtyキャラを先に保存してから既存jobで全身候補を生成・preview後に確定する', async () => {
    const confirmReferenceCandidate = vi.fn().mockResolvedValue(true);
    const { renderer } = await renderScreen({ confirmReferenceCandidate });
    await selectWork(renderer);
    await selectEntity(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'キャラ名' }).props.onChangeText('ホームズ更新');
    });
    await press(renderer, '全身プレビューを生成（1クレジット）');

    expect(api.updateEntity).toHaveBeenCalledWith(
      'entity-1',
      { name: 'ホームズ更新' },
      null,
    );
    expect(api.updateEntity.mock.invocationCallOrder[0])
      .toBeLessThan(api.generateEntityReference.mock.invocationCallOrder[0]!);
    expect(api.generateEntityReference).toHaveBeenCalledWith('entity-1', null, null);
    expect(api.getJob).toHaveBeenCalledWith('entity-job-1', null);
    expect(textOf(renderer)).toContain('生成候補 2枚');

    let confirmButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '生成候補を確定',
    );
    expect(confirmButton?.props.disabled).toBe(true);
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ホームズ更新の生成候補 1',
      }).props.onLoad();
      renderer.root.findByProps({
        accessibilityLabel: 'ホームズ更新の生成候補 2',
      }).props.onLoad();
    });
    confirmButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '生成候補を確定',
    );
    expect(confirmButton?.props.disabled).toBe(false);
    await press(renderer, '生成候補を確定');

    expect(confirmReferenceCandidate).toHaveBeenCalledWith({
      existingCount: 0,
      language: 'ja',
    });
    expect(api.confirmEntityReference).toHaveBeenCalledWith(
      'entity-1',
      {
        selected_candidate_tokens: [
          'generated-candidate-1',
          'generated-candidate-2',
        ],
        primary_candidate_token: 'generated-candidate-1',
        prompt_supplement: 'hidden prompt',
      },
      null,
    );
  });

  it('画面復帰時に同じEntityのactive生成jobをexact取得し新しい課金を開始しない', async () => {
    api.getJobs.mockResolvedValue({
      jobs: [entityGenerationJob({ id: 'existing-job', status: 'queued' })],
      next_cursor: null,
    });
    api.getJob.mockResolvedValue(entityGenerationJob({
      id: 'existing-job',
      status: 'completed',
      candidates: ['recovered-candidate'],
    }));
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);

    expect(api.generateEntityReference).not.toHaveBeenCalled();
    expect(api.getJob).toHaveBeenCalledWith('existing-job', null);
    expect(textOf(renderer)).toContain('生成候補 1枚');
  });

  it('生成POSTの応答消失後は履歴上の一意なjobをexact取得して自動再送しない', async () => {
    api.generateEntityReference.mockRejectedValue(new Error('response lost'));
    api.getJobs
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockResolvedValueOnce({
        jobs: [entityGenerationJob({ id: 'recovered-job', status: 'completed' })],
        next_cursor: null,
      });
    api.getJob.mockResolvedValue(entityGenerationJob({
      id: 'recovered-job',
      status: 'completed',
      candidates: ['recovered-candidate'],
    }));
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);

    await press(renderer, '全身プレビューを生成（1クレジット）');

    expect(api.generateEntityReference).toHaveBeenCalledOnce();
    expect(api.getJob).toHaveBeenCalledWith('recovered-job', null);
    expect(textOf(renderer)).toContain('生成候補 1枚');
    expect(textOf(renderer)).not.toContain('二重課金を避けるため自動再送していません');
  });

  it('生成POSTと履歴確認の応答を失った場合は生成をロックし手動照合で復旧する', async () => {
    api.generateEntityReference.mockRejectedValue(new Error('response lost'));
    api.getJobs
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockRejectedValueOnce(new Error('history unavailable'))
      .mockResolvedValueOnce({
        jobs: [entityGenerationJob({ id: 'late-job', status: 'completed' })],
        next_cursor: null,
      });
    api.getJob.mockResolvedValue(entityGenerationJob({
      id: 'late-job',
      status: 'completed',
      candidates: ['late-candidate'],
    }));
    const { renderer } = await renderScreen();
    await selectWork(renderer);
    await selectEntity(renderer);

    await press(renderer, '全身プレビューを生成（1クレジット）');

    const generateButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '全身プレビューを生成（1クレジット）',
    );
    expect(generateButton?.props.disabled).toBe(true);
    expect(textOf(renderer)).toContain('二重課金を避けるため自動再送していません');

    await press(renderer, '生成状況を再確認');
    expect(api.generateEntityReference).toHaveBeenCalledOnce();
    expect(api.getJob).toHaveBeenCalledWith('late-job', null);
    expect(textOf(renderer)).toContain('生成候補 1枚');
  });

  it('source付き生成の応答消失からjobを復元してもimport候補を自動破棄しない', async () => {
    api.generateEntityReference.mockRejectedValue(new Error('response lost'));
    api.getJobs
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockResolvedValueOnce({ jobs: [], next_cursor: null })
      .mockResolvedValueOnce({
        jobs: [entityGenerationJob({ id: 'possibly-remote-job', status: 'completed' })],
        next_cursor: null,
      });
    api.getJob.mockResolvedValue(entityGenerationJob({
      id: 'possibly-remote-job',
      status: 'completed',
      candidates: ['recovered-candidate'],
    }));
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const { renderer } = await renderScreen({ referenceImagePicker });
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '画像を取り込む（1クレジット）');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの取り込み候補' }).props.onLoad();
    });

    await press(renderer, '取り込み画像から全身プレビューを生成（1クレジット）');

    expect(api.generateEntityReference).toHaveBeenCalledOnce();
    expect(textOf(renderer)).toContain('生成候補 1枚');
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの取り込み候補' }))
      .toBeDefined();
  });

  it('生成後に参照setが別処理で変わった場合は初回confirmを送らない', async () => {
    let remoteUpdated = false;
    api.getEntityReferenceSet.mockImplementation(async (entityId: string) => ({
      entity_id: entityId,
      primary_ref_id: remoteUpdated ? 'remote-reference' : null,
      status: remoteUpdated ? 'partial' : 'empty',
      updated_at: remoteUpdated ? '2026-08-01T02:00:00.000Z' : timestamp,
      reference_images: remoteUpdated ? [{
        ref_id: 'remote-reference',
        source: 'generated' as const,
        created_at: '2026-08-01T02:00:00.000Z',
      }] : [],
    }));
    const confirmReferenceCandidate = vi.fn().mockResolvedValue(true);
    const { renderer } = await renderScreen({ confirmReferenceCandidate });
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '全身プレビューを生成（1クレジット）');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの生成候補 1' }).props.onLoad();
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの生成候補 2' }).props.onLoad();
    });

    remoteUpdated = true;
    await press(renderer, '生成候補を確定');

    expect(api.confirmEntityReference).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain('別の処理で参照画像が更新されました');
  });

  it('生成候補confirmの応答消失時は自動再送せず候補をambiguousにする', async () => {
    api.confirmEntityReference.mockRejectedValue(new Error('response lost'));
    const { renderer } = await renderScreen({
      confirmReferenceCandidate: vi.fn().mockResolvedValue(true),
    });
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '全身プレビューを生成（1クレジット）');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの生成候補 1' }).props.onLoad();
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの生成候補 2' }).props.onLoad();
    });

    await press(renderer, '生成候補を確定');

    const confirmButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '生成候補を確定',
    );
    expect(api.confirmEntityReference).toHaveBeenCalledOnce();
    expect(confirmButton?.props.disabled).toBe(true);
    expect(textOf(renderer)).toContain('確定処理の結果を確認できませんでした');
  });

  it('import候補をsourceにする場合は解析補足だけを保存して同じtokenで生成する', async () => {
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const { renderer } = await renderScreen({ referenceImagePicker });
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '画像を取り込む（1クレジット）');
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ホームズの取り込み候補',
      }).props.onLoad();
    });

    await press(renderer, '取り込み画像から全身プレビューを生成（1クレジット）');

    expect(api.updateEntityGenerationContext).toHaveBeenCalledWith(
      'entity-1',
      '黒髪、長身、鋭い目つき',
      null,
    );
    expect(api.generateEntityReference).toHaveBeenCalledWith(
      'entity-1',
      'opaque-candidate-token',
      null,
    );
    expect(textOf(renderer)).not.toContain('ホームズの取り込み候補');
  });

  it('生成開始とjob照合中は多重課金とEntity・tab移動を止める', async () => {
    let resolveJob: ((value: ReturnType<typeof entityGenerationJob>) => void) | undefined;
    api.getJob.mockReturnValue(new Promise((resolve) => {
      resolveJob = resolve;
    }));
    const screenRef = createRef<CharactersScreenHandle>();
    const { renderer, ref } = await renderScreen({}, screenRef);
    await selectWork(renderer);
    await selectEntity(renderer);
    const generateButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '全身プレビューを生成（1クレジット）',
    );

    await act(async () => {
      generateButton?.props.onClick();
      generateButton?.props.onClick();
      await flushQueries();
    });
    expect(api.generateEntityReference).toHaveBeenCalledOnce();
    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);
    await selectEntity(renderer, 'ワトスンを選択');
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズを選択' })
      .props.accessibilityState).toEqual({ selected: true });

    await act(async () => {
      resolveJob?.(entityGenerationJob({
        id: 'entity-job-1',
        status: 'completed',
        candidates: ['generated-candidate-1'],
      }));
      await flushQueries();
    });
  });

  it('生成POSTが返したexact jobが別Entityなら候補を採用せず新しい生成も開始させない', async () => {
    api.getJob.mockResolvedValue(entityGenerationJob({
      id: 'entity-job-1',
      status: 'completed',
      candidates: ['wrong-entity-candidate'],
      entityId: 'entity-2',
    }));
    const screenRef = createRef<CharactersScreenHandle>();
    const { renderer, ref } = await renderScreen({}, screenRef);
    await selectWork(renderer);
    await selectEntity(renderer);

    await press(renderer, '全身プレビューを生成（1クレジット）');

    const generateButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '全身プレビューを生成（1クレジット）',
    );
    expect(generateButton?.props.disabled).toBe(true);
    expect(textOf(renderer)).not.toContain('wrong-entity-candidate');
    expect(textOf(renderer)).toContain('生成状況を確認できませんでした');
    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);
    expect(api.generateEntityReference).toHaveBeenCalledOnce();
  });

  it('生成POSTが返したexact jobを404で確認できない場合も新しい生成を開始させない', async () => {
    api.getJob.mockRejectedValue(new ApiError('NOT_FOUND', 404, 'not found'));
    const screenRef = createRef<CharactersScreenHandle>();
    const { renderer, ref } = await renderScreen({}, screenRef);
    await selectWork(renderer);
    await selectEntity(renderer);

    await press(renderer, '全身プレビューを生成（1クレジット）');

    const generateButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '全身プレビューを生成（1クレジット）',
    );
    expect(generateButton?.props.disabled).toBe(true);
    expect(textOf(renderer)).toContain('生成状況を確認できませんでした');
    expect(textOf(renderer)).toContain('生成状況を再確認');
    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);
    expect(api.generateEntityReference).toHaveBeenCalledOnce();
  });

  it('確定画像が3枚あってもBackendの総数ルールを変えず1枚importできる', async () => {
    api.getEntityReferenceSet.mockImplementation(async (entityId: string) => ({
      entity_id: entityId,
      primary_ref_id: 'reference-1',
      status: 'ready',
      updated_at: timestamp,
      reference_images: [1, 2, 3].map((index) => ({
        ref_id: `reference-${index}`,
        source: 'upload' as const,
        created_at: timestamp,
      })),
    }));
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const { renderer } = await renderScreen({ referenceImagePicker });
    await selectWork(renderer);
    await selectEntity(renderer);

    const importButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '画像を取り込む（1クレジット）',
    );
    expect(importButton?.props.disabled).toBe(false);
    await press(renderer, '画像を取り込む（1クレジット）');
    expect(api.importEntityReferenceImage).toHaveBeenCalledOnce();
    expect(textOf(renderer)).not.toContain('確定画像は3枚までです');
  });

  it('import中は多重課金とEntity・tab移動を止める', async () => {
    let resolveImport: ((value: {
      suggested_fields: Record<string, unknown>;
      prompt_supplement: string;
      tmp_image_token: string;
    }) => void) | undefined;
    api.importEntityReferenceImage.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve;
    }));
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const screenRef = createRef<CharactersScreenHandle>();
    const { renderer, ref } = await renderScreen({ referenceImagePicker }, screenRef);
    await selectWork(renderer);
    await selectEntity(renderer);
    const importButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '画像を取り込む（1クレジット）',
    );

    await act(async () => {
      importButton?.props.onClick();
      importButton?.props.onClick();
      await flushQueries();
    });
    expect(api.importEntityReferenceImage).toHaveBeenCalledOnce();
    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);
    await selectEntity(renderer, 'ワトスンを選択');
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズを選択' })
      .props.accessibilityState).toEqual({ selected: true });

    await act(async () => {
      resolveImport?.({
        suggested_fields: {},
        prompt_supplement: '補足',
        tmp_image_token: 'candidate-token',
      });
      await flushQueries();
    });
  });

  it('import開始と生成開始を同じ描画内で押しても課金操作を並行実行しない', async () => {
    let resolvePick: ((value: null) => void) | undefined;
    const referenceImagePicker = {
      pick: vi.fn().mockReturnValue(new Promise<null>((resolve) => {
        resolvePick = resolve;
      })),
    };
    const { renderer } = await renderScreen({ referenceImagePicker });
    await selectWork(renderer);
    await selectEntity(renderer);
    const importButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '画像を取り込む（1クレジット）',
    );
    const generateButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '全身プレビューを生成（1クレジット）',
    );

    await act(async () => {
      importButton?.props.onClick();
      generateButton?.props.onClick();
      await flushQueries();
    });

    expect(referenceImagePicker.pick).toHaveBeenCalledOnce();
    expect(api.generateEntityReference).not.toHaveBeenCalled();
    await act(async () => {
      resolvePick?.(null);
      await flushQueries();
    });
  });

  it('参照setがimport後に変わった場合は初回confirmを送らず再確認させる', async () => {
    let remoteUpdated = false;
    api.getEntityReferenceSet.mockImplementation(async (entityId: string) => ({
      entity_id: entityId,
      primary_ref_id: remoteUpdated ? 'remote-reference' : null,
      status: remoteUpdated ? 'partial' : 'empty',
      updated_at: remoteUpdated ? '2026-08-01T02:00:00.000Z' : timestamp,
      reference_images: remoteUpdated ? [{
        ref_id: 'remote-reference',
        source: 'generated' as const,
        created_at: '2026-08-01T02:00:00.000Z',
      }] : [],
    }));
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const confirmReferenceCandidate = vi.fn().mockResolvedValue(true);
    const { renderer } = await renderScreen({
      confirmReferenceCandidate,
      referenceImagePicker,
    });
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '画像を取り込む（1クレジット）');
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ホームズの取り込み候補',
      }).props.onLoad();
    });

    remoteUpdated = true;
    await press(renderer, '取り込み候補を確定');
    expect(api.confirmEntityReference).not.toHaveBeenCalled();
    expect(textOf(renderer)).toContain('別の処理で参照画像が更新されました');

    await press(renderer, '取り込み候補を確定');
    expect(api.confirmEntityReference).toHaveBeenCalledOnce();
    expect(confirmReferenceCandidate).toHaveBeenCalledWith({
      existingCount: 1,
      language: 'ja',
    });
  });

  it('confirm応答を失った場合は自動再送せず候補をambiguousにする', async () => {
    api.confirmEntityReference.mockRejectedValue(new Error('response lost'));
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const { renderer } = await renderScreen({
      confirmReferenceCandidate: vi.fn().mockResolvedValue(true),
      referenceImagePicker,
    });
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '画像を取り込む（1クレジット）');
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ホームズの取り込み候補',
      }).props.onLoad();
    });
    await press(renderer, '取り込み候補を確定');

    const confirmButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '取り込み候補を確定',
    );
    expect(api.confirmEntityReference).toHaveBeenCalledOnce();
    expect(confirmButton?.props.disabled).toBe(true);
    expect(textOf(renderer)).toContain('確定処理の結果を確認できませんでした');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの取り込み候補' })
        .props.onLoad();
    });
    const afterLatePreview = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '取り込み候補を確定',
    );
    expect(afterLatePreview?.props.disabled).toBe(true);
    expect(api.confirmEntityReference).toHaveBeenCalledOnce();
  });

  it.each([
    [402, 'クレジットが不足しているため画像を解析できませんでした'],
    [413, '画像は5MB以下にしてください'],
    [422, '選択した画像を安全に読み取れませんでした'],
    [429, '画像解析が混み合っています'],
  ])('importのHTTP %i拒否を通信断と混同しない', async (status, message) => {
    api.importEntityReferenceImage.mockRejectedValue(
      new ApiError('REQUEST_FAILED', status, 'private error'),
    );
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const { renderer } = await renderScreen({ referenceImagePicker });
    await selectWork(renderer);
    await selectEntity(renderer);

    await press(renderer, '画像を取り込む（1クレジット）');

    expect(textOf(renderer)).toContain(message);
    expect(textOf(renderer)).not.toContain('private error');
  });

  it('confirmの明確なHTTP拒否は結果不明にせず候補を再確認可能にする', async () => {
    api.confirmEntityReference.mockRejectedValue(
      new ApiError('REQUEST_FAILED', 422, 'private error'),
    );
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const { renderer } = await renderScreen({
      confirmReferenceCandidate: vi.fn().mockResolvedValue(true),
      referenceImagePicker,
    });
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '画像を取り込む（1クレジット）');
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ホームズの取り込み候補',
      }).props.onLoad();
    });

    await press(renderer, '取り込み候補を確定');

    const confirmButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '取り込み候補を確定',
    );
    expect(confirmButton?.props.disabled).toBe(false);
    expect(textOf(renderer)).toContain('候補を確定できませんでした');
    expect(textOf(renderer)).not.toContain('private error');
    expect(textOf(renderer)).not.toContain('確定処理の結果を確認できませんでした');
  });

  it('confirm中は多重送信とEntity・tab移動を止める', async () => {
    let resolveConfirm: ((value: {
      entity_id: string;
      primary_ref_id: string;
      status: 'partial';
      updated_at: string;
      reference_images: {
        ref_id: string;
        source: 'upload';
        created_at: string;
      }[];
    }) => void) | undefined;
    api.confirmEntityReference.mockReturnValue(new Promise((resolve) => {
      resolveConfirm = resolve;
    }));
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const screenRef = createRef<CharactersScreenHandle>();
    const { renderer, ref } = await renderScreen({
      confirmReferenceCandidate: vi.fn().mockResolvedValue(true),
      referenceImagePicker,
    }, screenRef);
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '画像を取り込む（1クレジット）');
    await act(async () => {
      renderer.root.findByProps({
        accessibilityLabel: 'ホームズの取り込み候補',
      }).props.onLoad();
    });
    const confirmButton = renderer.root.findAllByType('button').find(
      (candidate) => candidate.children.join('') === '取り込み候補を確定',
    );

    await act(async () => {
      confirmButton?.props.onClick();
      confirmButton?.props.onClick();
      await flushQueries();
    });
    expect(api.confirmEntityReference).toHaveBeenCalledOnce();
    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);
    await selectEntity(renderer, 'ワトスンを選択');
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズを選択' })
      .props.accessibilityState).toEqual({ selected: true });

    await act(async () => {
      resolveConfirm?.({
        entity_id: 'entity-1',
        primary_ref_id: 'uploaded-reference',
        status: 'partial',
        updated_at: '2026-08-01T01:00:00.000Z',
        reference_images: [{
          ref_id: 'uploaded-reference',
          source: 'upload',
          created_at: '2026-08-01T01:00:00.000Z',
        }],
      });
      await flushQueries();
    });
  });

  it('旧scopeの遅延完了で新scopeのimport離脱ブロックを解除しない', async () => {
    type ImportResponse = {
      suggested_fields: Record<string, unknown>;
      prompt_supplement: string;
      tmp_image_token: string;
    };
    const resolvers: ((value: ImportResponse) => void)[] = [];
    api.importEntityReferenceImage.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));
    const referenceImagePicker = {
      pick: vi.fn().mockResolvedValue({
        dataUrl: 'data:image/jpeg;base64,/9j/AA==',
        sizeBytes: 4,
      }),
    };
    const screenRef = createRef<CharactersScreenHandle>();
    const { renderer, ref, rerender } = await renderScreen({
      referenceImagePicker,
    }, screenRef);
    await selectWork(renderer);
    await selectEntity(renderer);
    await press(renderer, '画像を取り込む（1クレジット）');

    await rerender({ organizationId: 'organization-1' });
    await press(renderer, '画像を取り込む（1クレジット）');
    expect(api.importEntityReferenceImage).toHaveBeenNthCalledWith(
      2,
      'entity-1',
      'character',
      'data:image/jpeg;base64,/9j/AA==',
      'organization-1',
    );

    await act(async () => {
      resolvers[0]?.({
        suggested_fields: {},
        prompt_supplement: '旧scope',
        tmp_image_token: 'old-candidate-token',
      });
      await flushQueries();
    });

    await expect(ref.current?.prepareToLeave()).resolves.toBe(false);

    await act(async () => {
      resolvers[1]?.({
        suggested_fields: {},
        prompt_supplement: '新scope',
        tmp_image_token: 'new-candidate-token',
      });
      await flushQueries();
    });
  });
});
