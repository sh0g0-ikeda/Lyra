import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PageErrorRecoveryNotice } from '@/components/PageErrorRecoveryNotice';
import { ApiError } from '@/lib/api';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/Notice', () => ({
  Notice: (props: Record<string, unknown>) =>
    React.createElement('notice', props)
}));

vi.mock('@/lib/i18n', () => ({
  t: (_language: string, key: string) => key
}));

vi.mock('@/lib/userMessages', () => ({
  userErrorMessage: () => 'safe page error'
}));

function renderError(error: unknown): {
  actions: {
    account: ReturnType<typeof vi.fn>;
    characters: ReturnType<typeof vi.fn>;
    layout: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    reloadStale: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  };
  press: () => void;
} {
  const actions = {
    account: vi.fn(),
    characters: vi.fn(),
    layout: vi.fn(),
    login: vi.fn(),
    reloadStale: vi.fn(),
    retry: vi.fn()
  };
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <PageErrorRecoveryNotice
        error={error}
        language="ja"
        onAccount={actions.account}
        onCharacters={actions.characters}
        onLayout={actions.layout}
        onLogin={actions.login}
        onReloadStale={actions.reloadStale}
        onRetry={actions.retry}
      />
    );
  });
  const notice = renderer!.root.findByType('notice');
  return {
    actions,
    press: () => {
      act(() => notice.props.onAction());
    }
  };
}

describe('PageErrorRecoveryNotice', () => {
  it('PAGE_STALEの再試行では通常refreshでなく最新draft再読込を実行する', () => {
    const rendered = renderError(
      new ApiError('provider detail', 409, 'PAGE_STALE')
    );

    rendered.press();

    expect(rendered.actions.reloadStale).toHaveBeenCalledTimes(1);
    expect(rendered.actions.retry).not.toHaveBeenCalled();
  });

  it('通常の一時エラーではpage queryの再試行を実行する', () => {
    const rendered = renderError(
      new ApiError('provider detail', 503, 'SERVICE_UNAVAILABLE')
    );

    rendered.press();

    expect(rendered.actions.retry).toHaveBeenCalledTimes(1);
    expect(rendered.actions.reloadStale).not.toHaveBeenCalled();
  });

  it('権限・レイアウト・参照画像エラーを対応する画面へ送る', () => {
    const workspace = renderError(
      new ApiError('provider detail', 403, 'FORBIDDEN')
    );
    workspace.press();
    expect(workspace.actions.account).toHaveBeenCalledTimes(1);

    const layout = renderError(
      new ApiError('provider detail', 422, 'FRAME_COUNT_MISMATCH')
    );
    layout.press();
    expect(layout.actions.layout).toHaveBeenCalledTimes(1);

    const characters = renderError(
      new ApiError('provider detail', 422, 'MISSING_CHARACTER_REFERENCE')
    );
    characters.press();
    expect(characters.actions.characters).toHaveBeenCalledTimes(1);
  });
});
