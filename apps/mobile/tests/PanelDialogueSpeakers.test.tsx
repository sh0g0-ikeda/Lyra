import React, { useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { PanelDialogueEditor } from '@/components/PanelDialogueEditor';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SegmentedControl } from '@/components/SegmentedControl';
import type { EntityRecord, PanelDialogueLine } from '@/domain/types';

// F21 / Unified Spec §§5, 8, 11: current-work speakers and visible assignments
// are independent. Retain unresolved drafts through paging and selection. Only
// an explicit load-more action may request another page; dialogue changes never
// assign a visible entity or add a reference image.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({
  Pressable: 'pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));
vi.mock('@/components/FormField', () => ({ FormField: () => null }));
vi.mock('@/components/Notice', () => ({ Notice: () => null }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: () => null }));
vi.mock('@/components/SegmentedControl', () => ({ SegmentedControl: () => null }));

const entities = [
  { id: 'off-panel', name: 'Aoi', work_id: 'work-1' },
  { id: 'visible', name: 'Ren', work_id: 'work-1' }
] as EntityRecord[];
const line = (entityId: string | null, type: PanelDialogueLine['type'] = 'speech'): PanelDialogueLine => ({
  entity_id: entityId, text: '  Saved dialogue  ', type, position: 'bottom'
});
type EditorProps = React.ComponentProps<typeof PanelDialogueEditor>;
function renderEditor(overrides: Partial<EditorProps> = {}): {
  renderer: ReactTestRenderer;
  changed: ReturnType<typeof vi.fn>;
  update: (next: Partial<EditorProps>) => void;
} {
  const changed = vi.fn();
  const base: EditorProps = {
    dialogues: [line('visible')], entities, visibleEntityIds: ['visible'], language: 'en', onChange: changed
  };
  let props = { ...base, ...overrides };
  function Harness({ options }: { options: EditorProps }): React.JSX.Element {
    const [dialogues, setDialogues] = useState(options.dialogues);
    return <PanelDialogueEditor {...options} dialogues={dialogues} onChange={(next) => {
      changed(next);
      setDialogues(next);
    }} />;
  }
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<Harness options={props} />); });
  return {
    renderer: renderer!, changed,
    update: (next) => {
      props = { ...props, ...next };
      act(() => renderer.update(<Harness options={props} />));
    }
  };
}
function speaker(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findAllByType(SegmentedControl)[0];
}
function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAllByType(PrimaryButton).find((item) => item.props.label === label);
  expect(found, label).toBeDefined();
  return found!;
}
function notices(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Notice).map((item) => item.props.message as string);
}
function selectLine(renderer: ReactTestRenderer, index: number): void {
  const rows = renderer.root.findAll((item) => item.type === 'pressable' && item.props.accessibilityRole === 'radio');
  act(() => rows[index].props.onPress());
}

describe('PanelDialogueEditor の作品内話者', () => {
  it.each(['ja', 'en'] as const)('言語が %s の場合にコマ外の話者を明示して元の ID を保持する', (language) => {
    const onLoadMoreEntities = vi.fn();
    const { renderer, changed } = renderEditor({
      language, dialogues: [line('off-panel', 'thought')], hasMoreEntities: true, onLoadMoreEntities
    });
    expect(speaker(renderer).props.options).toEqual([
      { value: 'off-panel', label: language === 'ja' ? 'Aoi（コマ外）' : 'Aoi (off-panel)' },
      { value: 'visible', label: 'Ren' }
    ]);
    expect(speaker(renderer).props.value).toBe('off-panel');
    expect(notices(renderer)).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    expect(onLoadMoreEntities).not.toHaveBeenCalled();
  });

  it('コマ外の話者を選んだ場合にセリフだけを変更し参照と登場人物を変えない', () => {
    const onLoadMoreEntities = vi.fn();
    const original = [line('visible'), line(null, 'narration')];
    const visibleEntityIds = ['visible'];
    const { renderer, changed } = renderEditor({ dialogues: original, visibleEntityIds, hasMoreEntities: true, onLoadMoreEntities });
    act(() => speaker(renderer).props.onChange('off-panel'));
    expect(changed).toHaveBeenCalledExactlyOnceWith([{ ...original[0], entity_id: 'off-panel' }, original[1]]);
    expect(changed.mock.lastCall?.[0][1]).toBe(original[1]);
    expect(visibleEntityIds).toEqual(['visible']);
    expect(entities.map((entity) => entity.id)).toEqual(['off-panel', 'visible']);
    expect(onLoadMoreEntities).not.toHaveBeenCalled();
    selectLine(renderer, 1);
    selectLine(renderer, 0);
    expect(speaker(renderer).props.value).toBe('off-panel');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it.each([{ loadedEntities: [] }, { loadedEntities: [entities[1]] }])('話者一覧が空または一部の場合に未解決 ID と下書きを置き換えない', ({ loadedEntities }) => {
    const onLoadMoreEntities = vi.fn();
    const { renderer, changed, update } = renderEditor({
      dialogues: [line('off-panel'), line('visible')], entities: loadedEntities,
      hasMoreEntities: true, onLoadMoreEntities
    });
    expect(speaker(renderer).props.value).toBe('off-panel');
    expect(speaker(renderer).props.options).toContainEqual({ value: 'off-panel', label: 'Unresolved speaker' });
    expect(notices(renderer).join(' ')).toContain('The saved speaker is missing from this work’s loaded character list');
    selectLine(renderer, 1);
    selectLine(renderer, 0);
    expect(changed).not.toHaveBeenCalled();
    expect(onLoadMoreEntities).not.toHaveBeenCalled();
    act(() => renderer.root.findAllByType(SegmentedControl)[1].props.onChange('thought'));
    expect(changed.mock.lastCall?.[0][0]).toEqual(line('off-panel', 'thought'));
    act(() => renderer.root.findByType(FormField).props.onChangeText('  unsaved edit  '));
    expect(changed.mock.lastCall?.[0][0].entity_id).toBe('off-panel');
    act(() => button(renderer, 'Load more characters').props.onPress());
    expect(onLoadMoreEntities).toHaveBeenCalledTimes(1);
    const changeCount = changed.mock.calls.length;
    update({ entities, hasMoreEntities: false });
    expect(notices(renderer)).toEqual([]);
    expect(speaker(renderer).props.value).toBe('off-panel');
    expect(speaker(renderer).props.options).toContainEqual({ value: 'off-panel', label: 'Aoi (off-panel)' });
    expect(renderer.root.findByType(FormField).props.value).toBe('  unsaved edit  ');
    expect(changed).toHaveBeenCalledTimes(changeCount);
  });

  it.each(['speech', 'thought', 'narration', 'sfx'] as const)('%s の不明な話者を保持し警告する', (type) => {
    const { renderer, changed } = renderEditor({ dialogues: [line('foreign', type)], hasMoreEntities: false });
    expect(speaker(renderer).props.value).toBe('foreign');
    expect(notices(renderer).join(' ')).toContain('The saved speaker is missing');
    expect(notices(renderer).join(' ')).toContain('kept unchanged');
    act(() => speaker(renderer).props.onChange('another-foreign'));
    expect(changed).not.toHaveBeenCalled();
    act(() => renderer.root.findAllByType(SegmentedControl)[1].props.onChange('whisper'));
    expect(changed.mock.lastCall?.[0][0].entity_id).toBe('foreign');
  });

  it('未解決の話者を持つ行を削除して取り消した場合に話者と全文を復元する', () => {
    const original = line('unresolved', 'thought');
    const { renderer, changed } = renderEditor({ dialogues: [original] });
    act(() => button(renderer, 'Delete').props.onPress());
    expect(changed.mock.lastCall?.[0]).toEqual([]);
    act(() => button(renderer, 'Undo').props.onPress());
    expect(changed.mock.lastCall?.[0]).toEqual([original]);
    expect(speaker(renderer).props.value).toBe('unresolved');
    expect(renderer.root.findByType(FormField).props.value).toBe(original.text);
    expect(notices(renderer).join(' ')).toContain('The saved speaker is missing');
  });

  it.each(['speech', 'thought', 'shout', 'whisper'] as const)('%s の話者が空の場合に作品内話者を要求する', (type) => {
    const { renderer, changed } = renderEditor({ dialogues: [line(null, type)], visibleEntityIds: [] });
    expect(notices(renderer).join(' ')).toContain('Choose a character from this work as the speaker');
    expect(speaker(renderer).props.options).toContainEqual({ value: '', label: 'Choose a speaker' });
    expect(speaker(renderer).props.value).toBe('');
    expect(speaker(renderer).props.options.some((option: { label: string }) => option.label === 'None')).toBe(false);
    act(() => speaker(renderer).props.onChange(''));
    expect(changed).not.toHaveBeenCalled();
    act(() => speaker(renderer).props.onChange('off-panel'));
    expect(changed.mock.lastCall?.[0][0].entity_id).toBe('off-panel');
    expect(notices(renderer)).toEqual([]);
  });

  it.each(['narration', 'sfx'] as const)('%s の場合に話者なしを選択できる', (type) => {
    const { renderer, changed } = renderEditor({ dialogues: [line('off-panel', type)] });
    expect(speaker(renderer).props.options).toContainEqual({ value: '', label: 'None' });
    act(() => speaker(renderer).props.onChange(''));
    expect(changed.mock.lastCall?.[0][0].entity_id).toBeNull();
    expect(notices(renderer)).toEqual([]);
  });

  it('追加時に一覧の先頭のコマ外キャラではなく最初の登場人物を初期話者にする', () => {
    const { renderer, changed } = renderEditor({ dialogues: [] });
    act(() => button(renderer, 'Add dialogue').props.onPress());
    expect(changed.mock.lastCall?.[0]).toEqual([{ entity_id: 'visible', text: '', type: 'speech', position: 'top' }]);
  });

  it.each([{ visibleEntityIds: [] }, { visibleEntityIds: ['missing-visible'] }])('登場人物がいない場合にコマ外キャラを自動選択せずナレーションを追加する', ({ visibleEntityIds }) => {
    const { renderer, changed } = renderEditor({ dialogues: [], visibleEntityIds });
    act(() => button(renderer, 'Add dialogue').props.onPress());
    expect(changed.mock.lastCall?.[0]).toEqual([{ entity_id: null, text: '', type: 'narration', position: 'top' }]);
    act(() => renderer.root.findAllByType(SegmentedControl)[1].props.onChange('speech'));
    expect(changed.mock.lastCall?.[0][0]).toEqual({ entity_id: null, text: '', type: 'speech', position: 'top' });
  });

  it('visibleEntityIds を指定しない既存呼び出しの場合に全キャラを登場人物として扱う', () => {
    const { renderer, changed } = renderEditor({ visibleEntityIds: undefined });
    expect(speaker(renderer).props.options).toEqual(entities.map((entity) => ({ value: entity.id, label: entity.name })));
    act(() => button(renderer, 'Add dialogue').props.onPress());
    expect(changed.mock.lastCall?.[0][1].entity_id).toBe('off-panel');
  });

  it.each(['ja', 'en'] as const)('言語が %s で一覧が空の場合にコマへの割り当てを要求しない', (language) => {
    const { renderer } = renderEditor({ language, dialogues: [line(null)], entities: [] });
    expect(JSON.stringify(renderer.toJSON())).toContain(language === 'ja' ? 'この作品のキャラクターはまだ読み込まれていません' : 'No characters from this work are loaded yet');
  });

  it('読み取り専用では一覧を追加で読み込めるが話者を変更せず読み込み中は再取得しない', () => {
    const onLoadMoreEntities = vi.fn();
    const { renderer, changed, update } = renderEditor({ disabled: true, hasMoreEntities: true, onLoadMoreEntities });
    expect(button(renderer, 'Load more characters').props.disabled).toBe(false);
    act(() => button(renderer, 'Load more characters').props.onPress());
    act(() => speaker(renderer).props.onChange('off-panel'));
    expect(changed).not.toHaveBeenCalled();
    expect(onLoadMoreEntities).toHaveBeenCalledTimes(1);
    update({ disabled: false, loadingEntities: true });
    expect(button(renderer, 'Loading characters…').props.loading).toBe(true);
    act(() => button(renderer, 'Loading characters…').props.onPress());
    expect(onLoadMoreEntities).toHaveBeenCalledTimes(1);
    update({ loadingEntities: false, hasMoreEntities: false });
    expect(renderer.root.findAllByType(PrimaryButton).some((item) => item.props.label === 'Load more characters')).toBe(false);
  });

  it('ページング処理がない場合に読み込み操作を無効にする', () => {
    const { renderer, changed } = renderEditor({ hasMoreEntities: true });
    expect(button(renderer, 'Load more characters').props.disabled).toBe(true);
    act(() => button(renderer, 'Load more characters').props.onPress());
    expect(changed).not.toHaveBeenCalled();
  });
});
