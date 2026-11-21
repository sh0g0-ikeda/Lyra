import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GenerationBatchControls } from '@/components/GenerationBatchControls';
import type { GenerationBatch } from '@/domain/generationBatchContract';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  randomUUID: vi.fn(() => '44444444-4444-4444-8444-444444444444'),
  setItem: vi.fn(),
  getItem: vi.fn(),
  deleteItem: vi.fn(),
}));

vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'text', View: 'view',
}));
vi.mock('expo-crypto', () => ({ randomUUID: mocks.randomUUID }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: mocks.setItem,
  getItemAsync: mocks.getItem,
  deleteItemAsync: mocks.deleteItem,
}));
vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props),
}));
vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message),
}));

const batchId = '11111111-1111-4111-8111-111111111111';
const workId = '22222222-2222-4222-8222-222222222222';
const episodeId = '33333333-3333-4333-8333-333333333333';

function makeBatch(status: GenerationBatch['status'], acceptedAt: string | null): GenerationBatch {
  return {
    batch_id: batchId, work_id: workId, episode_id: episodeId, kind: 'pages', status,
    selection: 'missing_only', render_style: 'color', image_model: 'gpt-image-2.5-sunburst',
    pricing_version: 'v1', maximum_credits: 2.5, auto_confirm: true,
    expires_at: '2026-11-22T00:10:00.000Z', accepted_at: acceptedAt,
    created_at: '2026-11-22T00:00:00.000Z', updated_at: '2026-11-22T00:00:00.000Z',
    progress: { total: 1, completed: 0, skipped: 0, failed: 0, active: status === 'running' ? 1 : 0, pending: status === 'quoted' ? 1 : 0 },
    items: [{
      item_id: '55555555-5555-4555-8555-555555555555', kind: 'page', label: '1ページ', status: status === 'quoted' ? 'pending' : 'active',
      target_id: '66666666-6666-4666-8666-666666666666', entity_id: null, depends_on_item_id: null, job_id: null,
      input_revision: 'revision-1', operation: 'page_generate', image_model: 'gpt-image-2.5-sunburst', provider_model_id: 'gpt-image-2.5',
      render_style: 'color', amount_credits: 2.5, pricing_version: 'v1',
    }], blockers: [], active_job_ids: [],
  };
}

describe('GenerationBatchControls', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.setItem.mockResolvedValue(undefined); mocks.deleteItem.mockResolvedValue(undefined); });

  it('二重押下でもquoteを1回だけ作り、確認前にはacceptしない', async () => {
    const api = {
      getGenerationBatchCapabilities: vi.fn().mockResolvedValue({ enabled: true, image_model: 'gpt-image-2.5-sunburst', selections: ['missing_only'], render_styles: ['color'], max_items: 10, quote_ttl_seconds: 600 }),
      listGenerationBatches: vi.fn().mockResolvedValue([]),
      createGenerationBatchQuote: vi.fn().mockResolvedValue(makeBatch('quoted', null)),
      acceptGenerationBatch: vi.fn(), getGenerationBatch: vi.fn(), cancelGenerationBatch: vi.fn(), resumeGenerationBatch: vi.fn(),
    };
    const beforeQuote = vi.fn().mockResolvedValue(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<QueryClientProvider client={queryClient}><GenerationBatchControls
        api={api as never} beforeQuote={beforeQuote} canGenerate episodeId={episodeId} kind="pages" language="ja"
        onCompleted={vi.fn()} renderStyles={['color']} sessionKey="session" workId={workId}
      /></QueryClientProvider>);
    });
    await vi.waitFor(() => expect(renderer.root.findByProps({ label: '未生成を一括生成（カラー）' })).toBeDefined());
    const press = renderer.root.findByProps({ label: '未生成を一括生成（カラー）' }).props.onPress as () => void;
    await act(async () => { press(); press(); });

    expect(beforeQuote).toHaveBeenCalledTimes(1);
    expect(api.createGenerationBatchQuote).toHaveBeenCalledTimes(1);
    expect(api.acceptGenerationBatch).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.setItem).toHaveBeenCalledWith(expect.stringContaining(batchId), mocks.randomUUID());
    act(() => renderer.unmount());
  });
});
