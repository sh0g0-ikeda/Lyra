import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormField } from '@/components/FormField';
import { colors } from '@/constants/theme';

// U06 / Unified Spec §§2, 8: help is an optional, local presentation toggle.
// Keep the controlled input mounted with its existing bounds and focus behavior;
// opening help must never mutate drafts, call editing handlers, or make requests.
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

function disclosure(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByType('pressable');
}

function toggleHelp(renderer: ReactTestRenderer): void {
  act(() => disclosure(renderer).props.onPress());
}

function hasHelp(renderer: ReactTestRenderer, text = help): boolean {
  return renderer.root.findAll((node) => node.type === 'text' && node.props.children === text).length > 0;
}

afterEach(() => {
  for (const renderer of renderers.splice(0)) {
    act(() => renderer.unmount());
  }
});

describe('FormField の任意ヘルプ', () => {
  it('開閉ラベルがある場合に初期状態では本文を隠し44pt以上のボタンを表示する', () => {
    const { renderer } = renderField();
    const action = disclosure(renderer);

    expect(hasHelp(renderer)).toBe(false);
    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityLabel).toBe(helpDisclosureLabel);
    expect(action.props.accessibilityState).toMatchObject({ expanded: false });
    const styles = [action.props.style].flat().filter(Boolean);
    expect(styles.some((style) => style.minHeight >= 44)).toBe(true);
    expect(styles.some((style) => style.minWidth >= 44)).toBe(true);
  });

  it('ボタンを繰り返し押した場合に本文の表示とアクセシビリティの開閉状態が切り替わる', () => {
    const { renderer } = renderField();

    for (const expanded of [true, false, true, false]) {
      toggleHelp(renderer);
      expect(hasHelp(renderer)).toBe(expanded);
      expect(disclosure(renderer).props.accessibilityState).toMatchObject({ expanded });
    }
  });

  it.each(['', '  未保存の物語\n  '])('入力値が「%s」の場合に開閉しても値・入力インスタンス・フォーカス表示を保持する', (value) => {
    const { renderer, onChangeText } = renderField({ value, maxLength: 500, placeholder: '短い例' });
    const input = renderer.root.findByType('input');
    act(() => input.props.onFocus());

    for (let count = 0; count < 4; count += 1) {
      toggleHelp(renderer);
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
    }
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('言語と入力値が更新された場合に新しいラベルと本文を使い開閉状態と入力インスタンスを保持する', () => {
    const { renderer, onChangeText, props } = renderField();
    const input = renderer.root.findByType('input');
    toggleHelp(renderer);

    act(() => renderer.update(
      <FormField
        {...props}
        help="Describe the characters' actions and feelings"
        helpDisclosureLabel="Writing tips"
        label="Synopsis"
        value="new unsaved text"
      />
    ));

    expect(disclosure(renderer).props.accessibilityLabel).toBe('Writing tips');
    expect(disclosure(renderer).props.accessibilityState.expanded).toBe(true);
    expect(hasHelp(renderer, "Describe the characters' actions and feelings")).toBe(true);
    expect(hasHelp(renderer)).toBe(false);
    expect(renderer.root.findByType('input')).toBe(input);
    expect(input.props.accessibilityLabel).toBe('Synopsis');
    expect(input.props.value).toBe('new unsaved text');
    toggleHelp(renderer);
    expect(hasHelp(renderer, "Describe the characters' actions and feelings")).toBe(false);
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('開閉ラベルを指定しない場合に従来どおりヘルプ本文を常時表示する', () => {
    const { renderer, onChangeText } = renderField({ helpDisclosureLabel: undefined });

    expect(hasHelp(renderer)).toBe(true);
    expect(renderer.root.findAllByType('pressable')).toHaveLength(0);
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('ヘルプ本文を指定しない場合に開閉ラベルだけではボタンを表示しない', () => {
    const { renderer } = renderField({ help: undefined });

    expect(hasHelp(renderer)).toBe(false);
    expect(renderer.root.findAllByType('pressable')).toHaveLength(0);
  });

  it('読み取り専用の複数行入力の場合に入力制限を保持したままヘルプを閲覧できる', () => {
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
    toggleHelp(renderer);

    expect(hasHelp(renderer)).toBe(true);
    expect(input.props).toMatchObject({ editable: false, multiline: true, maxLength: 500, autoCorrect: false, autoCapitalize: 'none' });
    expect(input.props.style).toContainEqual({ height: 200, maxHeight: 200 });
    expect(onChangeText).not.toHaveBeenCalled();
  });
});
