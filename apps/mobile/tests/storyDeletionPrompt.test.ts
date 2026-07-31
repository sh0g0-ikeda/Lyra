import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showStoryDeletionPrompt } from '../src/lib/storyDeletionPrompt';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
}));

describe('showStoryDeletionPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('章削除は対象名と配下データへの影響を示して明示確認する', async () => {
    const confirmation = showStoryDeletionPrompt('ja', 'chapter', '第一章');
    const call = vi.mocked(Alert.alert).mock.calls[0];

    expect(call?.[0]).toBe('この章を削除しますか？');
    expect(call?.[1]).toContain('「第一章」と配下の話・シーン・ページ・コマ');
    call?.[2]?.[1]?.onPress?.();

    await expect(confirmation).resolves.toBe(true);
  });

  it('話削除dialogを閉じた場合は削除を許可しない', async () => {
    const confirmation = showStoryDeletionPrompt('en', 'episode', 'Episode one');
    const call = vi.mocked(Alert.alert).mock.calls[0];

    expect(call?.[0]).toBe('Delete this episode?');
    call?.[3]?.onDismiss?.();

    await expect(confirmation).resolves.toBe(false);
  });
});
