import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showEntityReferenceConfirmPrompt } from '../src/lib/entityReferenceConfirmPrompt';

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
}));

describe('showEntityReferenceConfirmPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('既存画像を残して候補を追加しprimaryにすることを明示する', async () => {
    const confirmation = showEntityReferenceConfirmPrompt({
      existingCount: 2,
      language: 'ja',
    });
    const call = vi.mocked(Alert.alert).mock.calls[0];

    expect(call?.[0]).toBe('この画像を確定しますか？');
    expect(call?.[1]).toContain('確定済み画像は残したまま');
    expect(call?.[1]).toContain('メイン画像に設定');
    call?.[2]?.[1]?.onPress?.();

    await expect(confirmation).resolves.toBe(true);
  });

  it('dialogを閉じた場合は候補を確定しない', async () => {
    const confirmation = showEntityReferenceConfirmPrompt({
      existingCount: 0,
      language: 'en',
    });
    const call = vi.mocked(Alert.alert).mock.calls[0];

    expect(call?.[0]).toBe('Confirm this image?');
    call?.[3]?.onDismiss?.();

    await expect(confirmation).resolves.toBe(false);
  });
});
