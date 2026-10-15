import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmStoryStateAutofill } from '@/lib/confirmStoryStateAutofill';
import { t } from '@/lib/i18n';
const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock('@/lib/confirm', () => ({ confirmAction: confirm }));
vi.mock('@/lib/aiProviderDisclosure', () => ({ appendAiProviderDisclosure: (message: string) => message }));
describe('話全体自動入力の確認', () => {
  beforeEach(() => confirm.mockReset());
  it('確認を開いただけでは送信せずキャンセルでも実行しない', () => {
    const execute = vi.fn();
    confirmStoryStateAutofill({ language: 'ja', available: true, isCurrent: () => true, onConfirm: execute });
    expect(execute).not.toHaveBeenCalled();
    confirm.mock.calls[0][0].onConfirm();
    expect(execute).toHaveBeenCalledWith({ state_autofill_enabled: true });
  });
  it('scopeや権限が変わった場合は承認されても古い対象へ送信しない', () => {
    const execute = vi.fn();
    confirmStoryStateAutofill({ language: 'ja', available: true, isCurrent: () => false, onConfirm: execute });
    confirm.mock.calls[0][0].onConfirm();
    expect(execute).not.toHaveBeenCalled();
  });
  it('旧サーバーでは新stateオプションを送らない', () => {
    const execute = vi.fn();
    confirmStoryStateAutofill({ language: 'ja', available: false, isCurrent: () => true, onConfirm: execute });
    confirm.mock.calls[0][0].onConfirm();
    expect(execute).toHaveBeenCalledWith(undefined);
  });
  it('ページが無い統合導線では骨格作成と自動入力の両方を確認文で説明する', () => {
    confirmStoryStateAutofill({ language: 'ja', available: false, includeSkeletonGeneration: true, isCurrent: () => true, onConfirm: vi.fn() });
    const message = confirm.mock.calls[0][0].message as string;
    const skeleton = t('ja', 'screen.pages.design.generateConfirmation');
    const autofill = t('ja', 'screen.pages.design.autofillConfirmation');
    expect(message).toContain(skeleton);
    expect(message).toContain(autofill);
    expect(message.indexOf(skeleton)).toBeLessThan(message.indexOf(autofill));
  });
  it('既存ページの再設計は破棄範囲を同じ確認に含める', () => {
    const overwriteSummary = '現在の2ページ・8コマの編集内容を上書きします。';
    confirmStoryStateAutofill({ language: 'ja', available: false, includeSkeletonGeneration: true, overwriteSummary, isCurrent: () => true, onConfirm: vi.fn() });
    const message = confirm.mock.calls[0][0].message as string;
    expect(message).toContain(overwriteSummary);
    expect(message.indexOf(overwriteSummary)).toBeLessThan(message.indexOf(t('ja', 'screen.pages.design.generateConfirmation')));
    expect(confirm.mock.calls[0][0].destructive).toBe(true);
  });
});
