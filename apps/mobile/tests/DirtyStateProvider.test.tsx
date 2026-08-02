import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import type { DirtyStateChoice } from '@/domain/dirtyStatePolicy';
import {
  DirtyStateProvider,
  useDirtyEditorRegistration,
  useDirtyState
} from '@/state/dirtyState';

vi.mock('@/lib/confirm', () => ({
  requestUnsavedChangesResolution: (): Promise<DirtyStateChoice> =>
    new Promise(() => undefined)
}));

vi.mock('@/components/UnsavedChangesResolutionDialog', () => ({
  UnsavedChangesResolutionDialog: ({
    onSelect,
    visible
  }: {
    onSelect: (choice: DirtyStateChoice) => void;
    visible: boolean;
  }): React.JSX.Element =>
    React.createElement('dirty-resolution-dialog', { onSelect, visible })
}));

interface ProbeValue {
  hasDirtyEditors: boolean;
  hasNavigationBlockingEditors: boolean;
  resolve: () => Promise<boolean>;
  saveWithoutPrompt: () => Promise<boolean>;
}

function Probe({
  blocksNavigation,
  dirty,
  onValue,
  revision,
  save,
  discard
}: {
  blocksNavigation?: boolean;
  dirty: boolean;
  onValue: (value: ProbeValue) => void;
  revision?: string;
  save: () => Promise<void>;
  discard: () => void;
}): React.JSX.Element {
  const dirtyState = useDirtyState();
  useDirtyEditorRegistration({
    id: 'editor-1',
    blocksNavigation,
    dirty,
    revision,
    save,
    discard
  });

  useEffect(() => {
    onValue({
      hasDirtyEditors: dirtyState.hasDirtyEditors,
      hasNavigationBlockingEditors: dirtyState.hasNavigationBlockingEditors,
      resolve: () => dirtyState.resolveDirtyEditors('ja'),
      saveWithoutPrompt: dirtyState.saveDirtyEditors
    });
  }, [dirtyState, onValue]);

  return React.createElement('probe');
}

describe('DirtyStateProvider', () => {
  it('非blocking editorはbackground保存対象に残し画面遷移確認だけ省略する', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let value: ProbeValue | null = null;

    await act(async () => {
      create(
        <DirtyStateProvider>
          <Probe
            blocksNavigation={false}
            dirty
            discard={vi.fn()}
            onValue={(nextValue) => {
              value = nextValue;
            }}
            save={save}
          />
        </DirtyStateProvider>
      );
    });

    expect(value?.hasDirtyEditors).toBe(true);
    expect(value?.hasNavigationBlockingEditors).toBe(false);
    await expect(value?.resolve()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
    await expect(value?.saveWithoutPrompt()).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('保存成功後に同じrevisionでcallbackが更新されても再登録しない', async () => {
    const firstSave = vi.fn().mockResolvedValue(undefined);
    const secondSave = vi.fn().mockResolvedValue(undefined);
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;
    const onValue = (nextValue: ProbeValue): void => {
      value = nextValue;
    };

    await act(async () => {
      renderer = create(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={vi.fn()}
            onValue={onValue}
            revision="revision-a"
            save={firstSave}
          />
        </DirtyStateProvider>
      );
    });

    const firstResolution = value?.resolve();
    await act(async () => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('save');
      await firstResolution;
    });

    await act(async () => {
      renderer?.update(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={vi.fn()}
            onValue={onValue}
            revision="revision-a"
            save={secondSave}
          />
        </DirtyStateProvider>
      );
    });

    expect(value?.hasDirtyEditors).toBe(false);
    await expect(value?.resolve()).resolves.toBe(true);
    expect(firstSave).toHaveBeenCalledOnce();
    expect(secondSave).not.toHaveBeenCalled();
  });

  it('破棄成功後に同じrevisionでcallbackが更新されても再登録しない', async () => {
    const firstDiscard = vi.fn();
    const secondDiscard = vi.fn();
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;
    const onValue = (nextValue: ProbeValue): void => {
      value = nextValue;
    };

    await act(async () => {
      renderer = create(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={firstDiscard}
            onValue={onValue}
            revision="revision-a"
            save={vi.fn().mockResolvedValue(undefined)}
          />
        </DirtyStateProvider>
      );
    });

    const firstResolution = value?.resolve();
    await act(async () => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('discard');
      await firstResolution;
    });

    await act(async () => {
      renderer?.update(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={secondDiscard}
            onValue={onValue}
            revision="revision-a"
            save={vi.fn().mockResolvedValue(undefined)}
          />
        </DirtyStateProvider>
      );
    });

    expect(value?.hasDirtyEditors).toBe(false);
    await expect(value?.resolve()).resolves.toBe(true);
    expect(firstDiscard).toHaveBeenCalledOnce();
    expect(secondDiscard).not.toHaveBeenCalled();
  });

  it('保存完了前にcleanになったrevisionは後から再登録できる', async () => {
    let finishSave: (() => void) | null = null;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;
    const onValue = (nextValue: ProbeValue): void => {
      value = nextValue;
    };
    const renderProbe = (dirty: boolean): React.JSX.Element => (
      <DirtyStateProvider>
        <Probe
          dirty={dirty}
          discard={vi.fn()}
          onValue={onValue}
          revision="revision-a"
          save={save}
        />
      </DirtyStateProvider>
    );

    await act(async () => {
      renderer = create(renderProbe(true));
    });
    const pending = value?.resolve();
    act(() => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('save');
    });
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });

    await act(async () => {
      renderer?.update(renderProbe(false));
    });
    await act(async () => {
      finishSave?.();
      await pending;
    });
    await act(async () => {
      renderer?.update(renderProbe(true));
    });

    expect(value?.hasDirtyEditors).toBe(true);
  });

  it('保存中に新しい編集が入った場合は新しいdirty登録を残す', async () => {
    let finishSave: (() => void) | null = null;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;
    const renderProbe = (revision: string): React.JSX.Element => (
      <DirtyStateProvider>
        <Probe
          dirty
          discard={vi.fn()}
          onValue={(nextValue) => {
            value = nextValue;
          }}
          revision={revision}
          save={save}
        />
      </DirtyStateProvider>
    );

    await act(async () => {
      renderer = create(renderProbe('revision-a'));
    });
    const firstResolution = value?.resolve();
    act(() => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('save');
    });
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });

    await act(async () => {
      renderer?.update(renderProbe('revision-b'));
    });
    await act(async () => {
      finishSave?.();
      await firstResolution;
    });

    expect(value?.hasDirtyEditors).toBe(true);
    let secondResolution: Promise<boolean> | undefined;
    await act(async () => {
      secondResolution = value?.resolve();
    });
    expect(
      renderer?.root.findByType('dirty-resolution-dialog').props.visible
    ).toBe(true);
    act(() => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('cancel');
    });
    await expect(secondResolution).resolves.toBe(false);
  });

  it('background保存中の新しい編集もdirty登録に残す', async () => {
    let finishSave: (() => void) | null = null;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;
    const renderProbe = (revision: string): React.JSX.Element => (
      <DirtyStateProvider>
        <Probe
          dirty
          discard={vi.fn()}
          onValue={(nextValue) => {
            value = nextValue;
          }}
          revision={revision}
          save={save}
        />
      </DirtyStateProvider>
    );

    await act(async () => {
      renderer = create(renderProbe('revision-a'));
    });
    const backgroundSave = value?.saveWithoutPrompt();
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledOnce();
    });

    await act(async () => {
      renderer?.update(renderProbe('revision-b'));
    });
    await act(async () => {
      finishSave?.();
      await backgroundSave;
    });

    expect(value?.hasDirtyEditors).toBe(true);
    expect(
      renderer?.root.findByType('dirty-resolution-dialog').props.visible
    ).toBe(false);
  });

  it('保存成功直後の再離脱では確認を繰り返さない', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={vi.fn()}
            onValue={(nextValue) => {
              value = nextValue;
            }}
            save={save}
          />
        </DirtyStateProvider>
      );
    });

    const firstResolution = value?.resolve();
    await act(async () => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('save');
      await firstResolution;
    });

    expect(value?.hasDirtyEditors).toBe(false);
    await expect(value?.resolve()).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      renderer?.root.findByType('dirty-resolution-dialog').props.visible
    ).toBe(false);
  });

  it('破棄直後の再離脱では確認を繰り返さない', async () => {
    const discard = vi.fn();
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={discard}
            onValue={(nextValue) => {
              value = nextValue;
            }}
            save={vi.fn().mockResolvedValue(undefined)}
          />
        </DirtyStateProvider>
      );
    });

    const firstResolution = value?.resolve();
    await act(async () => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('discard');
      await firstResolution;
    });

    expect(value?.hasDirtyEditors).toBe(false);
    await expect(value?.resolve()).resolves.toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(
      renderer?.root.findByType('dirty-resolution-dialog').props.visible
    ).toBe(false);
  });

  it('dirty editorを登録し保存成功後に離脱を許可する', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn();
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={discard}
            onValue={(nextValue) => {
              value = nextValue;
            }}
            save={save}
          />
        </DirtyStateProvider>
      );
    });

    expect(value?.hasDirtyEditors).toBe(true);
    const pending = value?.resolve();
    await act(async () => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('save');
    });
    await expect(pending).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it('同時の離脱要求で解決ダイアログと保存を重複させない', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={vi.fn()}
            onValue={(nextValue) => {
              value = nextValue;
            }}
            save={save}
          />
        </DirtyStateProvider>
      );
    });

    const first = value?.resolve();
    const second = value?.resolve();
    expect(
      renderer?.root.findAllByType('dirty-resolution-dialog')
    ).toHaveLength(1);

    await act(async () => {
      renderer?.root.findByType('dirty-resolution-dialog').props.onSelect('save');
    });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('background保存は解決ダイアログを開かずdirty editorを保存する', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={vi.fn()}
            onValue={(nextValue) => {
              value = nextValue;
            }}
            save={save}
          />
        </DirtyStateProvider>
      );
    });

    await expect(value?.saveWithoutPrompt()).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      renderer?.root.findByType('dirty-resolution-dialog').props.visible
    ).toBe(false);
  });

  it('Providerが破棄された場合は待機中の離脱要求をキャンセルとして解放する', async () => {
    let value: ProbeValue | null = null;
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(
        <DirtyStateProvider>
          <Probe
            dirty
            discard={vi.fn()}
            onValue={(nextValue) => {
              value = nextValue;
            }}
            save={vi.fn().mockResolvedValue(undefined)}
          />
        </DirtyStateProvider>
      );
    });

    const pending = value?.resolve();
    await act(async () => {
      renderer?.unmount();
    });

    await expect(pending).resolves.toBe(false);
  });
});
