import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageGenerationQuoteDialog } from '@/components/PageGenerationQuoteDialog';
import { PageGenerationResultModal } from '@/components/PageGenerationResultModal';
import type { GenerationQuote } from '@/domain/pageGenerationQuote';
import type { PageQuoteSnapshot } from '@/domain/pageGenerationQuoteController';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ AccessibilityInfo: { setAccessibilityFocus: vi.fn() }, findNodeHandle: () => null, Modal: 'modal', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/components/SegmentedControl', () => ({ SegmentedControl: (props: Record<string, unknown>) => React.createElement('segments', props) }));
vi.mock('@/components/PageImageViewer', () => ({ PageImageViewer: (props: Record<string, unknown>) => React.createElement('image-viewer', props) }));
let root: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => root?.unmount()); });
const quote: GenerationQuote = { quote_id: 'quote', quote_token: 'never-display-token', operation: 'page_regenerate', target_id: 'page', billing_scope: { kind: 'personal', organization_id: null }, image_model: 'gpt-image-2', quality: 'medium', render_style: 'monochrome', reference_count: 2, amount_credits: 11, pricing_version: 'v1', input_revision: 'revision', expires_at: '2099-01-01T00:00:00Z', blockers: [] };
const state: PageQuoteSnapshot = { phase: 'review', visible: true, target: { pageId: 'page', pageNumber: 4, renderStyle: 'monochrome' }, quote, receipt: null };
describe('料金確認と生成結果のdialog', () => {
  it('server費用と対象・方式を示し確認操作以外で受付しない', async () => {
    const accept = vi.fn(); const close = vi.fn();
    await act(async () => { root = create(<PageGenerationQuoteDialog state={state} language="ja" canAccept onAccept={accept} onClose={close} onReconcile={vi.fn()} onRequote={vi.fn()} />); });
    const visibleText = root!.root.findAllByType('text').map((node) => node.children.join('')).join(' ');
    expect(visibleText).toContain('11クレジット'); expect(visibleText).toContain('4ページ'); expect(visibleText).toContain('白黒'); expect(visibleText).not.toContain('never-display-token');
    expect(accept).not.toHaveBeenCalled();
    await act(async () => root!.root.findByType('modal').props.onRequestClose()); expect(close).toHaveBeenCalledOnce(); expect(accept).not.toHaveBeenCalled();
    await act(async () => root!.root.findByProps({ testID: 'page-quote-accept' }).props.onPress()); expect(accept).toHaveBeenCalledOnce();
  });
  it('読込・能力OFF・期限切れの状態では有料確認ボタンを出さない', async () => {
    for (const phase of ['quoting', 'unavailable', 'stale'] as const) {
      await act(async () => { root = create(<PageGenerationQuoteDialog state={{ ...state, phase, quote: null }} language="ja" canAccept={false} onAccept={vi.fn()} onClose={vi.fn()} onReconcile={vi.fn()} onRequote={vi.fn()} />); });
      expect(root!.root.findAllByProps({ testID: 'page-quote-accept' })).toHaveLength(0);
      await act(async () => root?.unmount());
    }
  });
  it('結果を開いただけでは有料処理せず最終ページは一覧確認に置き換える', async () => {
    const regenerate = vi.fn(); const next = vi.fn(); const review = vi.fn(); const style = vi.fn();
    await act(async () => { root = create(<PageGenerationResultModal visible language="ja" pageNumber={4} sources={[{ uri: 'https://example.test/image.png' }]} hasNextPage={false} canGenerate renderStyle="monochrome" onRenderStyleChange={style} onClose={vi.fn()} onRegenerate={regenerate} onNextPage={next} onReviewPages={review} onExpand={vi.fn()} />); });
    expect(regenerate).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
    expect(root!.root.findAllByProps({ testID: 'page-result-next' })).toHaveLength(0);
    await act(async () => root!.root.findByProps({ testID: 'page-result-last' }).props.onPress()); expect(review).toHaveBeenCalledOnce(); expect(next).not.toHaveBeenCalled();
    await act(async () => root!.root.findByType('segments').props.onChange('color')); expect(style).toHaveBeenCalledWith('color'); expect(regenerate).not.toHaveBeenCalled();
  });
});
