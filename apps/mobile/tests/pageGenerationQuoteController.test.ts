import { describe, expect, it, vi } from 'vitest';
import { PageGenerationQuoteController } from '@/domain/pageGenerationQuoteController';
import type { GenerationQuote, GenerationQuoteReceipt } from '@/domain/pageGenerationQuote';
const id = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const quote: GenerationQuote = { quote_id: id(1), quote_token: 'opaque', operation: 'page_generate', target_id: id(2), billing_scope: { kind: 'personal', organization_id: null }, image_model: 'gpt-image-2', quality: 'medium', render_style: 'color', reference_count: 2, amount_credits: 7, pricing_version: 'v1', input_revision: 'a'.repeat(64), expires_at: '2099-01-01T00:00:00Z', blockers: [] };
const receipt: GenerationQuoteReceipt = { quote_id: id(1), job_id: id(4), status: 'queued', amount_credits: 7, charged_credits: 7, refunded_credits: 0, accepted_at: '2026-10-01T00:00:00Z', expires_at: quote.expires_at };
const target = { pageId: id(2), pageNumber: 1, renderStyle: 'color' as const };
const context = { key: 'scope:page-1', organizationId: null, enabled: true };
function setup() {
  const deps = { prepare: vi.fn().mockResolvedValue({ ...target, operation: 'page_generate' }), createQuote: vi.fn().mockResolvedValue(quote), acceptQuote: vi.fn().mockResolvedValue(receipt), getReceipt: vi.fn().mockResolvedValue({ ...receipt, job_id: null, status: null, accepted_at: null, charged_credits: 0 }), requestKey: vi.fn(() => id(5)), now: () => Date.parse('2026-10-01T00:00:00Z'), onAccepted: vi.fn() };
  const controller = new PageGenerationQuoteController(deps, context);
  return { controller, deps };
}
describe('見積と明示有料受付の状態管理', () => {
  it('保存と見積取得だけでは課金せず表示した対象・価格を明示受付する', async () => {
    const { controller, deps } = setup(); await controller.open(target);
    expect(controller.getSnapshot().phase).toBe('review'); expect(deps.acceptQuote).not.toHaveBeenCalled();
    await controller.accept();
    expect(deps.acceptQuote).toHaveBeenCalledWith(id(1), { quote_token: 'opaque', request_key: id(5) }, null);
    expect(deps.onAccepted).toHaveBeenCalledWith(receipt, expect.objectContaining(target), 'scope:page-1');
  });
  it('重複tapを一度にまとめる', async () => {
    const { controller, deps } = setup(); await controller.open(target);
    let complete: (result: GenerationQuoteReceipt) => void = () => undefined;
    deps.acceptQuote.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const first = controller.accept(); const second = controller.accept(); complete(receipt); await Promise.all([first, second]);
    expect(deps.acceptQuote).toHaveBeenCalledOnce();
  });
  it('受付通信断は照合し同じtoken/request_keyでのみ再試行する', async () => {
    const { controller, deps } = setup(); await controller.open(target);
    deps.acceptQuote.mockRejectedValueOnce(new Error('network'));
    await controller.accept(); expect(controller.getSnapshot().phase).toBe('unknown');
    await controller.accept();
    expect(deps.acceptQuote.mock.calls[0]).toEqual(deps.acceptQuote.mock.calls[1]); expect(deps.requestKey).toHaveBeenCalledOnce();
  });
  it('通信断後にreceiptがある場合は再課金せずjobを回復する', async () => {
    const { controller, deps } = setup(); await controller.open(target);
    deps.acceptQuote.mockRejectedValueOnce(new Error('network')); deps.getReceipt.mockResolvedValue(receipt);
    await controller.accept(); expect(controller.getSnapshot().phase).toBe('accepted');
    expect(deps.acceptQuote).toHaveBeenCalledOnce(); expect(deps.onAccepted).toHaveBeenCalledOnce();
  });
  it('能力OFF・別scope・期限切れ・blockerでは受付しない', async () => {
    const { controller, deps } = setup(); controller.updateContext({ ...context, enabled: false }); await controller.open(target); expect(deps.prepare).not.toHaveBeenCalled();
    controller.updateContext(context); await controller.open(target); controller.updateContext({ ...context, key: 'other' }); await controller.accept(); expect(deps.acceptQuote).not.toHaveBeenCalled();
    controller.updateContext(context); deps.createQuote.mockResolvedValue({ ...quote, expires_at: '2020-01-01T00:00:00Z' }); await controller.open(target); await controller.accept(); expect(controller.getSnapshot().phase).toBe('stale');
    deps.createQuote.mockResolvedValue({ ...quote, blockers: ['active_job'] }); await controller.open(target); await controller.accept(); expect(deps.acceptQuote).not.toHaveBeenCalled();
  });
  it('見積中のscope変更や対象不一致の応答を有効な確認にしない', async () => {
    const { controller, deps } = setup(); let finish: (quote: GenerationQuote) => void = () => undefined;
    deps.createQuote.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.open(target); await Promise.resolve(); await Promise.resolve(); controller.updateContext({ ...context, key: 'other' }); finish(quote); await pending;
    expect(controller.getSnapshot().visible).toBe(false); await controller.accept(); expect(deps.acceptQuote).not.toHaveBeenCalled();
    controller.updateContext(context); deps.createQuote.mockResolvedValue({ ...quote, target_id: id(99) }); await controller.open(target); expect(controller.getSnapshot().phase).toBe('error');
  });
  it('未確認の受付は閉じても捨てず、新しい見積で二重受付にしない', async () => {
    const { controller, deps } = setup(); await controller.open(target); deps.acceptQuote.mockRejectedValue(new Error('network')); await controller.accept(); controller.close();
    await controller.open({ ...target, pageId: id(8), pageNumber: 2 }); expect(deps.createQuote).toHaveBeenCalledOnce(); expect(controller.getSnapshot().quote?.quote_id).toBe(id(1));
  });
  it('料金確認の二重tapでも保存処理を重複実行しない', async () => {
    const { controller, deps } = setup();
    let finish: (value: { pageId: string; pageNumber: number; renderStyle: 'color'; operation: 'page_generate' }) => void = () => undefined;
    deps.prepare.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = controller.open(target); const second = controller.open(target);
    expect(controller.getSnapshot().visible).toBe(false);
    expect(deps.prepare).toHaveBeenCalledOnce();
    finish({ ...target, operation: 'page_generate' }); await Promise.all([first, second]);
    expect(deps.createQuote).toHaveBeenCalledOnce();
  });

  it('見積中に閉じた後の失敗応答でdialogを開き直さない', async () => {
    const { controller, deps } = setup(); let fail: (error: Error) => void = () => undefined;
    deps.createQuote.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const pending = controller.open(target); await Promise.resolve(); await Promise.resolve(); controller.close(); fail(new Error('network')); await pending;
    expect(controller.getSnapshot().visible).toBe(false); expect(controller.getSnapshot().phase).toBe('closed');
  });
  it('unmount後の受付応答で選択やセッション状態を変更しない', async () => {
    const { controller, deps } = setup(); await controller.open(target);
    let finish: (value: GenerationQuoteReceipt) => void = () => undefined;
    deps.acceptQuote.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.accept(); controller.dispose(); finish(receipt); await pending;
    expect(deps.onAccepted).not.toHaveBeenCalled(); expect(controller.getSnapshot().visible).toBe(false);
  });

});
