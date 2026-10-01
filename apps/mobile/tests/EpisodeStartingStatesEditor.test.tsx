import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EpisodeStartingStatesEditor } from '@/components/EpisodeStartingStatesEditor';
import type { EntityRecord } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/EntityStatePicker', () => ({ EntityStatePicker: (props: Record<string, unknown>) => React.createElement('state-picker', props) }));
vi.mock('@/components/RecordPicker', () => ({ RecordPicker: (props: Record<string, unknown>) => React.createElement('record-picker', props) }));
vi.mock('@/components/Section', () => ({ Section: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
const entity = { id: 'entity', name: '主人公' } as EntityRecord;
let root: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => root?.unmount()); });
describe('話の開始状態の操作', () => {
  it('表示だけでは保存値を変更せず既存行の名前とdefaultを選択UIへ渡す', async () => {
    const onChange = vi.fn();
    await act(async () => { root = create(<EpisodeStartingStatesEditor entities={[entity]} language="ja" value={[{ entity_id: 'entity', state_id: null }]} onChange={onChange} />); });
    expect(onChange).not.toHaveBeenCalled();
    expect(root?.root.findByType('state-picker').props).toMatchObject({ entityId: 'entity', entityName: '主人公', selectedStateId: null });
    await act(async () => root?.root.findByType('state-picker').props.onSelect('injured'));
    expect(onChange).toHaveBeenCalledWith([{ entity_id: 'entity', state_id: 'injured' }]);
  });
  it('未読込の保存済み行を保持し明示リセットだけ空配列へ変更する', async () => {
    const onChange = vi.fn();
    await act(async () => { root = create(<EpisodeStartingStatesEditor entities={[]} language="ja" value={[{ entity_id: 'missing', state_id: 'legacy' }]} onChange={onChange} />); });
    expect(onChange).not.toHaveBeenCalled();
    expect(root?.root.findAllByType('state-picker')).toHaveLength(0);
    await act(async () => root?.root.findAll((node) => node.type === 'button' && node.props.testID === 'starting-state-reset')[0].props.onPress());
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it('現在workの未選択人物だけ追加し偽のIDを無視する', async () => {
    const onChange = vi.fn();
    await act(async () => { root = create(<EpisodeStartingStatesEditor entities={[entity]} language="en" value={[]} onChange={onChange} />); });
    await act(async () => root?.root.findByType('record-picker').props.onSelect('foreign'));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root?.root.findByType('record-picker').props.onSelect('entity'));
    expect(onChange).toHaveBeenCalledWith([{ entity_id: 'entity', state_id: null }]);
  });
  it('viewerまたは能力OFFでは保存済み行を表示したまま操作を無効にする', async () => {
    await act(async () => { root = create(<EpisodeStartingStatesEditor entities={[entity]} language="ja" value={[{ entity_id: 'entity', state_id: 'state' }]} onChange={vi.fn()} disabled />); });
    expect(root?.root.findByType('state-picker').props.disabled).toBe(true);
    expect(root?.root.findAllByType('record-picker')).toHaveLength(0);
    expect(root?.root.findAllByType('button').every((node) => node.props.disabled)).toBe(true);
  });
});
