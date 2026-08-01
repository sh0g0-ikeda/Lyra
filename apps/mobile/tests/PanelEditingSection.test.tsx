import React, { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PanelEditingSection,
  type PanelEditingSectionHandle,
} from '../src/components/PanelEditingSection';
import {
  ApiError,
  type EntityRecord,
  type EntityStateRecord,
  type PageRecord,
  type PanelRecord,
  type ReplacePanelEntityAssignmentsInput,
  type UpdatePanelInput,
} from '../src/lib/api';
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
const workId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const entityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const watsonId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const timestamp = '2026-08-01T00:00:00.000Z';

describe('PanelEditingSection', () => {
  const mountedRenderers: ReactTestRenderer[] = [];
  const api = {
    applyPagePanelStructure: vi.fn(),
    getEntitiesPage: vi.fn(),
    getEntityStates: vi.fn(),
    getPanels: vi.fn(),
    replacePanelEntityAssignments: vi.fn(),
    updatePanel: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    api.getEntitiesPage.mockResolvedValue({ entities: [buildEntity()], next_cursor: null });
    api.getEntityStates.mockResolvedValue({ entity_states: [buildEntityState()] });
    api.getPanels.mockResolvedValue({ panels: [buildPanel('panel-1', 1)] });
    api.applyPagePanelStructure.mockResolvedValue(
      buildPanelStructureResponse(['panel-1'], null),
    );
    api.replacePanelEntityAssignments.mockImplementation(async (
      _panelId: string,
      body: ReplacePanelEntityAssignmentsInput,
    ) => ({ entities: body.entities }));
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
    organizationIdValue = organizationId,
    onStructureActiveChange = vi.fn(),
    pages = [buildPage()],
    preparePageSettings = vi.fn().mockResolvedValue(true),
    ref = createRef<PanelEditingSectionHandle>(),
    refreshPages = vi.fn().mockResolvedValue(pages),
    resolvePanelDeleteConfirmation = vi.fn().mockResolvedValue(true),
    resolveDirtyAction,
    sessionKey = 'session-1',
    workIdValue = workId,
  }: {
    organizationIdValue?: string | null;
    onStructureActiveChange?: (active: boolean) => void;
    pages?: PageRecord[];
    preparePageSettings?: () => Promise<boolean>;
    ref?: React.RefObject<PanelEditingSectionHandle | null>;
    refreshPages?: () => Promise<readonly PageRecord[]>;
    resolvePanelDeleteConfirmation?: (panelOrder: number) => Promise<boolean>;
    resolveDirtyAction?: () => Promise<'save' | 'discard' | 'cancel'>;
    sessionKey?: string;
    workIdValue?: string;
  } = {}): Promise<{
    queryClient: QueryClient;
    ref: React.RefObject<PanelEditingSectionHandle | null>;
    rerenderResource(input: {
      organizationIdValue?: string | null;
      sessionKey?: string;
      workIdValue?: string;
    }): Promise<void>;
    rerenderSession(nextSessionKey: string): Promise<void>;
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
            organizationId={organizationIdValue}
            onStructureActiveChange={onStructureActiveChange}
            pageListReady
            pages={pages}
            preparePageSettings={preparePageSettings}
            ref={ref}
            refreshPages={refreshPages}
            resolvePanelDeleteConfirmation={resolvePanelDeleteConfirmation}
            resolveDirtyAction={resolveDirtyAction}
            sessionKey={sessionKey}
            workId={workIdValue}
          />
        </QueryClientProvider>,
      );
    });
    await act(flushQueries);
    mountedRenderers.push(renderer!);
    const rerenderResource = async ({
      organizationIdValue: nextOrganizationId = organizationIdValue,
      sessionKey: nextSessionKey = sessionKey,
      workIdValue: nextWorkId = workIdValue,
    }: {
      organizationIdValue?: string | null;
      sessionKey?: string;
      workIdValue?: string;
    }): Promise<void> => {
      await act(async () => {
        renderer!.update(
          <QueryClientProvider client={queryClient}>
            <PanelEditingSection
              api={api}
              generationActive={false}
              language="ja"
              organizationId={nextOrganizationId}
              onStructureActiveChange={onStructureActiveChange}
              pageListReady
              pages={pages}
              preparePageSettings={preparePageSettings}
              ref={ref}
              refreshPages={refreshPages}
              resolvePanelDeleteConfirmation={resolvePanelDeleteConfirmation}
              resolveDirtyAction={resolveDirtyAction}
              sessionKey={nextSessionKey}
              workId={nextWorkId}
            />
          </QueryClientProvider>,
        );
        await flushQueries();
      });
    };
    return {
      queryClient,
      ref,
      rerenderResource,
      rerenderSession: (nextSessionKey: string) => rerenderResource({
        sessionKey: nextSessionKey,
      }),
      renderer: renderer!,
    };
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
    expect(renderer.root.findByProps({ label: '登場要素を保存' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: 'コマを追加' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: '前へ移動' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: '後ろへ移動' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: '選択中のコマを削除' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('このページは現在編集できません');
    expect(api.updatePanel).not.toHaveBeenCalled();
    expect(api.replacePanelEntityAssignments).not.toHaveBeenCalled();
  });

  it('Page設定を先に解決してから全Panel ID snapshotでappendし権威データだけを採用する', async () => {
    const first = buildPanel('panel-1', 1);
    const second = buildPanel('panel-2', 2);
    const created = buildPanel('panel-3', 3);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first, second] })
      .mockResolvedValueOnce({ panels: [first, second, created] });
    api.applyPagePanelStructure.mockResolvedValue(
      buildPanelStructureResponse(['panel-1', 'panel-2', 'panel-3'], 'panel-3'),
    );
    const preparePageSettings = vi.fn().mockResolvedValue(true);
    const refreshPages = vi.fn().mockResolvedValue([{
      ...buildPage(),
      panel_count: 3,
      frame_count: 3,
      updated_at: '2026-08-01T00:00:02.000Z',
    }]);
    const { renderer } = await renderSection({ preparePageSettings, refreshPages });
    await selectPanel(renderer);

    await act(async () => {
      const append = renderer.root.findByProps({ label: 'コマを追加' });
      append.props.onPress();
      append.props.onPress();
      await flushQueries();
    });

    expect(preparePageSettings).toHaveBeenCalledTimes(1);
    expect(api.applyPagePanelStructure).toHaveBeenCalledTimes(1);
    expect(api.applyPagePanelStructure).toHaveBeenCalledWith(
      buildPage().id,
      {
        expected_panel_ids: ['panel-1', 'panel-2'],
        operation: { type: 'append' },
      },
      organizationId,
    );
    expect(preparePageSettings.mock.invocationCallOrder[0])
      .toBeLessThan(api.applyPagePanelStructure.mock.invocationCallOrder[0]!);
    expect(api.getPanels).toHaveBeenCalledTimes(2);
    expect(refreshPages).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 3を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを追加しました');
  });

  it('0 PanelのPageは空snapshotでappendし新しいPanelを選択する', async () => {
    const created = buildPanel('panel-1', 1);
    api.getPanels
      .mockResolvedValueOnce({ panels: [] })
      .mockResolvedValueOnce({ panels: [created] });
    api.applyPagePanelStructure.mockResolvedValue(
      buildPanelStructureResponse(['panel-1'], 'panel-1'),
    );
    const emptyPage = { ...buildPage(), panel_count: 0, frame_count: 0 };
    const refreshPages = vi.fn().mockResolvedValue([{
      ...emptyPage,
      panel_count: 1,
      frame_count: 1,
    }]);
    const { renderer } = await renderSection({ pages: [emptyPage], refreshPages });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ページ 1を選択' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await flushQueries();
    });
    expect(renderer.root.findByProps({ label: 'コマを追加' }).props.disabled).toBe(false);

    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await flushQueries();
    });

    expect(api.applyPagePanelStructure).toHaveBeenCalledWith(
      emptyPage.id,
      { expected_panel_ids: [], operation: { type: 'append' } },
      organizationId,
    );
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 1を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
  });

  it('選択Panelを隣接移動し全IDを送って選択をIDで維持する', async () => {
    const first = buildPanel('panel-1', 1);
    const second = buildPanel('panel-2', 2);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first, second] })
      .mockResolvedValueOnce({
        panels: [{ ...second, order: 1 }, { ...first, order: 2 }],
      });
    api.applyPagePanelStructure.mockResolvedValue(
      buildPanelStructureResponse(['panel-2', 'panel-1'], null, null),
    );
    const refreshPages = vi.fn().mockResolvedValue([buildPage()]);
    const { renderer } = await renderSection({ refreshPages });
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: '後ろへ移動' }).props.onPress();
      await flushQueries();
    });

    expect(api.applyPagePanelStructure).toHaveBeenCalledWith(
      buildPage().id,
      {
        expected_panel_ids: ['panel-1', 'panel-2'],
        operation: { type: 'reorder', panel_ids: ['panel-2', 'panel-1'] },
      },
      organizationId,
    );
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを移動しました');
  });

  it('削除確認後だけ削除し同じ位置の次Panelを選び最後の1件は削除しない', async () => {
    const first = buildPanel('panel-1', 1);
    const second = buildPanel('panel-2', 2);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first, second] })
      .mockResolvedValueOnce({ panels: [{ ...second, order: 1 }] });
    api.applyPagePanelStructure.mockResolvedValue(
      buildPanelStructureResponse(['panel-2'], null),
    );
    const resolvePanelDeleteConfirmation = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const refreshPages = vi.fn().mockResolvedValue([{
      ...buildPage(),
      panel_count: 1,
      frame_count: 1,
    }]);
    const { renderer } = await renderSection({
      refreshPages,
      resolvePanelDeleteConfirmation,
    });
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: '選択中のコマを削除' }).props.onPress();
      await flushQueries();
    });
    expect(api.applyPagePanelStructure).not.toHaveBeenCalled();

    await act(async () => {
      renderer.root.findByProps({ label: '選択中のコマを削除' }).props.onPress();
      await flushQueries();
    });

    expect(resolvePanelDeleteConfirmation).toHaveBeenNthCalledWith(2, 1);
    expect(api.applyPagePanelStructure).toHaveBeenCalledWith(
      buildPage().id,
      {
        expected_panel_ids: ['panel-1', 'panel-2'],
        operation: { type: 'delete', panel_id: 'panel-1' },
      },
      organizationId,
    );
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 1を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(renderer.root.findByProps({ label: '選択中のコマを削除' }).props.disabled).toBe(true);
  });

  it('Page設定またはPanel dirtyの解決失敗時は構造変更を送信しない', async () => {
    const first = buildPanel('panel-1', 1);
    const second = buildPanel('panel-2', 2);
    api.getPanels.mockResolvedValue({ panels: [first, second] });
    const preparePageSettings = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const resolveDirtyAction = vi.fn().mockResolvedValue('cancel' as const);
    const { renderer } = await renderSection({ preparePageSettings, resolveDirtyAction });
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '状況' }).props.onChangeText('未保存');
      await Promise.resolve();
    });

    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await flushQueries();
    });
    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await flushQueries();
    });

    expect(preparePageSettings).toHaveBeenCalledTimes(2);
    expect(resolveDirtyAction).toHaveBeenCalledOnce();
    expect(api.applyPagePanelStructure).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: '状況' }).props.value).toBe('未保存');
  });

  it('受付直後に編集を固定しても受付前のPanel dirtyは保存してから構造変更する', async () => {
    const first = buildPanel('panel-1', 1);
    const saved = {
      ...first,
      situation_text: '受付前の未保存内容',
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    const created = buildPanel('panel-2', 2);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first] })
      .mockResolvedValueOnce({ panels: [saved, created] });
    api.updatePanel.mockResolvedValue(saved);
    api.applyPagePanelStructure.mockResolvedValue(
      buildPanelStructureResponse(['panel-1', 'panel-2'], 'panel-2'),
    );
    const refreshPages = vi.fn().mockResolvedValue([{
      ...buildPage(),
      panel_count: 2,
      frame_count: 2,
    }]);
    const resolveDirtyAction = vi.fn().mockResolvedValue('save' as const);
    const { renderer } = await renderSection({ refreshPages, resolveDirtyAction });
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '状況' })
        .props.onChangeText('受付前の未保存内容');
      await Promise.resolve();
    });

    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await flushQueries();
    });

    expect(api.updatePanel).toHaveBeenCalledOnce();
    expect(api.applyPagePanelStructure).toHaveBeenCalledOnce();
    expect(api.updatePanel.mock.invocationCallOrder[0])
      .toBeLessThan(api.applyPagePanelStructure.mock.invocationCallOrder[0]!);
    expect(api.getPanels).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを追加しました');
  });

  it('appendの応答喪失は再送せず権威一覧で適用済みと確認する', async () => {
    const first = buildPanel('panel-1', 1);
    const created = buildPanel('panel-2', 2);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first] })
      .mockResolvedValueOnce({ panels: [first, created] });
    api.applyPagePanelStructure.mockRejectedValue(new ApiError(
      'NETWORK_ERROR',
      0,
      'private network detail',
    ));
    const refreshPages = vi.fn().mockResolvedValue([{
      ...buildPage(),
      panel_count: 2,
      frame_count: 2,
    }]);
    const { renderer } = await renderSection({ refreshPages });
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await flushQueries();
    });

    expect(api.applyPagePanelStructure).toHaveBeenCalledTimes(1);
    expect(api.getPanels).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを追加しました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('private network detail');
  });

  it.each([
    ['5xx', new ApiError('SERVER_ERROR', 503, 'private server detail')],
    ['invalid response', new ApiError('INVALID_API_RESPONSE', 502, 'private payload detail')],
  ])('%sでもmutationは再送せず権威一覧だけで適用済みを確認する', async (_label, failure) => {
    const first = buildPanel('panel-1', 1);
    const created = buildPanel('panel-2', 2);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first] })
      .mockResolvedValueOnce({ panels: [first, created] });
    api.applyPagePanelStructure.mockRejectedValue(failure);
    const refreshPages = vi.fn().mockResolvedValue([{
      ...buildPage(),
      panel_count: 2,
      frame_count: 2,
    }]);
    const { renderer } = await renderSection({ refreshPages });
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await flushQueries();
    });

    expect(api.applyPagePanelStructure).toHaveBeenCalledTimes(1);
    expect(refreshPages).toHaveBeenCalledOnce();
    expect(api.getPanels).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを追加しました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain(failure.message);
  });

  it('構造変更中の画面離脱は権威再取得の完了まで待つ', async () => {
    const first = buildPanel('panel-1', 1);
    const created = buildPanel('panel-2', 2);
    let resolveStructure: ((value: ReturnType<typeof buildPanelStructureResponse>) => void)
      | undefined;
    api.getPanels
      .mockResolvedValueOnce({ panels: [first] })
      .mockResolvedValueOnce({ panels: [first, created] });
    api.applyPagePanelStructure.mockReturnValue(new Promise((resolve) => {
      resolveStructure = resolve;
    }));
    const refreshPages = vi.fn().mockResolvedValue([{
      ...buildPage(),
      panel_count: 2,
      frame_count: 2,
    }]);
    const { ref, renderer } = await renderSection({ refreshPages });
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await flushQueries();
    });
    expect(api.applyPagePanelStructure).toHaveBeenCalledOnce();

    let leaveSettled = false;
    const leavePromise = ref.current!.prepareToLeave().then((result) => {
      leaveSettled = true;
      return result;
    });
    await Promise.resolve();
    expect(leaveSettled).toBe(false);

    let canLeave = false;
    await act(async () => {
      resolveStructure?.(buildPanelStructureResponse(['panel-1', 'panel-2'], 'panel-2'));
      canLeave = await leavePromise;
      await flushQueries();
    });
    expect(canLeave).toBe(true);
    expect(refreshPages).toHaveBeenCalledOnce();
    expect(api.getPanels).toHaveBeenCalledTimes(2);
  });

  it('definitive failure後に別操作が要求順へ変更しても自分の成功とは表示しない', async () => {
    const first = buildPanel('panel-1', 1);
    const second = buildPanel('panel-2', 2);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first, second] })
      .mockResolvedValueOnce({
        panels: [{ ...second, order: 1 }, { ...first, order: 2 }],
      });
    api.applyPagePanelStructure.mockRejectedValue(
      new ApiError('INVALID_REQUEST', 422, 'private validation detail'),
    );
    const refreshPages = vi.fn().mockResolvedValue([buildPage()]);
    const { renderer } = await renderSection({ refreshPages });
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: '後ろへ移動' }).props.onPress();
      await flushQueries();
    });

    expect(api.applyPagePanelStructure).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(JSON.stringify(renderer.toJSON())).toContain('コマ構造を変更できませんでした');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('コマを移動しました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('private validation detail');
  });

  it('結果不明で再取得できない場合は自動再送せず手動確認だけを行う', async () => {
    const first = buildPanel('panel-1', 1);
    const created = buildPanel('panel-2', 2);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first] })
      .mockRejectedValueOnce(new Error('temporary read failure'))
      .mockResolvedValueOnce({ panels: [first, created] });
    api.applyPagePanelStructure.mockRejectedValue(new ApiError('NETWORK_ERROR', 0, 'network'));
    const refreshPages = vi.fn().mockResolvedValue([{
      ...buildPage(),
      panel_count: 2,
      frame_count: 2,
    }]);
    const { ref, renderer } = await renderSection({ refreshPages });
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await flushQueries();
    });
    expect(renderer.root.findByProps({ label: 'コマを追加' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('変更結果を確認できません');

    expect(await ref.current?.prepareToLeave()).toBe(false);
    expect(api.applyPagePanelStructure).toHaveBeenCalledTimes(1);
    expect(api.getPanels).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer.root.findByProps({ label: '最新のコマ構造を確認' }).props.onPress();
      await flushQueries();
    });

    expect(api.applyPagePanelStructure).toHaveBeenCalledTimes(1);
    expect(api.getPanels).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(renderer.toJSON())).toContain('コマを追加しました');
  });

  it('409ではmutationを再送せずremoteの権威順へ更新する', async () => {
    const first = buildPanel('panel-1', 1);
    const second = buildPanel('panel-2', 2);
    api.getPanels
      .mockResolvedValueOnce({ panels: [first, second] })
      .mockResolvedValueOnce({
        panels: [{ ...second, order: 1 }, { ...first, order: 2 }],
      });
    api.applyPagePanelStructure.mockRejectedValue(
      new ApiError('CONFLICT', 409, 'private conflict detail'),
    );
    const refreshPages = vi.fn().mockResolvedValue([buildPage()]);
    const { renderer } = await renderSection({ refreshPages });
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ label: '後ろへ移動' }).props.onPress();
      await flushQueries();
    });

    expect(api.applyPagePanelStructure).toHaveBeenCalledTimes(1);
    expect(api.getPanels).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(JSON.stringify(renderer.toJSON())).toContain('別の処理でコマ構造が変更されました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('private conflict detail');
  });

  it('旧sessionで失敗した構造変更は新sessionで再取得も表示更新もしない', async () => {
    let rejectStructure: ((error: unknown) => void) | undefined;
    api.applyPagePanelStructure.mockReturnValue(new Promise((_resolve, reject) => {
      rejectStructure = reject;
    }));
    const refreshPages = vi.fn().mockResolvedValue([buildPage()]);
    const { renderer, rerenderSession } = await renderSection({ refreshPages });
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await Promise.resolve();
    });
    expect(api.applyPagePanelStructure).toHaveBeenCalledOnce();

    await rerenderSession('session-2');
    const panelReadsAfterScopeChange = api.getPanels.mock.calls.length;
    const pageReadsAfterScopeChange = refreshPages.mock.calls.length;
    await act(async () => {
      rejectStructure?.(new ApiError('NETWORK_ERROR', 0, 'old scope failure'));
      await flushQueries();
    });

    expect(refreshPages).toHaveBeenCalledTimes(pageReadsAfterScopeChange);
    expect(api.getPanels).toHaveBeenCalledTimes(panelReadsAfterScopeChange);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('変更結果を確認できません');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('old scope failure');
  });

  it.each([
    [
      'organization',
      { organizationIdValue: '99999999-9999-4999-8999-999999999999' },
    ],
    [
      'work',
      { workIdValue: '77777777-7777-4777-8777-777777777777' },
    ],
  ])('旧%s scopeの遅延成功を新scopeのcache・表示・再取得に混ぜない', async (_label, nextScope) => {
    let resolveStructure: ((value: ReturnType<typeof buildPanelStructureResponse>) => void)
      | undefined;
    api.applyPagePanelStructure.mockReturnValue(new Promise((resolve) => {
      resolveStructure = resolve;
    }));
    const refreshPages = vi.fn().mockResolvedValue([buildPage()]);
    const { renderer, rerenderResource } = await renderSection({ refreshPages });
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ label: 'コマを追加' }).props.onPress();
      await Promise.resolve();
    });
    expect(api.applyPagePanelStructure).toHaveBeenCalledOnce();

    await rerenderResource(nextScope);
    const panelReadsAfterScopeChange = api.getPanels.mock.calls.length;
    const pageReadsAfterScopeChange = refreshPages.mock.calls.length;
    await act(async () => {
      resolveStructure?.(buildPanelStructureResponse(['panel-1', 'panel-2'], 'panel-2'));
      await flushQueries();
    });

    expect(api.getPanels).toHaveBeenCalledTimes(panelReadsAfterScopeChange);
    expect(refreshPages).toHaveBeenCalledTimes(pageReadsAfterScopeChange);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('コマを追加しました');
  });

  it('8件上限と未選択・端の移動をUIでも送信前に無効化する', async () => {
    api.getPanels.mockResolvedValue({
      panels: Array.from({ length: 8 }, (_, index) => buildPanel(`panel-${index + 1}`, index + 1)),
    });
    const { renderer } = await renderSection();
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ページ 1を選択' }).props.onPress();
      await flushQueries();
    });

    expect(renderer.root.findByProps({ label: 'コマを追加' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: '前へ移動' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: '後ろへ移動' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: '選択中のコマを削除' }).props.disabled).toBe(true);
    expect(api.applyPagePanelStructure).not.toHaveBeenCalled();
  });

  it('assignmentはexpected snapshotで保存しauthoritative再取得後だけ採用する', async () => {
    const initial = buildPanel('panel-1', 1);
    const updated: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({
        ...assignment,
        role: 'secondary',
      })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockResolvedValueOnce({ panels: [updated] });
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledWith(
      'panel-1',
      {
        entities: [{ ...initial.entities[0]!, role: 'secondary' }],
        expected_entities: initial.entities,
      },
      organizationId,
    );
    expect(api.getPanels).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer.toJSON())).toContain('登場要素を保存しました');
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.accessibilityState)
      .toMatchObject({ selected: true });
  });

  it('assignment PUT後の再取得失敗ではdraftを保持し自動再送しない', async () => {
    api.getPanels
      .mockResolvedValueOnce({ panels: [buildPanel('panel-1', 1)] })
      .mockRejectedValueOnce(new Error('network'));
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledTimes(1);
    expect(api.getPanels).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer.toJSON())).toContain('保存結果を確認できません');
    expect(renderer.root.findByProps({ label: '登場要素を保存' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ label: '保存結果を再確認' })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.accessibilityState)
      .toMatchObject({ selected: true });
  });

  it('assignmentの409ではdraftを保持して再取得を自動実行しない', async () => {
    api.replacePanelEntityAssignments.mockRejectedValueOnce(
      new ApiError('REQUEST_FAILED', 409, 'raw conflict detail'),
    );
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledTimes(1);
    expect(api.getPanels).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('別の処理で登場要素が更新されました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('raw conflict detail');
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.accessibilityState)
      .toMatchObject({ selected: true });
  });

  it('assignmentの422では編集可能なdraftを保持して再確認を要求しない', async () => {
    api.replacePanelEntityAssignments.mockRejectedValueOnce(
      new ApiError('VALIDATION_ERROR', 422, 'raw validation detail'),
    );
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledTimes(1);
    expect(api.getPanels).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('登場要素を保存できませんでした');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('raw validation detail');
    expect(renderer.root.findAllByProps({ label: '保存結果を再確認' })).toHaveLength(0);
    expect(renderer.root.findByProps({ label: '登場要素を保存' }).props.disabled).toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.accessibilityState)
      .toMatchObject({ selected: true });
  });

  it('authoritative再取得がdesiredと異なる場合はcacheへ採用せず競合にする', async () => {
    const initial = buildPanel('panel-1', 1);
    const thirdValue: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({ ...assignment, role: 'background' })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockResolvedValueOnce({ panels: [thirdValue] });
    const { queryClient, renderer } = await renderSection();
    await selectPanel(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('別の処理で登場要素が更新されました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('登場要素を保存しました');
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.accessibilityState)
      .toMatchObject({ selected: true });
    expect(renderer.root.findByProps({ label: '登場要素を保存' }).props.disabled).toBe(true);
    expect(queryClient.getQueryData(
      storyQueryKeys('session-1', organizationId).panels(initial.page_id),
    )).toEqual({ panels: [initial] });
  });

  it('保存済み会話の話者はassignmentから外せない', async () => {
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    expect(renderer.root.findByProps({ label: 'ホームズを割当から外す' }).props.disabled).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('保存済みセリフの話者は外せません');
  });

  it('内容とassignmentのdirtyを同時に作らない', async () => {
    const contentFirst = await renderSection();
    await selectPanel(contentFirst.renderer);
    await act(async () => {
      contentFirst.renderer.root.findByProps({ accessibilityLabel: '状況' })
        .props.onChangeText('内容の下書き');
      await Promise.resolve();
    });
    expect(contentFirst.renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' })
      .props.disabled).toBe(true);

    const assignmentFirst = await renderSection();
    await selectPanel(assignmentFirst.renderer);
    await act(async () => {
      assignmentFirst.renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' })
        .props.onPress();
      await Promise.resolve();
    });
    expect(assignmentFirst.renderer.root.findByProps({ accessibilityLabel: '状況' }).props.editable)
      .toBe(false);
    expect(assignmentFirst.renderer.root.findByProps({ label: 'コマを保存' }).props.disabled).toBe(true);
  });

  it('選んだEntity stateをassignmentへ保存する', async () => {
    const initial = buildPanel('panel-1', 1);
    const updated: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({ ...assignment, state_id: stateId })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockResolvedValueOnce({ panels: [updated] });
    const { renderer } = await renderSection();
    await selectPanel(renderer);
    await act(flushQueries);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの状態: 状態 1' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledWith(
      'panel-1',
      expect.objectContaining({
        entities: [expect.objectContaining({ state_id: stateId })],
        expected_entities: initial.entities,
      }),
      organizationId,
    );
  });

  it('一覧にない保存済みstate_idを表示・保持して別fieldを保存する', async () => {
    const initial = {
      ...buildPanel('panel-1', 1),
      entities: buildPanel('panel-1', 1).entities.map((assignment) => ({
        ...assignment,
        state_id: stateId,
      })),
    };
    const updated: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({ ...assignment, role: 'secondary' })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    api.getEntityStates.mockResolvedValueOnce({ entity_states: [] });
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockResolvedValueOnce({ panels: [updated] });
    const { renderer } = await renderSection();
    await selectPanel(renderer);
    await act(flushQueries);

    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの状態: 不明または削除済みの状態' })
      .props.accessibilityState).toMatchObject({ selected: true });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledWith(
      'panel-1',
      expect.objectContaining({
        entities: [expect.objectContaining({ role: 'secondary', state_id: stateId })],
        expected_entities: initial.entities,
      }),
      organizationId,
    );
  });

  it('state一覧の取得失敗でもstate_idを消さず別fieldを保存できる', async () => {
    const initial = {
      ...buildPanel('panel-1', 1),
      entities: buildPanel('panel-1', 1).entities.map((assignment) => ({
        ...assignment,
        state_id: stateId,
      })),
    };
    const updated: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({ ...assignment, role: 'secondary' })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    api.getEntityStates.mockRejectedValueOnce(new Error('state list unavailable'));
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockResolvedValueOnce({ panels: [updated] });
    const { renderer } = await renderSection();
    await selectPanel(renderer);
    await act(flushQueries);

    expect(JSON.stringify(renderer.toJSON())).toContain('この登場要素の状態を読み込めませんでした');
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledWith(
      'panel-1',
      expect.objectContaining({
        entities: [expect.objectContaining({ role: 'secondary', state_id: stateId })],
        expected_entities: initial.entities,
      }),
      organizationId,
    );
  });

  it('assignmentの表情・動作・配置・向き・効果メモを既存field名で保存する', async () => {
    const initial = buildPanel('panel-1', 1);
    const expectedAssignment: PanelRecord['entities'][number] = {
      ...initial.entities[0]!,
      expression: 'custom',
      custom_expression: '鋭い観察眼',
      action: 'custom',
      custom_action: '虫眼鏡を掲げる',
      position: 'left',
      facing_direction: 'right',
      effect_note: '背後に集中線',
    };
    const updated: PanelRecord = {
      ...initial,
      entities: [expectedAssignment],
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockResolvedValueOnce({ panels: [updated] });
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    const actions: (() => void)[] = [
      () => renderer.root.findByProps({ accessibilityLabel: 'ホームズの表情: 自由入力' }).props.onPress(),
      () => renderer.root.findByProps({ accessibilityLabel: 'ホームズの自由入力の表情' })
        .props.onChangeText('鋭い観察眼'),
      () => renderer.root.findByProps({ accessibilityLabel: 'ホームズの動作: 自由入力' }).props.onPress(),
      () => renderer.root.findByProps({ accessibilityLabel: 'ホームズの自由入力の動作' })
        .props.onChangeText('虫眼鏡を掲げる'),
      () => renderer.root.findByProps({ accessibilityLabel: 'ホームズの配置: 左' }).props.onPress(),
      () => renderer.root.findByProps({ accessibilityLabel: 'ホームズの向き: 右向き' }).props.onPress(),
      () => renderer.root.findByProps({ accessibilityLabel: 'ホームズの効果メモ' })
        .props.onChangeText('背後に集中線'),
    ];
    for (const action of actions) {
      await act(async () => {
        action();
        await Promise.resolve();
      });
    }
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledWith(
      'panel-1',
      {
        entities: [expectedAssignment],
        expected_entities: initial.entities,
      },
      organizationId,
    );
  });

  it('assignment保存はsingle-flightで連打しても一度だけ送る', async () => {
    const initial = buildPanel('panel-1', 1);
    const updated: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({ ...assignment, role: 'secondary' })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    let resolveReplace: ((value: { entities: PanelRecord['entities'] }) => void) | undefined;
    api.replacePanelEntityAssignments.mockReturnValue(
      new Promise<{ entities: PanelRecord['entities'] }>((resolve) => {
        resolveReplace = resolve;
      }),
    );
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockResolvedValueOnce({ panels: [updated] });
    const { renderer } = await renderSection();
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      const save = renderer.root.findByProps({ label: '登場要素を保存' });
      save.props.onPress();
      save.props.onPress();
      await Promise.resolve();
    });
    expect(api.replacePanelEntityAssignments).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReplace?.({ entities: updated.entities });
      await flushQueries();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('登場要素を保存しました');
  });

  it('assignment保存中のPanel切替は保存完了まで待ってから遷移する', async () => {
    const initial = buildPanel('panel-1', 1);
    const second = buildPanel('panel-2', 2);
    const updated: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({ ...assignment, role: 'secondary' })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    let resolveReplace: ((value: { entities: PanelRecord['entities'] }) => void) | undefined;
    api.replacePanelEntityAssignments.mockReturnValue(
      new Promise<{ entities: PanelRecord['entities'] }>((resolve) => {
        resolveReplace = resolve;
      }),
    );
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial, second] })
      .mockResolvedValueOnce({ panels: [updated, second] });
    const { renderer } = await renderSection();
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 1を選択' }).props.accessibilityState)
      .toEqual({ selected: true });

    await act(async () => {
      resolveReplace?.({ entities: updated.entities });
      await flushQueries();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 主役' }).props.accessibilityState)
      .toMatchObject({ selected: true });
  });

  it('assignment保存中のPage切替は保存完了まで待ってから遷移する', async () => {
    const firstPage = buildPage();
    const secondPage = buildPage('33333333-3333-4333-8333-333333333333', 2);
    const initial = buildPanel('panel-1', 1, firstPage.id);
    const updated: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({ ...assignment, role: 'secondary' })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    let resolveReplace: ((value: { entities: PanelRecord['entities'] }) => void) | undefined;
    api.replacePanelEntityAssignments.mockReturnValue(
      new Promise<{ entities: PanelRecord['entities'] }>((resolve) => {
        resolveReplace = resolve;
      }),
    );
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockResolvedValueOnce({ panels: [updated] })
      .mockResolvedValueOnce({ panels: [] });
    const { renderer } = await renderSection({ pages: [firstPage, secondPage] });
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ページ 2を選択' }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'ページ 1を選択' }).props.accessibilityState)
      .toEqual({ selected: true });

    await act(async () => {
      resolveReplace?.({ entities: updated.entities });
      await flushQueries();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: 'ページ 2を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('登場要素を保存しました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('ホームズ');
  });

  it('session scope変更中に完了したassignment保存を新scopeへ反映しない', async () => {
    const initial = buildPanel('panel-1', 1);
    let resolveReplace: ((value: { entities: PanelRecord['entities'] }) => void) | undefined;
    api.replacePanelEntityAssignments.mockReturnValue(
      new Promise<{ entities: PanelRecord['entities'] }>((resolve) => {
        resolveReplace = resolve;
      }),
    );
    const { renderer, rerenderSession } = await renderSection();
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await Promise.resolve();
    });
    expect(api.replacePanelEntityAssignments).toHaveBeenCalledTimes(1);

    await rerenderSession('session-2');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('登場要素を保存しました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('ホームズ');
    const panelReadsBeforeOldCompletion = api.getPanels.mock.calls.length;

    await act(async () => {
      resolveReplace?.({
        entities: initial.entities.map((assignment) => ({ ...assignment, role: 'secondary' })),
      });
      await flushQueries();
    });

    expect(api.getPanels).toHaveBeenCalledTimes(panelReadsBeforeOldCompletion);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('登場要素を保存しました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('ホームズ');
  });

  it.each([
    ['organization', { organizationIdValue: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
    ['work', { workIdValue: '99999999-9999-4999-8999-999999999999' }],
  ] as const)('%s scope変更中に完了したassignment保存を新scopeへ反映しない', async (
    _scopeName,
    nextResource,
  ) => {
    const initial = buildPanel('panel-1', 1);
    let resolveReplace: ((value: { entities: PanelRecord['entities'] }) => void) | undefined;
    api.replacePanelEntityAssignments.mockReturnValue(
      new Promise<{ entities: PanelRecord['entities'] }>((resolve) => {
        resolveReplace = resolve;
      }),
    );
    const { renderer, rerenderResource } = await renderSection();
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await Promise.resolve();
    });
    expect(api.replacePanelEntityAssignments).toHaveBeenCalledTimes(1);

    await rerenderResource(nextResource);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('登場要素を保存しました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('ホームズ');
    const panelReadsBeforeOldCompletion = api.getPanels.mock.calls.length;

    await act(async () => {
      resolveReplace?.({
        entities: initial.entities.map((assignment) => ({ ...assignment, role: 'secondary' })),
      });
      await flushQueries();
    });

    expect(api.getPanels).toHaveBeenCalledTimes(panelReadsBeforeOldCompletion);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('登場要素を保存しました');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('ホームズ');
  });

  it('結果不明のassignment保存を手動再確認してdesiredなら成功として採用する', async () => {
    const initial = buildPanel('panel-1', 1);
    const updated: PanelRecord = {
      ...initial,
      entities: initial.entities.map((assignment) => ({ ...assignment, role: 'secondary' })),
      updated_at: '2026-08-01T00:00:01.000Z',
    };
    api.getPanels
      .mockResolvedValueOnce({ panels: [initial] })
      .mockRejectedValueOnce(new Error('temporary network'))
      .mockResolvedValueOnce({ panels: [updated] });
    const { renderer } = await renderSection();
    await selectPanel(renderer);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素を保存' }).props.onPress();
      await flushQueries();
    });

    await act(async () => {
      renderer.root.findByProps({ label: '保存結果を再確認' }).props.onPress();
      await flushQueries();
    });

    expect(api.replacePanelEntityAssignments).toHaveBeenCalledTimes(1);
    expect(api.getPanels).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(renderer.toJSON())).toContain('登場要素を保存しました');
    expect(renderer.root.findByProps({ label: '登場要素を保存' }).props.disabled).toBe(true);
  });

  it('Entity一覧はnext cursorがある場合だけ追加読込して候補を追加する', async () => {
    api.getEntitiesPage
      .mockResolvedValueOnce({ entities: [buildEntity()], next_cursor: 'page-2' })
      .mockResolvedValueOnce({ entities: [buildEntity(watsonId, 'ワトス')], next_cursor: null });
    const { renderer } = await renderSection();
    await selectPanel(renderer);

    expect(renderer.root.findByProps({ label: '登場要素をさらに読み込む' })).toBeDefined();
    await act(async () => {
      renderer.root.findByProps({ label: '登場要素をさらに読み込む' }).props.onPress();
      await flushQueries();
    });

    expect(api.getEntitiesPage).toHaveBeenNthCalledWith(
      2,
      workId,
      { limit: 50, cursor: 'page-2' },
      organizationId,
    );
    await act(async () => {
      renderer.root.findByProps({ label: 'ワトスを追加' }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({ label: 'ワトスを割当から外す' })).toBeDefined();
    expect(renderer.root.findByProps({ label: '登場要素を保存' }).props.disabled).toBe(false);
  });

  it('assignment dirtyのPanel切替でcancelは保持しdiscardだけ次へ進む', async () => {
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
      renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.onPress();
      await Promise.resolve();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 1を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 補助' }).props.accessibilityState)
      .toMatchObject({ selected: true });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.onPress();
      await flushQueries();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'コマ 2を選択' }).props.accessibilityState)
      .toEqual({ selected: true });
    expect(renderer.root.findByProps({ accessibilityLabel: 'ホームズの役割: 主役' }).props.accessibilityState)
      .toMatchObject({ selected: true });
  });
});

async function flushQueries(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function buildPage(
  id = '11111111-1111-4111-8111-111111111111',
  pageNumber = 1,
): PageRecord {
  return {
    id,
    episode_id: '22222222-2222-4222-8222-222222222222',
    page_number: pageNumber,
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

function buildPanel(
  id: string,
  order: number,
  pageId = buildPage().id,
): PanelRecord {
  return {
    id,
    page_id: pageId,
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

function buildPanelStructureResponse(
  panelIds: string[],
  createdPanelId: string | null,
  layoutTemplateId: 'splash_1' | null = 'splash_1',
) {
  return {
    panel_ids: panelIds,
    created_panel_id: createdPanelId,
    layout_template_id: layoutTemplateId,
    frames: panelIds.map((panelId, index) => ({
      id: `frame-${index + 1}`,
      page_id: buildPage().id,
      panel_id: panelId,
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
      border_style: 'solid' as const,
      border_width: 1,
      border_color: '#000000',
      z_index: index,
      reading_order: index + 1,
    })),
    balloon_reference_updated_count: 0,
    balloon_reference_cleared_count: 0,
  };
}

function buildEntity(id = entityId, name = 'ホームズ'): EntityRecord {
  return {
    id,
    work_id: workId,
    entity_type: 'character',
    name,
    free_description: null,
    structured_fields: {},
    prompt_supplement: null,
    speech_profile: {},
    status: 'ready',
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function buildEntityState(): EntityStateRecord {
  return {
    id: stateId,
    entity_id: entityId,
    scene_id: null,
    costume_note: '外套',
    condition_note: null,
    hair_note: null,
    expression_default: 'calm',
    extra_note: null,
    costume_ref_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}
