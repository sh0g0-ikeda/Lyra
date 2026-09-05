import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PanelDialogueEditor } from '@/components/PanelDialogueEditor';
import type { EntityRecord, PanelDialogueLine } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Pressable: ({ children, onPress, ...props }: { children: React.ReactNode; onPress?: () => void }) =>
    React.createElement('button', { ...props, onClick: onPress }, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/FormField', () => ({
  FormField: ({ label, onChangeText, value }: { label: string; onChangeText: (text: string) => void; value: string }) =>
    React.createElement('field', { onChangeText, value }, label)
}));

vi.mock('@/components/Notice', () => ({
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    disabled,
    label,
    onPress
  }: {
    disabled?: boolean;
    label: string;
    onPress: () => void;
  }) => React.createElement('button', { disabled, onClick: onPress }, label)
}));

vi.mock('@/components/SegmentedControl', () => ({
  SegmentedControl: ({ options }: { options: { label: string }[] }) =>
    React.createElement('segmented-control', null, options.map((option) => option.label).join('|'))
}));

const entity = (id: string, name: string): EntityRecord =>
  ({
    id,
    name
  }) as EntityRecord;

describe('PanelDialogueEditor', () => {
  it('仕様どおり「セリフを追加」と表示し旧文言を表示しない', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelDialogueEditor
          dialogues={[]}
          entities={[entity('entity-1', '蓮')]}
          language="ja"
          onChange={vi.fn()}
        />
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('セリフを追加');
    expect(rendered).not.toContain('行を追加');
    expect(rendered).not.toContain('セリフ行');
  });

  it('ナレーション内の人物名付き引用に品質警告を表示する', () => {
    const dialogues: PanelDialogueLine[] = [
      {
        entity_id: null,
        text: '蓮「急ごう」',
        type: 'narration',
        position: 'top'
      }
    ];
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelDialogueEditor
          dialogues={dialogues}
          entities={[entity('entity-1', '蓮')]}
          language="ja"
          onChange={vi.fn()}
        />
      );
    });

    expect(JSON.stringify(renderer!.toJSON())).toContain('ナレーションに「蓮」の発話らしい表現があります');
  });

  it('追加時は登場中キャラクターを初期話者にする', () => {
    const onChange = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelDialogueEditor
          dialogues={[]}
          entities={[entity('entity-1', '蓮')]}
          language="ja"
          onChange={onChange}
        />
      );
    });

    const addButton = renderer!.root
      .findAllByType('button')
      .find((button) => button.children.includes('セリフを追加'));
    expect(addButton).toBeDefined();
    act(() => addButton!.props.onClick());
    expect(onChange).toHaveBeenCalledWith([
      {
        entity_id: 'entity-1',
        text: '',
        type: 'speech',
        position: 'top'
      }
    ]);
  });

  it('選択した1行だけを編集し、行の切替後も未保存値を保持する', () => {
    const initialDialogues: PanelDialogueLine[] = [
      { entity_id: 'entity-1', text: '一行目', type: 'speech', position: 'top' },
      { entity_id: 'entity-1', text: '二行目', type: 'thought', position: 'bottom' }
    ];
    function Harness(): React.JSX.Element {
      const [dialogues, setDialogues] = React.useState(initialDialogues);
      return <PanelDialogueEditor dialogues={dialogues} entities={[entity('entity-1', '蓮')]} language="ja" onChange={setDialogues} />;
    }
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<Harness />); });

    expect(renderer!.root.findAllByType('field')).toHaveLength(1);
    const dialogueButton = (label: string) => renderer!.root.findAllByType('button').find((button) => button.props.accessibilityLabel === label)!;
    act(() => dialogueButton('セリフ 1').props.onClick());
    act(() => renderer!.root.findByType('field').props.onChangeText('一行目の下書き'));
    act(() => dialogueButton('セリフ 2').props.onClick());
    expect(renderer!.root.findByType('field').props.value).toBe('二行目');
    act(() => dialogueButton('セリフ 1').props.onClick());
    expect(renderer!.root.findByType('field').props.value).toBe('一行目の下書き');
  });

  it('選択中の行を削除して元に戻す場合に他の未保存値を保持する', () => {
    const initialDialogues: PanelDialogueLine[] = [
      { entity_id: 'entity-1', text: '一行目', type: 'speech', position: 'top' },
      { entity_id: 'entity-1', text: '二行目', type: 'thought', position: 'bottom' }
    ];
    function Harness(): React.JSX.Element {
      const [dialogues, setDialogues] = React.useState(initialDialogues);
      return <PanelDialogueEditor dialogues={dialogues} entities={[entity('entity-1', '蓮')]} language="ja" onChange={setDialogues} />;
    }
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<Harness />); });

    const dialogueButton = (label: string) => renderer!.root.findAllByType('button').find((button) => button.props.accessibilityLabel === label)!;
    const buttons = (label: string) => renderer!.root.findAllByType('button').filter((button) => button.children.includes(label));
    act(() => dialogueButton('セリフ 2').props.onClick());
    act(() => renderer!.root.findByType('field').props.onChangeText('二行目の下書き'));
    act(() => buttons('削除')[0]!.props.onClick());
    expect(renderer!.root.findByType('field').props.value).toBe('一行目');
    act(() => buttons('元に戻す')[0]!.props.onClick());
    act(() => dialogueButton('セリフ 2').props.onClick());
    expect(renderer!.root.findByType('field').props.value).toBe('二行目の下書き');
  });
});
