import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CharacterThumbnailPicker } from '@/components/CharacterThumbnailPicker';
import type { EntityRecord } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const renderState = vi.hoisted(() => ({ primaryRefId: 'ref-1' as string | null, referenceImagesAvailable: true, width: 390 }));

vi.mock('react-native', () => ({
  ActivityIndicator: 'spinner',
  Pressable: ({ children, onPress, ...props }: { children: React.ReactNode; onPress?: () => void }) => React.createElement('button', { ...props, onClick: onPress }, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  useWindowDimensions: () => ({ width: renderState.width }),
  View: 'view',
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: renderState.referenceImagesAvailable ? { primary_ref_id: renderState.primaryRefId, updated_at: 'revision', reference_images: [{ ref_id: 'ref-1', source: 'upload', created_at: 'revision' }] } : undefined }) }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ selection: { organizationId: null }, sessionKey: 'user', tokens: { idToken: 'token' }, api: { getEntityReferenceSet: vi.fn() } }) }));
vi.mock('@/lib/config', () => ({ config: { apiBaseUrl: 'https://api.example.test' } }));
vi.mock('@/components/ResilientImage', () => ({ ResilientImage: (props: Record<string, unknown>) => React.createElement('image', props) }));
vi.mock('lucide-react-native', () => ({ ZoomIn: () => React.createElement('zoom') }));

const character = (id: string, name: string): EntityRecord => ({
  id, work_id: 'work', name, entity_type: 'character', free_description: null,
  structured_fields: {}, prompt_supplement: null, speech_profile: {}, status: 'draft', created_at: '', updated_at: 'revision',
});

describe('CharacterThumbnailPicker', () => {
  afterEach(() => { renderState.primaryRefId = 'ref-1'; renderState.referenceImagesAvailable = true; renderState.width = 390; });

  it('selects a character and keeps the magnifier as an independent action', () => {
    const onSelect = vi.fn();
    const onPreview = vi.fn();
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<CharacterThumbnailPicker characters={[character('a', '澪')]} language="ja" onPreview={onPreview} onSelect={onSelect} selectedId={null} />);
    });

    act(() => root!.root.findByProps({ accessibilityLabel: '澪を選択' }).props.onPress());
    expect(onSelect).toHaveBeenCalledWith('a');
    act(() => root!.root.findByProps({ accessibilityLabel: '澪を拡大表示' }).props.onPress());
    expect(onPreview).toHaveBeenCalledWith('a', expect.any(Array));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('loads the next character page without making a thumbnail preview select a character', () => {
    const onEndReached = vi.fn();
    const onSelect = vi.fn();
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(
        <CharacterThumbnailPicker
          characters={[character('a', '澪'), character('b', '蒼')]}
          hasNextPage
          isFetchingNextPage={false}
          language="ja"
          onEndReached={onEndReached}
          onPreview={vi.fn()}
          onSelect={onSelect}
          selectedId="a"
        />,
      );
    });

    act(() => root!.root.findByProps({ testID: 'character-thumbnail-load-more' }).props.onPress());
    expect(onEndReached).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('uses an adaptive multi-column grid and leaves an image-less character image area blank', () => {
    renderState.referenceImagesAvailable = false;
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<CharacterThumbnailPicker characters={[character('a', '澪'), character('b', '蒼')]} language="ja" onPreview={vi.fn()} onSelect={vi.fn()} selectedId={null} />);
    });

    expect(root!.root.findByProps({ testID: 'character-thumbnail-grid-3' })).toBeDefined();
    expect(root!.root.findByProps({ testID: 'character-thumbnail-empty-a' })).toBeDefined();
    expect(root!.root.findAllByType('image')).toHaveLength(0);
    expect(JSON.stringify(root!.toJSON())).not.toContain('澪の頭文字');
  });

  it('renders eight cards on a narrow device and moves to the next local grid page', () => {
    renderState.width = 360;
    const characters = Array.from({ length: 9 }, (_, index) => character(String(index), `キャラ${index}`));
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<CharacterThumbnailPicker characters={characters} language="ja" onPreview={vi.fn()} onSelect={vi.fn()} selectedId={null} />);
    });

    expect(root!.root.findByProps({ testID: 'character-thumbnail-grid-2' })).toBeDefined();
    expect(root!.root.findByProps({ accessibilityLabel: 'キャラ7を選択' })).toBeDefined();
    expect(root!.root.findAllByProps({ accessibilityLabel: 'キャラ8を選択' })).toHaveLength(0);
    act(() => root!.root.findByProps({ testID: 'character-thumbnail-load-more' }).props.onPress());
    expect(root!.root.findByProps({ accessibilityLabel: 'キャラ8を選択' })).toBeDefined();
  });

  it('falls back to the first eligible reference when no primary reference is set', () => {
    renderState.primaryRefId = null;
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<CharacterThumbnailPicker characters={[character('a', '澪')]} language="ja" onPreview={vi.fn()} onSelect={vi.fn()} selectedId={null} />);
    });

    expect(root!.root.findAllByType('image')).toHaveLength(1);
    expect(root!.root.findByProps({ accessibilityLabel: '澪を拡大表示' })).toBeDefined();
  });

  it('follows the selected character to its grid page when the name picker selects an off-page character', () => {
    renderState.width = 360;
    const characters = Array.from({ length: 9 }, (_, index) => character(String(index), `キャラ${index}`));
    let root: ReturnType<typeof create>;
    act(() => {
      root = create(<CharacterThumbnailPicker characters={characters} language="ja" onPreview={vi.fn()} onSelect={vi.fn()} selectedId="8" />);
    });

    expect(root!.root.findByProps({ accessibilityLabel: 'キャラ8を選択' })).toBeDefined();
    expect(root!.root.findAllByProps({ accessibilityLabel: 'キャラ0を選択' })).toHaveLength(0);
  });
});
