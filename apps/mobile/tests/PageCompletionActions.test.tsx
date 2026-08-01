import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { PageCompletionActions } from '@/components/PageCompletionActions';

const labels = (): string[] => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <PageCompletionActions
        exportSection={React.createElement('section', { label: 'export' })}
        generationSection={React.createElement('section', { label: 'generation' })}
      />
    );
  });
  return renderer!.root.findAllByType('section').map((node) => node.props.label as string);
};

describe('PageCompletionActions', () => {
  it('ページ状態にかかわらず生成の後に書き出しを表示する', () => {
    expect(labels()).toEqual(['generation', 'export']);
  });
});
