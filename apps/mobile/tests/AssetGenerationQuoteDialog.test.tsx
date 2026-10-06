import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetGenerationQuoteDialog } from '@/components/AssetGenerationQuoteDialog';
import type { GenerationQuoteSnapshot } from '@/domain/generationQuoteController';
import type { AssetQuoteTarget } from '@/domain/assetGenerationQuote';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Modal: 'modal', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: 'button' }));
let root: ReactTestRenderer | undefined;
afterEach(() => act(() => root?.unmount()));
const state: GenerationQuoteSnapshot<AssetQuoteTarget> = { phase: 'review', visible: true, target: { label: 'Akira · Injured', revision: 'saved', request: { operation: 'entity_state_preview', target_id: 'state' } }, quote: { quote_id: 'quote', quote_token: 'hidden-token', operation: 'entity_state_preview', target_id: 'state', billing_scope: { kind: 'organization', organization_id: 'organization' }, image_model: 'gpt-image-2', quality: 'medium', render_style: 'color', reference_count: 1, amount_credits: 9, pricing_version: 'v1', input_revision: 'revision', expires_at: '2099-01-01T00:00:00Z', blockers: [] }, receipt: null };
describe('asset quote confirmation', () => {
  it('shows server amount, target and organization scope without exposing opaque credentials', () => {
    const accept = vi.fn(); const close = vi.fn();
    act(() => { root = create(<AssetGenerationQuoteDialog state={state} language="en" canAccept onAccept={accept} onClose={close} onReconcile={vi.fn()} onRequote={vi.fn()} />); });
    const text = root!.root.findAllByType('text').map((node) => node.children.join('')).join(' ');
    expect(text).toContain('9 credits'); expect(text).toContain('Akira · Injured'); expect(text).toContain('Organization credits'); expect(text).not.toContain('hidden-token'); expect(text).toContain('5');
    act(() => root!.root.findByType('modal').props.onRequestClose()); expect(close).toHaveBeenCalledOnce(); expect(accept).not.toHaveBeenCalled();
    act(() => root!.root.findByProps({ testID: 'asset-quote-accept' }).props.onPress()); expect(accept).toHaveBeenCalledOnce();
  });
  it('does not assign an image-generation ETA or model to import analysis', () => {
    act(() => { root = create(<AssetGenerationQuoteDialog state={{ ...state, target: { ...state.target!, request: { operation: 'entity_import_analysis', upload_token: 'upload', entity_type: 'character' } }, quote: { ...state.quote!, operation: 'entity_import_analysis', image_model: null, quality: null, render_style: null } }} language="en" canAccept={false} onAccept={vi.fn()} onClose={vi.fn()} onReconcile={vi.fn()} onRequote={vi.fn()} />); });
    const text = root!.root.findAllByType('text').map((node) => node.children.join('')).join(' ');
    expect(text).not.toContain('gpt-image-2'); expect(text).not.toContain('5 minutes');
    expect(root!.root.findByProps({ testID: 'asset-quote-accept' }).props.disabled).toBe(true);
  });
});
