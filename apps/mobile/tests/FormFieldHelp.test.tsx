import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormField } from '@/components/FormField';
import { colors } from '@/constants/theme';

// Unified Spec §§2, 8: field hints must not add a competing disclosure or obscure
// the primary input. Legacy hint props remain accepted only for source compatibility.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Pressable: 'pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  TextInput: 'input',
  View: 'view'
}));

const help = '登場人物の行動や気持ちを自由に書いてください';
const label = 'あらすじ';
const helpDisclosureLabel = '書き方のヒント';
const renderers: ReactTestRenderer[] = [];

function renderField(overrides: Partial<React.ComponentProps<typeof FormField>> = {}): {
  renderer: ReactTestRenderer;
  onChangeText: ReturnType<typeof vi.fn>;
  props: React.ComponentProps<typeof FormField>;
} {
  const onChangeText = vi.fn();
  const props = { help, helpDisclosureLabel, label, onChangeText, value: '  未保存の物語\n  ', ...overrides };
  let renderer: ReactTestRenderer;
  act(() => { renderer = create(<FormField {...props} />); });
  renderers.push(renderer!);
  return { renderer: renderer!, onChangeText, props };
}

function hasHelp(renderer: ReactTestRenderer, text = help): boolean {
  return renderer.root.findAll((node) => node.type === 'text' && node.props.children === text).length > 0;
}

afterEach(() => {
  for (const renderer of renderers.splice(0)) {
    act(() => renderer.unmount());
  }
});

describe('FormField の入力ヒント非表示', () => {
  it('互換用のヒントpropsがあっても本文と開閉ボタンを表示しない', () => {
    const { renderer } = renderField();
    expect(hasHelp(renderer)).toBe(false);
    expect(renderer.root.findAllByType('pressable')).toHaveLength(0);
  });

  it.each(['', '  未保存の物語\n  '])('入力値が「%s」の場合も値・入力インスタンス・フォーカス表示を保持する', (value) => {
    const { renderer, onChangeText } = renderField({ value, maxLength: 500, placeholder: '短い例' });
    const input = renderer.root.findByType('input');
    act(() => input.props.onFocus());

    const current = renderer.root.findByType('input');
    expect(current).toBe(input);
    expect(current.props.value).toBe(value);
    expect(current.props.onChangeText).toBe(onChangeText);
    expect(current.props.placeholder).toBe('短い例');
    expect(current.props.maxLength).toBe(500);
    expect(current.props.style).toContainEqual(expect.objectContaining({ borderColor: colors.primary }));
    expect(renderer.root.findAllByType('text').some((node) =>
      node.children.join('') === `${value.length}/500`
    )).toBe(true);
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('言語と入力値が更新されてもヒントを出さず入力インスタンスを保持する', () => {
    const { renderer, onChangeText, props } = renderField();
    const input = renderer.root.findByType('input');
    act(() => renderer.update(
      <FormField
        {...props}
        help="Describe the characters' actions and feelings"
        helpDisclosureLabel="Writing tips"
        label="Synopsis"
        value="new unsaved text"
      />
    ));

    expect(renderer.root.findAllByType('pressable')).toHaveLength(0);
    expect(hasHelp(renderer, "Describe the characters' actions and feelings")).toBe(false);
    expect(hasHelp(renderer)).toBe(false);
    expect(renderer.root.findByType('input')).toBe(input);
    expect(input.props.accessibilityLabel).toBe('Synopsis');
    expect(input.props.value).toBe('new unsaved text');
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('開閉ラベルを指定しない場合もヘルプ本文を表示しない', () => {
    const { renderer, onChangeText } = renderField({ helpDisclosureLabel: undefined });

    expect(hasHelp(renderer)).toBe(false);
    expect(renderer.root.findAllByType('pressable')).toHaveLength(0);
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('ヘルプ本文を指定しない場合に開閉ラベルだけではボタンを表示しない', () => {
    const { renderer } = renderField({ help: undefined });

    expect(hasHelp(renderer)).toBe(false);
    expect(renderer.root.findAllByType('pressable')).toHaveLength(0);
  });

  it('読み取り専用の複数行入力でも入力制限を保持しヒントを表示しない', () => {
    const { renderer, onChangeText } = renderField({
      editable: false,
      multiline: true,
      multilineMinHeight: 120,
      multilineMaxHeight: 200,
      maxLength: 500,
      autoCorrect: false,
      autoCapitalize: 'none'
    });
    const input = renderer.root.findByType('input');
    act(() => input.props.onContentSizeChange({ nativeEvent: { contentSize: { height: 300 } } }));
    expect(hasHelp(renderer)).toBe(false);
    expect(input.props).toMatchObject({ editable: false, multiline: true, maxLength: 500, autoCorrect: false, autoCapitalize: 'none' });
    expect(input.props.style).toContainEqual({ height: 200, maxHeight: 200 });
    expect(onChangeText).not.toHaveBeenCalled();
  });
});
