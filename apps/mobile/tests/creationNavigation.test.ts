import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creationRouteParams } from '@/navigation/creationRoute';
import { navigateToLegacyTarget } from '@/navigation/navigationRef';

const { navigate, isReady } = vi.hoisted(() => ({ navigate: vi.fn(), isReady: vi.fn() }));
vi.mock('@react-navigation/native', () => ({ createNavigationContainerRef: () => ({ navigate, isReady }) }));

describe('既存通知からの漫画制作導線', () => {
  beforeEach(() => { navigate.mockReset(); isReady.mockReset().mockReturnValue(true); });

  it('同じ工程への連続要求に異なるIDを付ける', () => {
    expect(creationRouteParams('pages').requestId).not.toBe(creationRouteParams('pages').requestId);
  });

  it('PagesとStory通知を漫画内の指定工程で開く', () => {
    expect(navigateToLegacyTarget('Pages')).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith('Story', { step: 'pages', requestId: expect.any(Number) });
    expect(navigateToLegacyTarget('Story')).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith('Story', { step: 'story', requestId: expect.any(Number) });
  });

  it('アセットとアカウント通知の既存入口を維持する', () => {
    expect(navigateToLegacyTarget('Characters')).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith('Characters');
    expect(navigateToLegacyTarget('Account')).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith('Account');
  });

  it('ナビゲーション未準備では通知を処理済みにしない', () => {
    isReady.mockReturnValue(false);
    expect(navigateToLegacyTarget('Pages')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
