import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PanelEditingSection,
  type PanelEditingSectionHandle,
} from '../src/components/PanelEditingSection';
import type { PageRecord, PanelRecord, UpdatePanelInput } from '../src/lib/api';
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
const entityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const timestamp = '2026-08-01T00:00:00.000Z';

describe('PanelEditingSection', () => {
  const mountedRenderers: ReactTestRenderer[] = [];
  const api = {
    getPanels: vi.fn(),
    updatePanel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.getPanels.mockResolvedValue({ panels: [buildPanel('panel-1', 1)] });
    api.updatePanel.mockImplementation(async (
      panelId: string,
      body: UpdatePanelInput,
    ) => ({ ...buildPanel(panelId, 1), ...body, updated_at: '2026-08-01T00:00:01.000Z' }));
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  const renderSection = async ({
    pages = [buildPage()],
    ref = createRef<PanelEditingSectionHandle>(),
    resolveDirtyAction,
  }: {
    pages?: PageRecord[];
    ref?: React.RefObject<PanelEditingSectionHandle | null>;
    resolveDirtyAction?: () => Promise<'save' | 'discard' | 'cancel'>;
  } = {}): Promise<{
    queryClient: QueryClient;
    ref: React.RefObject<PanelEditingSectionHandle | null>;
    renderer: ReactTestRenderer;
  }> => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <PanelEditingSection
            api={api}
            generationActive={false}
            language="ja"
            organizationId={organizationId}
            pageListReady
            pages={pages}
            ref={ref}
            resolveDirtyAction={resolveDirtyAction}
            sessionKey="session-1"
          />
        </QueryClientProvider>,
      );
    });
    await act(flushQueries);
    mountedRenderers.push(renderer!);
    return { queryClient, ref, renderer: renderer! };
  };

  const selectPanel = async (
    renderer: ReactTestRenderer,
    pageLabel = 'ページ 1を選択',
    panelLabel = 'コマ 1を選択',
  ): Promise<void> => {
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: pageLabel }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: panelLabel }).props.onPress();
      await Promise.resolve();
    });
  };

  it('変更fieldだけをorganization scope付きで一度だけ保存する', async () => {
    let resolveUpdate: ((panel: PanelRecord) => void) | undefined;
    api.updatePanel.mockReturnValue(new Promise<PanelRecord>((resolve) => {
      resolveUpdate = resolve;
    }));
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '状況' }).props.onChangeText('ワトスが振り返る');
      await Promise.resolve();
    });
    await act(async () => {
      const save = renderer.root.findByProps({ label: 'コマを保存' });
      save.props.onPress();
      save.props.onPress();
      await Promise.resolve();
    });

    expect(api.updatePanel).toHaveBeenCalledTimes(1);
    expect(api.updatePanel).toHaveBeenCalledWith(
      'panel-1',
      { situation_text: 'ワトスが振り返る' },
      organizationId,
    );

    await act(async () => {
      resolveUpdate?.({
        ...buildPanel('panel-1', 1),
        situation_text: 'ワトスが振り返る',
        updated_at: '2026-08-01T00:00:01.000Z',
      });
      await flushQueries();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを保存しました');
  });

  it('保存失敗ではdraftを保持し成功するまで再試行できる', async () => {
    api.updatePanel
      .mockRejectedValueOnce(new Error('raw network detail'))
      .mockImplementationOnce(async (panelId: string, body: UpdatePanelInput) => ({
        ...buildPanel(panelId, 1),
        ...body,
      }));
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '背景' }).props.onChangeText('霧のベーカー街');
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'コマを保存' }).props.onPress();
      await flushQueries();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを保存できませんでした');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('raw network detail');
    expect(renderer.root.findByProps({ accessibilityLabel: '背景' }).props.value).toBe('霧のベーカー街');

    await act(async () => {
      renderer.root.findByProps({ label: 'コマを保存' }).props.onPress();
      await flushQueries();
    });
    expect(api.updatePanel).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを保存しました');
  });

  it('dirty中に保存値が更新された場合はstale保存を拒否してdraftを保持する', async () => {
    const { queryClient, renderer } = await renderSection();
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '状況' }).props.onChangeText('端末側の下書き');
      await Promise.resolve();
    });
    await act(async () => {
      queryClient.setQueryData(
        storyQueryKeys('session-1', organizationId).panels(buildPage().id),
        {
          panels: [{
            ...buildPanel('panel-1', 1),
            situation_text: '別の処理による更新',
            updated_at: '2026-08-01T00:00:02.000Z',
          }],
        },
      );
      await flushQueries();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: '状況' }).props.value)
      .toBe('端末側の下書き');
    expect(renderer.root.findByProps({ label: 'コマを保存' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('別の処理でコマが更新されました');
    expect(api.updatePanel).not.toHaveBeenCalled();
  });

  it('dirty中にPanelが消失した場合もstale保存を拒否してdraftを保持する', async () => {
    const { queryClient, renderer } = await renderSection();
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '背景' }).props.onChangeText('保持する背景');
      await Promise.resolve();
    });
    await act(async () => {
      queryClient.setQueryData(
        storyQueryKeys('session-1', organizationId).panels(buildPage().id),
        { panels: [] },
      );
      await flushQueries();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: '背景' }).props.value)
      .toBe('保持する背景');
    expect(renderer.root.findByProps({ label: 'コマを保存' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('別の処理でコマが更新されました');
    expect(api.updatePanel).not.toHaveBeenCalled();
  });

  it('dirtyのPanel切替でcancelは保持しdiscardだけ次のPanelへ進む', async () => {
    api.getPanels.mockResolvedValue({
      panels: [buildPanel('panel-1', 1), buildPanel('panel-2', 2)],
    });
    const resolveDirtyAction = vi
      .fn<() => Promise<'save' | 'discard' | 'cancel'>>()
      .mockResolvedValueOnce('cancel')
      .mockResolvedValueOnce('discard');
    const { renderer } = await renderSection({ resolveDirtyAction });
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '状況' }).props.onChangeText('未保存');
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: '状況' }).props.value).toBe('未保存');
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 1を選択' }).props.accessibilityState)
      .toEqual({ selected: true });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(renderer.root.findByProps({ accessibilityLabel: '状況' }).props.value).toContain('コマ2');
  });

  it('画面離脱時の保存失敗はfalseを返してdraftを保持する', async () => {
    api.updatePanel.mockRejectedValue(new Error('network'));
    const resolveDirtyAction = vi.fn().mockResolvedValue('save' as const);
    const { ref, renderer } = await renderSection({ resolveDirtyAction });
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'メモ' }).props.onChangeText('未保存メモ');
      await Promise.resolve();
    });

    let canLeave: boolean | undefined;
    await act(async () => {
      canLeave = await ref.current?.prepareToLeave();
      await flushQueries();
    });
    expect(canLeave).toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: 'メモ' }).props.value).toBe('未保存メモ');
  });

  it('コマ0件と一覧取得失敗を別状態として表示する', async () => {
    api.getPanels.mockResolvedValueOnce({ panels: [] });
    const empty = await renderSection();
    await act(async () => {
      empty.renderer.root.findByProps({ accessibilityLabel: 'ページ 1を選択' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
    expect(JSON.stringify(empty.renderer.toJSON())).toContain('コマはまだありません');
    expect(JSON.stringify(empty.renderer.toJSON())).not.toContain('コマを読み込めませんでした');

    api.getPanels.mockRejectedValueOnce(new Error('provider detail'));
    const failed = await renderSection();
    await act(async () => {
      failed.renderer.root.findByProps({ accessibilityLabel: 'ページ 1を選択' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
    expect(JSON.stringify(failed.renderer.toJSON())).toContain('コマを読み込めませんでした');
    expect(JSON.stringify(failed.renderer.toJSON())).toContain('コマを再読み込み');
    expect(JSON.stringify(failed.renderer.toJSON())).not.toContain('コマはまだありません');
    expect(JSON.stringify(failed.renderer.toJSON())).not.toContain('provider detail');
  });

  it.each(['confirmed', 'generating'] as const)('%s Pageはread-onlyで保存しない', async (status) => {
    const { renderer } = await renderSection({ pages: [{ ...buildPage(), status }] });
    await selectPanel(renderer);

    expect(renderer.root.findByProps({ accessibilityLabel: '状況' }).props.editable).toBe(false);
    expect(renderer.root.findByProps({ label: 'コマを保存' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('このページは現在編集できません');
    expect(api.updatePanel).not.toHaveBeenCalled();
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
    episode_id: '22222222-2222-4222-8222-222222222222',
    page_number: 1,
    layout_config: {},
    story_source_scene_ids: [],
    story_page_purpose: null,
    story_continuity_note: null,
    dialogue_mode: 'image_baked',
    page_dialogue_toggle: true,
    generation_mode: null,
    generated_image: null,
    status: 'designing',
    panel_count: 2,
    frame_count: 2,
    balloon_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function buildPanel(id: string, order: number): PanelRecord {
  return {
    id,
    page_id: buildPage().id,
    order,
    panel_role: 'action',
    panel_size: 'standard',
    situation_text: `コマ${order}の状況`,
    entities: [
      {
        entity_id: entityId,
        role: 'primary',
        expression: 'calm',
        custom_expression: null,
        action: 'standing_firm',
        custom_action: null,
        position: 'center',
        facing_direction: null,
        effect_note: null,
        state_id: null,
      },
    ],
    composition: {
      source: 'custom',
      gallery_item_id: null,
      composition_prompt: null,
      shot_type: 'close_up',
      angle: 'front',
      custom_note: null,
    },
    dialogue_in_panel: true,
    dialogue: [
      {
        entity_id: entityId,
        text: `コマ${order}の台詞`,
        type: 'speech',
        position: 'top',
      },
    ],
    sfx_text: null,
    background_note: null,
    panel_notes: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}
