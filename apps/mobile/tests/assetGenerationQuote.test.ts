import { describe, expect, it, vi } from 'vitest';
import { GenerationQuoteController } from '@/domain/generationQuoteController';
import { assetQuoteMatchesTarget, type AssetQuoteTarget } from '@/domain/assetGenerationQuote';
import type { GenerationQuote, GenerationQuoteReceipt } from '@/domain/pageGenerationQuote';
const id = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const target: AssetQuoteTarget = { label: 'Akira', revision: 'saved-1', request: { operation: 'entity_preview', target_id: id(2) } };
const quote: GenerationQuote = { quote_id: id(1), quote_token: 'opaque', operation: 'entity_preview', target_id: id(2), billing_scope: { kind: 'personal', organization_id: null }, image_model: 'gpt-image-2', quality: 'medium', render_style: 'color', reference_count: 0, amount_credits: 3, pricing_version: 'v1', input_revision: 'a'.repeat(64), expires_at: '2099-01-01T00:00:00Z', blockers: [] };
const receipt: GenerationQuoteReceipt = { quote_id: id(1), job_id: id(4), status: 'queued', amount_credits: 3, charged_credits: 3, refunded_credits: 0, accepted_at: '2026-10-01T00:00:00Z', expires_at: quote.expires_at };
const context = { key: 'session:entity', organizationId: null, enabled: true, revision: 'draft-1' };
function setup() {
  const deps = { prepare: vi.fn(async (value: AssetQuoteTarget) => value), createQuote: vi.fn().mockResolvedValue(quote), quoteMatchesTarget: assetQuoteMatchesTarget, acceptQuote: vi.fn().mockResolvedValue(receipt), getReceipt: vi.fn().mockResolvedValue({ ...receipt, job_id: null, status: null, accepted_at: null, charged_credits: 0 }), requestKey: vi.fn(() => id(5)), now: () => Date.parse('2026-10-01T00:00:00Z'), onAccepted: vi.fn() };
  return { deps, controller: new GenerationQuoteController(deps, context) };
}
describe('asset generation quotes', () => {
  it.each(['entity_preview', 'entity_state_preview', 'entity_import_analysis'] as const)('requires explicit acceptance for %s and uses the quoted price', async (operation) => {
    const { controller, deps } = setup();
    const request = operation === 'entity_import_analysis' ? { operation, upload_token: 'uploaded', entity_type: 'character' as const } : { operation, target_id: id(2) };
    deps.createQuote.mockResolvedValue({ ...quote, operation, ...(operation === 'entity_import_analysis' ? { image_model: null, quality: null, render_style: null } : {}) });
    await controller.open({ ...target, request });
    expect(controller.getSnapshot().phase).toBe('review'); expect(deps.acceptQuote).not.toHaveBeenCalled();
    await controller.accept(); expect(deps.acceptQuote).toHaveBeenCalledWith(id(1), { quote_token: 'opaque', request_key: id(5) }, null);
  });
  it('has no paid fallback when capabilities are absent and cancels without acceptance', async () => {
    const { controller, deps } = setup(); controller.updateContext({ ...context, enabled: false }); await controller.open(target);
    expect(deps.createQuote).not.toHaveBeenCalled(); expect(deps.acceptQuote).not.toHaveBeenCalled();
    controller.updateContext(context); await controller.open(target); controller.close(); await controller.accept(); expect(deps.acceptQuote).not.toHaveBeenCalled();
  });
  it('retains the same acceptance key after timeout and reconciles before retry', async () => {
    const { controller, deps } = setup(); await controller.open(target); deps.acceptQuote.mockRejectedValueOnce(new Error('network'));
    await controller.accept(); controller.close(); await controller.open(target); await controller.accept();
    expect(deps.createQuote).toHaveBeenCalledOnce(); expect(deps.acceptQuote.mock.calls[0]).toEqual(deps.acceptQuote.mock.calls[1]); expect(deps.requestKey).toHaveBeenCalledOnce();
  });
  it('blocks stale local inputs and prevents a late account-change callback', async () => {
    const { controller, deps } = setup(); await controller.open(target); controller.updateContext({ ...context, revision: 'draft-2' });
    await controller.accept(); expect(deps.acceptQuote).not.toHaveBeenCalled();
    controller.updateContext(context); await controller.open(target); let finish: (value: GenerationQuoteReceipt) => void = () => undefined;
    deps.acceptQuote.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.accept(); controller.updateContext({ ...context, key: 'different-account' }); finish(receipt); await pending;
    expect(deps.onAccepted).not.toHaveBeenCalled(); expect(controller.getSnapshot().visible).toBe(false);
  });
  it('records a receipt without a late UI callback after capability or input revision changes', async () => {
    for (const changed of [{ enabled: false }, { revision: 'new-input' }]) {
      const { controller, deps } = setup(); await controller.open(target);
      let finish: (value: GenerationQuoteReceipt) => void = () => undefined;
      deps.acceptQuote.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      const pending = controller.accept(); controller.updateContext({ ...context, ...changed }); finish(receipt); await pending;
      expect(controller.getSnapshot().phase).toBe('accepted'); expect(deps.onAccepted).not.toHaveBeenCalled();
      expect(deps.acceptQuote).toHaveBeenCalledOnce();
    }
  });
  it('rejects mismatched target, operation, and scope without accepting', async () => {
    const { controller, deps } = setup();
    for (const changed of [{ target_id: id(8) }, { operation: 'entity_state_preview' }, { billing_scope: { kind: 'organization', organization_id: id(9) } }]) {
      deps.createQuote.mockResolvedValue({ ...quote, ...changed }); await controller.open(target); expect(controller.getSnapshot().phase).toBe('error');
    }
    expect(deps.acceptQuote).not.toHaveBeenCalled();
  });
});
