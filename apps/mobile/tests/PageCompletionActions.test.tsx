import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import { PageCompletionActions } from '@/components/PageCompletionActions';

const labels = (confirmed: boolean): string[] => {
  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <PageCompletionActions
        confirmed={confirmed}
        exportSection={React.createElement('section', { label: 'export' })}
        generationSection={React.createElement('section', { label: 'generation' })}
      />
    );
  });
  return renderer!.root.findAllByType('section').map((node) => node.props.label as string);
};

describe('PageCompletionActions', () => {
  it('編集中は生成の後に書き出しを表示する', () => {
    expect(labels(false)).toEqual(['generation', 'export']);
  });

  it('確定後は生成を隠して書き出しだけ表示する', () => {
    expect(labels(true)).toEqual(['export']);
  });
});
