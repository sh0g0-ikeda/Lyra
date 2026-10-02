import React, { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { FormField } from '@/components/FormField';
import { PanelDialogueEditor } from '@/components/PanelDialogueEditor';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SegmentedControl } from '@/components/SegmentedControl';
import type { EntityRecord, PanelDialogueLine } from '@/domain/types';

// Design E §6.2 / Unified Spec §§2, 5, 8: selection is UI-only. The parent owns
// every unsaved line; selecting one must never rewrite, filter, or reorder it.
// Mutating controls remain guarded when read-only, while lines remain inspectable.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Pressable: 'pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));
vi.mock('@/components/FormField', () => ({ FormField: () => null }));
vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
}));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: () => null }));
vi.mock('@/components/SegmentedControl', () => ({ SegmentedControl: () => null }));

const entities = [
  { id: 'entity-1', name: '蓮' },
  { id: 'entity-2', name: 'Aoi' }
] as EntityRecord[];
const lines = (): PanelDialogueLine[] => [
  { entity_id: 'entity-1', text: 'First line', type: 'speech', position: 'top' },
  { entity_id: 'entity-2', text: 'Second line', type: 'thought', position: 'bottom' },
  { entity_id: null, text: 'Third line', type: 'narration', position: 'left' }
];

function renderEditor(options: {
  initial?: PanelDialogueLine[];
  disabled?: boolean;
  language?: 'ja' | 'en';
  assignedEntities?: EntityRecord[];
} = {}): { renderer: ReactTestRenderer; changed: ReturnType<typeof vi.fn> } {
  const changed = vi.fn();
  function Harness(): React.JSX.Element {
    const [dialogues, setDialogues] = useState(options.initial ?? lines());
    return (
      <PanelDialogueEditor
        dialogues={dialogues}
        disabled={options.disabled}
        entities={options.assignedEntities ?? entities}
        language={options.language ?? 'en'}
        onChange={(next) => {
          changed(next);
          setDialogues(next);
        }}
      />
    );
  }
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<Harness />); });
  return { renderer: renderer!, changed };
}

function pickerRows(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((node) => node.type === 'pressable' && node.props.accessibilityRole === 'radio');
}
function select(renderer: ReactTestRenderer, index: number): void {
  act(() => pickerRows(renderer)[index].props.onPress());
}
function field(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByType(FormField);
}
function press(renderer: ReactTestRenderer, label: string): void {
  const button = renderer.root.findAllByType(PrimaryButton).find((item) => item.props.label === label);
  expect(button, label).toBeDefined();
  act(() => button!.props.onPress());
}
function editText(renderer: ReactTestRenderer, text: string): void {
  act(() => field(renderer).props.onChangeText(text));
}

// Include duplicate/blank lines because line identity is its position in the
// current controlled array, not speaker, text, or type.
describe('PanelDialogueEditor の選択式編集', () => {
  it.each(['ja', 'en'] as const)('言語が %s の場合に全行を一覧表示し選択した一行だけ編集できる', (language) => {
    const { renderer, changed } = renderEditor({ language });
    const rows = pickerRows(renderer);
    expect(rows).toHaveLength(3);
    expect(rows[0].props.accessibilityLabel).toContain(language === 'ja' ? 'セリフ 1' : 'Dialogue 1');
    expect(rows[0].props.accessibilityState.selected).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('Second line');
    expect(JSON.stringify(renderer.toJSON())).toContain('Third line');
    expect(renderer.root.findAllByType(FormField)).toHaveLength(1);
    expect(renderer.root.findAllByType(SegmentedControl)).toHaveLength(3);
    expect(field(renderer).props.value).toBe('First line');

    select(renderer, 1);
    select(renderer, 1);
    expect(changed).not.toHaveBeenCalled();
    expect(field(renderer).props.value).toBe('Second line');
    expect(pickerRows(renderer).map((row) => row.props.accessibilityState.selected)).toEqual([false, true, false]);
    for (const row of pickerRows(renderer)) {
      const styles = [row.props.style].flat().filter(Boolean);
      expect(styles.some((style) => style.minHeight >= 44)).toBe(true);
    }
  });

  it('行を切り替えた場合に未保存の全文と話者・種類・位置を保持する', () => {
    const initial = lines();
    const { renderer, changed } = renderEditor({ initial });
    editText(renderer, '  first unsaved  ');
    select(renderer, 1);
    const [speaker, type, position] = renderer.root.findAllByType(SegmentedControl);
    act(() => speaker.props.onChange('entity-1'));
    act(() => type.props.onChange('whisper'));
    act(() => position.props.onChange('right'));
    editText(renderer, 'second unsaved');
    const callCount = changed.mock.calls.length;
    select(renderer, 2);
    select(renderer, 0);
    expect(field(renderer).props.value).toBe('  first unsaved  ');
    expect(changed).toHaveBeenCalledTimes(callCount);
    select(renderer, 1);
    expect(renderer.root.findAllByType(SegmentedControl).map((control) => control.props.value))
      .toEqual(['entity-1', 'whisper', 'right']);
    expect(changed.mock.lastCall?.[0]).toEqual([
      { ...initial[0], text: '  first unsaved  ' },
      { entity_id: 'entity-1', text: 'second unsaved', type: 'whisper', position: 'right' },
      initial[2]
    ]);
    expect(changed.mock.lastCall?.[0][2]).toBe(initial[2]);
  });

  it('同じ内容や空の行がある場合に選択だけでは trim/filter しない', () => {
    const initial = [lines()[0], { ...lines()[0] }, { ...lines()[0], text: '  ' }];
    const { renderer, changed } = renderEditor({ initial });
    select(renderer, 1);
    editText(renderer, 'second only');
    select(renderer, 2);
    expect(field(renderer).props.value).toBe('  ');
    expect(changed.mock.lastCall?.[0]).toEqual([initial[0], { ...initial[1], text: 'second only' }, initial[2]]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1, 2])('選択行 %i を削除した場合に隣接行へ移り取り消すと元の位置へ復元する', (index) => {
    const initial = lines();
    const { renderer, changed } = renderEditor({ initial });
    select(renderer, index);
    editText(renderer, 'unsaved before delete');
    press(renderer, 'Delete');
    const remaining = initial.filter((_, current) => current !== index);
    expect(changed.mock.lastCall?.[0]).toEqual(remaining);
    expect(field(renderer).props.value).toBe(remaining[Math.min(index, remaining.length - 1)].text);
    press(renderer, 'Undo');
    expect(changed.mock.lastCall?.[0]).toEqual(initial.map((line, current) => current === index ? { ...line, text: 'unsaved before delete' } : line));
    expect(field(renderer).props.value).toBe('unsaved before delete');
    expect(pickerRows(renderer)[index].props.accessibilityState.selected).toBe(true);
  });

  it('最後の一行を削除した場合に空状態となり取り消すと復元する', () => {
    const { renderer } = renderEditor({ initial: [lines()[0]] });
    press(renderer, 'Delete');
    expect(renderer.root.findAllByType(FormField)).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('No dialogue yet');
    press(renderer, 'Undo');
    expect(field(renderer).props.value).toBe('First line');
  });

  it.each([true, false])('登場人物の有無が %s の場合に新規の空行を選択して適切な話者を設定する', (hasSpeaker) => {
    const { renderer, changed } = renderEditor({ assignedEntities: hasSpeaker ? entities : [] });
    press(renderer, 'Delete');
    press(renderer, 'Add dialogue');
    expect(pickerRows(renderer)).toHaveLength(3);
    expect(pickerRows(renderer)[2].props.accessibilityState.selected).toBe(true);
    expect(field(renderer).props.value).toBe('');
    expect(changed.mock.lastCall?.[0][2]).toEqual({
      entity_id: hasSpeaker ? 'entity-1' : null,
      text: '',
      type: hasSpeaker ? 'speech' : 'narration',
      position: 'top'
    });
    expect(renderer.root.findAllByType(PrimaryButton).some((button) => button.props.label === 'Undo')).toBe(false);
  });

  it('読み取り専用の場合に行の内容を閲覧できるが編集や追加・削除しない', () => {
    const { renderer, changed } = renderEditor({ disabled: true });
    select(renderer, 1);
    expect(field(renderer).props.value).toBe('Second line');
    expect(field(renderer).props.editable).toBe(false);
    expect(field(renderer).props.maxLength).toBe(500);
    editText(renderer, 'blocked');
    const controls = renderer.root.findAllByType(SegmentedControl);
    expect(controls.every((control) => control.props.disabled)).toBe(true);
    act(() => controls[0].props.onChange('entity-1'));
    act(() => controls[1].props.onChange('narration'));
    act(() => controls[2].props.onChange('right'));
    expect(renderer.root.findAllByType(PrimaryButton).every((button) => button.props.disabled)).toBe(true);
    press(renderer, 'Delete');
    press(renderer, 'Add dialogue');
    expect(changed).not.toHaveBeenCalled();
  });

  it('削除後に別の行を編集した場合に取り消しても新しい入力を保持する', () => {
    const initial = lines();
    const { renderer, changed } = renderEditor({ initial });
    select(renderer, 1);
    press(renderer, 'Delete');
    editText(renderer, 'third unsaved');
    select(renderer, 0);
    editText(renderer, 'first unsaved');
    press(renderer, 'Undo');
    expect(changed.mock.lastCall?.[0]).toEqual([
      { ...initial[0], text: 'first unsaved' },
      initial[1],
      { ...initial[2], text: 'third unsaved' }
    ]);
    expect(field(renderer).props.value).toBe('Second line');
  });

  it('削除後に読み取り専用となった場合に取り消し操作でデータを変えない', () => {
    const onChange = vi.fn();
    let renderer: ReactTestRenderer;
    const render = (dialogues: PanelDialogueLine[], disabled: boolean): React.JSX.Element => (
      <PanelDialogueEditor dialogues={dialogues} disabled={disabled} entities={entities} language="en" onChange={onChange} />
    );
    act(() => { renderer = create(render(lines(), false)); });
    press(renderer!, 'Delete');
    const remaining = onChange.mock.lastCall?.[0] as PanelDialogueLine[];
    onChange.mockClear();
    act(() => renderer!.update(render(remaining, true)));
    const undo = renderer!.root.findAllByType(PrimaryButton).find((button) => button.props.label === 'Undo');
    expect(undo?.props.disabled).toBe(true);
    press(renderer!, 'Undo');
    expect(onChange).not.toHaveBeenCalled();
    expect(pickerRows(renderer!)).toHaveLength(2);
  });

  it('無効な話者や引用を含む行を選択した場合に既存の警告を表示する', () => {
    const initial: PanelDialogueLine[] = [
      lines()[0],
      { ...lines()[1], entity_id: 'unassigned' },
      { ...lines()[2], text: '蓮「急ごう」' }
    ];
    const { renderer } = renderEditor({ initial, language: 'ja' });
    expect(renderer.root.findAllByType('notice')).toHaveLength(0);
    select(renderer, 1);
    expect(JSON.stringify(renderer.toJSON())).toContain('保存済みの話者がこの作品の一覧に見つかりません');
    select(renderer, 2);
    expect(JSON.stringify(renderer.toJSON())).toContain('ナレーションに「蓮」の発話らしい表現があります');
    act(() => renderer.root.findAllByType(SegmentedControl)[1].props.onChange('speech'));
    expect(renderer.root.findAllByType(SegmentedControl)[0].props.value).toBe('entity-1');
  });

  it('親が一覧を短縮または空にした場合に存在する行へ安全にフォールバックする', () => {
    const onChange = vi.fn();
    let renderer: ReactTestRenderer;
    const render = (dialogues: PanelDialogueLine[]): React.JSX.Element => (
      <PanelDialogueEditor dialogues={dialogues} entities={entities} language="en" onChange={onChange} />
    );
    act(() => { renderer = create(render(lines())); });
    select(renderer!, 2);
    act(() => renderer!.update(render([lines()[0]])));
    expect(field(renderer!).props.value).toBe('First line');
    expect(pickerRows(renderer!)[0].props.accessibilityState.selected).toBe(true);
    act(() => renderer!.update(render([])));
    expect(renderer!.root.findAllByType(FormField)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
