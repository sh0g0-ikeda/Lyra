import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageSettingsPreview } from '@/components/PageSettingsPreview';
import type { EntityRecord, PanelRecord } from '@/domain/types';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
let root: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => root?.unmount()); });
describe('現在のコマ設定preview', () => {
  it('渡された実際の状況・背景・人物・台詞数を表示する', async () => {
    const panel = { id: 'p', order: 3, situation_text: '保存前の最新入力', background_note: '夕方の街', entities: [{ entity_id: 'hero' }], dialogue: [{ text: 'やあ' }, { text: 'どうも' }] } as PanelRecord;
    await act(async () => { root = create(<PageSettingsPreview language="ja" pageNumber={12} panels={[panel]} entities={[{ id: 'hero', name: '主人公' } as EntityRecord]} />); });
    const text = root!.root.findAllByType('text').map((node) => node.children.join('')).join(' ');
    expect(text).toContain('12ページ'); expect(text).toContain('コマ 3'); expect(text).toContain('保存前の最新入力'); expect(text).toContain('夕方の街'); expect(text).toContain('主人公'); expect(text).toContain('セリフ 2件');
  });
  it('未選択と空コマを架空の設定で埋めない', async () => {
    await act(async () => { root = create(<PageSettingsPreview language="en" pageNumber={null} panels={[]} entities={[]} />); });
    expect(JSON.stringify(root!.toJSON())).toContain('Select a page');
    await act(async () => root!.update(<PageSettingsPreview language="en" pageNumber={1} panels={[]} entities={[]} />));
    expect(JSON.stringify(root!.toJSON())).toContain('There are no panel settings yet');
  });
});
