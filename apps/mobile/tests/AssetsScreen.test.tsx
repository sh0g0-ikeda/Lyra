import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AssetsScreen } from '@/screens/AssetsScreen';

let focused = true;
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => focused }));
vi.mock('@/components/MangaReader', () => ({ MangaReader: () => React.createElement('manga-reader') }));
vi.mock('@/screens/CharactersScreen', () => ({ CharactersScreen: () => React.createElement('characters-editor') }));

describe('AssetsScreen', () => {
  it('フォーカス中はキャラクター編集ではなく作品readerを表示する', () => {
    focused = true;
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<AssetsScreen />); });
    expect(renderer!.root.findAllByType('manga-reader')).toHaveLength(1);
    expect(renderer!.root.findAllByType('characters-editor')).toHaveLength(0);
  });

  it('非フォーカス時はreaderをmountしない', () => {
    focused = false;
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<AssetsScreen />); });
    expect(renderer!.toJSON()).toBeNull();
  });
});