import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import { PageErrorRecoveryNotice } from '@/components/PageErrorRecoveryNotice';
import { ApiError } from '@/lib/api';
import {
  collectOperationFailures,
  operationFailure,
  type OperationErrorContext
} from '@/lib/operationErrorContext';

const confirm = vi.hoisted(() => vi.fn());
vi.mock('@/lib/confirm', () => ({ confirmAction: confirm }));
vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text', View: 'view'
}));
vi.mock('@/components/Notice', () => ({
  Notice: (props: Record<string, unknown>) => React.createElement('notice', props)
}));

async function render(context: OperationErrorContext, language: 'ja' | 'en' = 'en', error: Error = new ApiError('secret provider detail', 500, 'INTERNAL_ERROR')) {
  const refresh = vi.fn();
  const jobs = vi.fn();
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ActionableErrorNotice actions={{ retry: refresh, jobs }} context={context} error={error} language={language} retryMode="refresh" />);
  });
  return { notice: tree!.root.findByType('notice'), refresh, jobs };
}

describe('operation error context rendering', () => {
  it.each(['ja', 'en'] as const)('keeps the episode save and retained fields identifiable in %s', async (language) => {
    const { notice, refresh } = await render({ operation: 'saveEpisode', retainedDraft: 'episode' }, language);
    const text = notice.props.message as string;
    for (const phrase of language === 'ja'
      ? ['話の保存', 'タイトル', '本文', '想定ページ数', '開始状態', '画面内', '未確認']
      : ['Save episode', 'title', 'story', 'estimated pages', 'starting states', 'on this screen', 'unconfirmed']) {
      expect(text).toContain(phrase);
    }
    expect(text).not.toContain('secret provider detail');
    expect(notice.props.actionLabel).toBe(language === 'ja' ? '状態を更新' : 'Refresh status');
    expect(notice.props.announce).toBe(true);
    await act(async () => notice.props.onAction());
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('distinguishes a failed read from a write and does not invent retained input', async () => {
    const { notice } = await render({ operation: 'loadPages' }, 'en', new TypeError('Network request failed'));
    expect(notice.props.message).toContain('Load pages');
    expect(notice.props.message).toContain('This read did not submit changes');
    expect(notice.props.message).not.toContain('on this screen');
    expect(notice.props.actionLabel).toBe('Refresh status');
  });
  it('keeps a confirmed hierarchy write distinct from its later refresh failure', async () => {
    const { notice } = await render({ operation: 'renameWork', confirmed: true, targetLabel: 'My work' });
    expect(notice.props.message).toContain('Save work title (My work)');
    expect(notice.props.message).toContain('The server confirmed this operation');
    expect(notice.props.message).toContain('without submitting it again');
    expect(notice.props.message).not.toContain('Save status is unconfirmed');
    expect(notice.props.message).not.toContain('on this screen');
  });

  it('routes a save timeout to status refresh without claiming no save or no charge', async () => {
    const { notice, refresh, jobs } = await render({ operation: 'saveEpisode', retainedDraft: 'episode' }, 'en', new ApiError('timeout', 0, 'REQUEST_TIMEOUT'));
    expect(notice.props.message).toContain('unconfirmed');
    expect(notice.props.message).not.toMatch(/not saved|not charged|refunded|saved successfully/i);
    await act(async () => notice.props.onAction());
    expect(refresh).toHaveBeenCalledOnce();
    expect(jobs).not.toHaveBeenCalled();
  });

  it('describes free text AI separately from uncertain paid image settlement', async () => {
    const free = await render({ operation: 'improveEpisode', retainedDraft: 'episode' });
    expect(free.notice.props.message).toContain('Text AI is free');
    expect(free.notice.props.message).toContain('Save status is unconfirmed');
    const paid = await render({ operation: 'generatePage' }, 'en', new ApiError('timeout', 0, 'REQUEST_TIMEOUT'));
    expect(paid.notice.props.message).toContain('Charge/refund status is unconfirmed');
    expect(paid.notice.props.message).toContain('job');
    expect(paid.notice.props.message).not.toMatch(/\b\d+ credits|not charged|refunded/i);
    expect(paid.notice.props.actionLabel).toBe('Review jobs');
  });

  it('does not equate a failed cancellation with a stopped job or a refund', async () => {
    const { notice } = await render({ operation: 'cancelPageDesign' });
    expect(notice.props.message).toContain('Cancel page design');
    expect(notice.props.message).toContain('Cancellation is unconfirmed');
    expect(notice.props.message).toContain('may still be running');
    expect(notice.props.message).not.toMatch(/cancelled successfully|refunded|not charged/i);
  });

  it('retains contextual safe reason and the destructive reload warning for stale pages', async () => {
    const reload = vi.fn();
    let tree: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<PageErrorRecoveryNotice context={{ operation: 'savePanel', retainedDraft: 'panel' }} error={new ApiError('raw secret', 409, 'PAGE_STALE')} language="en" onAccount={vi.fn()} onCharacters={vi.fn()} onLogin={vi.fn()} onReloadStale={reload} onRetry={vi.fn()} />);
    });
    const notice = tree!.root.findByType('notice');
    expect(notice.props.message).toContain('Save panel');
    expect(notice.props.message).toContain('dialogue');
    expect(notice.props.message).toContain('replace');
    expect(notice.props.message).not.toContain('raw secret');
    await act(async () => notice.props.onAction());
    expect(reload).not.toHaveBeenCalled();
    await act(async () => confirm.mock.calls.at(-1)![0].onConfirm());
    expect(reload).toHaveBeenCalledOnce();
  });

  it('deduplicates one nested failure without hiding distinct operations with the same safe reason', () => {
    const first = new Error('same');
    const second = new Error('same');
    const failures = collectOperationFailures([
      operationFailure('saveEpisode', first, 'episode'),
      operationFailure('saveStoryDrafts', first, 'story'),
      operationFailure('saveScene', second, 'scene'),
      operationFailure('loadPages', null)
    ]);
    expect(failures.map(failure => failure.context.operation)).toEqual(['saveEpisode', 'saveScene']);
  });
});
