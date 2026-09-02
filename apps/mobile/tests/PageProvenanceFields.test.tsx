import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PageProvenanceFields } from '@/components/PageProvenanceFields';
import type { SceneRecord } from '@/domain/types';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/FormField', () => ({
  FormField: (props: {
    label: string;
    multilineMaxHeight: number;
    multilineMinHeight: number;
  }) => React.createElement('field', props)
}));

const scene = (id: string, order: number, location: string): SceneRecord =>
  ({
    id,
    order,
    location,
    time_of_day: 'night',
    atmosphere: 'tense'
  }) as SceneRecord;

describe('PageProvenanceFields', () => {
  it('source scenesを解決済みラベルのread-only chipとして表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PageProvenanceFields
          continuityNote="緊張感を次ページへ続ける"
          editable
          language="ja"
          onContinuityNoteChange={vi.fn()}
          onPagePurposeChange={vi.fn()}
          pagePurpose="対立を強める"
          scenes={[scene('scene-1', 1, '屋上'), scene('scene-2', 2, '教室')]}
          sourceSceneIds={['scene-1']}
        />
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('背景や時間帯の設定');
    expect(rendered).toContain('設定 1: 屋上');
    expect(rendered).not.toContain('scene-1');
    expect(renderer!.root.findAllByType('button')).toHaveLength(0);
  });

  it('ページ目的と継続メモを2行相当の入力欄にする', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PageProvenanceFields
          continuityNote=""
          editable
          language="ja"
          onContinuityNoteChange={vi.fn()}
          onPagePurposeChange={vi.fn()}
          pagePurpose=""
          scenes={[]}
          sourceSceneIds={[]}
        />
      );
    });

    const fields = renderer!.root.findAllByType('field');
    expect(fields.map((field) => field.props.label)).toEqual([
      'ページの目的',
      '継続メモ'
    ]);
    expect(fields.every((field) => field.props.multilineMinHeight === 64)).toBe(true);
    expect(fields.every((field) => field.props.multilineMaxHeight === 96)).toBe(true);
  });
});
