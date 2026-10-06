import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterChoiceField } from '@/components/CharacterChoiceField';
vi.mock('react-native', () => ({ Modal: 'modal', Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: <T,>(value:T):T => value } }));
vi.mock('@/components/FormField', () => ({ FormField: (props:Record<string,unknown>) => React.createElement('field', props) }));
const options = [{value:'',labelJa:'-',labelEn:'-'},{value:'military',labelJa:'軍服',labelEn:'Military'},{value:'school',labelJa:'制服',labelEn:'School'},{value:'casual',labelJa:'普段着',labelEn:'Casual'}];
let root:ReactTestRenderer; afterEach(() => act(() => root?.unmount()));
function render(onChange = vi.fn(), value = ''): ReturnType<typeof vi.fn> { act(() => { root = create(<CharacterChoiceField label="服装" language="ja" options={options} value={value} onChange={onChange} searchable />); }); return onChange; }
const radios = (): ReactTestRenderer['root'][] => root.root.findAllByProps({accessibilityRole:'radio'});
describe('服装候補の検索と既存値保全', () => {
  it('検索前後で元の全候補順を保持し頻度やpresetを捏造しない', () => {
    const onChange = render(); expect(radios()).toHaveLength(5); const search = root.root.findByProps({label:'選択肢を検索'});
    act(() => search.props.onChangeText('制服')); expect(radios()).toHaveLength(1); expect(JSON.stringify(root.toJSON())).toContain('制服');
    act(() => search.props.onChangeText('')); expect(radios()).toHaveLength(5); expect(onChange).not.toHaveBeenCalled();
  });
  it('日英labelと内部値で検索でき選択時だけ変更する', () => {
    const onChange = render(vi.fn(), 'legacy saved outfit'); const search = root.root.findByProps({label:'選択肢を検索'});
    expect(root.root.findAllByType('field').find(field=>field.props.value==='legacy saved outfit')).toBeDefined();
    act(() => search.props.onChangeText('MILITARY')); expect(radios()).toHaveLength(1); expect(onChange).not.toHaveBeenCalled();
    act(() => radios()[0].props.onPress()); expect(onChange).toHaveBeenCalledWith('military');
  });
  it('検索が0件でも保存値や選択肢を消さず検索だけでdirtyにしない', () => {
    const onChange = render(vi.fn(), 'school'); const search = root.root.findByProps({label:'選択肢を検索'});
    act(() => search.props.onChangeText('nonexistent')); expect(radios()).toHaveLength(0); expect(JSON.stringify(root.toJSON())).toContain('該当する選択肢はありません');
    act(() => search.props.onChangeText('')); expect(radios()).toHaveLength(5); expect(onChange).not.toHaveBeenCalled();
  });
});
