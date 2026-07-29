import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestUnsavedChangesResolution } from '@/lib/confirm';

vi.mock('react-native', () => ({
  Alert: {
    alert: vi.fn()
  }
}));

describe('unsaved changes prompt', () => {
  beforeEach(() => {
    vi.mocked(Alert.alert).mockReset();
  });

  it('保存・破棄・キャンセルの3択を表示する', async () => {
    const pending = requestUnsavedChangesResolution({ language: 'ja' });
    const call = vi.mocked(Alert.alert).mock.calls[0];
    const buttons = call?.[2] ?? [];

    expect(buttons.map((button) => button.text)).toEqual(['キャンセル', '破棄', '保存']);
    buttons[2]?.onPress?.();
    await expect(pending).resolves.toBe('save');
  });

  it('dialogを閉じた場合はキャンセルとして扱う', async () => {
    const pending = requestUnsavedChangesResolution({ language: 'en' });
    const call = vi.mocked(Alert.alert).mock.calls[0];

    call?.[3]?.onDismiss?.();
    await expect(pending).resolves.toBe('cancel');
  });
});
