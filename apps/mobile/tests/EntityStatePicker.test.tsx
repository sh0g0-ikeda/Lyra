import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { EntityStatePicker } from '@/components/EntityStatePicker';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/lib/config', () => ({ config: { apiBaseUrl: 'https://api.example' } }));
const test = vi.hoisted(() => ({ states: [] as unknown[], language: 'ja' }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: {}, language: test.language, selection: { organizationId: null }, sessionKey: 'session', tokens: null }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey[0] === 'entity-states' ? { data: { entity_states: test.states }, error: null } : { data: undefined, error: null } }));
vi.mock('react-native', () => ({ Pressable: 'button', Text: 'text', View: 'view', StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock('@/components/ResilientImage', () => ({ ResilientImage: 'image' }));
const base = { entity_id: 'entity', scene_id: null, costume_note: null, costume_ref_id: null, condition_note: null, hair_note: null, expression_default: 'neutral', extra_note: null, created_at: '2026-01-01T00:00:00Z' };
describe('EntityStatePicker', () => {
  it('defaultと確定状態の名前・thumbnailを表示しstate IDだけを返す', () => {
    test.states = [{ ...base, id: 'ready', name: '外傷', description: '傷', reference_status: 'confirmed', reference_image: { ref_id: 'ref', created_at: base.created_at } }, { ...base, id: 'draft', name: '着替え', description: '別衣装', reference_status: 'draft' }];
    const select = vi.fn(); let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<EntityStatePicker entityId="entity" entityName="アキラ" selectedStateId="ready" onSelect={select} />); });
    expect(JSON.stringify(renderer.toJSON())).toContain('アキラ・外傷');
    expect(renderer.root.findAllByType('image')).toHaveLength(1);
    const options = renderer.root.findAllByType('button');
    expect(options[1]?.props.accessibilityState.checked).toBe(true);
    act(() => options[0]!.props.onPress()); expect(select).toHaveBeenCalledWith(null);
    act(() => options[1]!.props.onPress()); expect(select).toHaveBeenCalledWith('ready');
    expect(options[2]?.props.disabled).toBe(true);
    act(() => options[2]!.props.onPress()); expect(select).toHaveBeenCalledTimes(2);
  });
  it('未知の保存済み選択を勝手にdefaultへ戻さず欠落として表示する', () => {
    test.states = []; const select = vi.fn(); let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<EntityStatePicker entityId="entity" entityName="アキラ" selectedStateId="missing" onSelect={select} />); });
    expect(select).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('保存済みの状態が見つかりません');
  });
  it('他entity状態を除外しread-onlyの場合はdefaultも変更しない', () => {
    test.states = [{ ...base, id: 'foreign', entity_id: 'other', name: '他人' }]; const select = vi.fn(); let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<EntityStatePicker disabled entityId="entity" entityName="アキラ" selectedStateId={null} onSelect={select} />); });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('他人');
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    expect(select).not.toHaveBeenCalled();
  });
});
