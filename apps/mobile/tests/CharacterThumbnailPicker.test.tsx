import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { CharacterThumbnailPicker } from '@/components/CharacterThumbnailPicker';
import type { EntityRecord } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Pressable: ({ children, onPress, ...props }: { children: React.ReactNode; onPress?: () => void }) => React.createElement('button', { ...props, onClick: onPress }, children),
  ScrollView: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('scroll', props, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view',
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { primary_ref_id: 'ref-1', updated_at: 'revision', reference_images: [{ ref_id: 'ref-1', source: 'upload', created_at: 'revision' }] } }) }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ selection: { organizationId: null }, sessionKey: 'user', tokens: { idToken: 'token' }, api: { getEntityReferenceSet: vi.fn() } }) }));
vi.mock('@/lib/config', () => ({ config: { apiBaseUrl: 'https://api.example.test' } }));
vi.mock('@/components/ResilientImage', () => ({ ResilientImage: (props: Record<string, unknown>) => React.createElement('image', props) }));
vi.mock('lucide-react-native', () => ({ ZoomIn: () => React.createElement('zoom') }));

const character = (id: string, name: string): EntityRecord => ({
  id, work_id: 'work', name, entity_type: 'character', free_description: null,
  structured_fields: {}, prompt_supplement: null, speech_profile: {}, status: 'draft', created_at: '', updated_at: 'revision',
});

describe('CharacterThumbnailPicker', () => {
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
});
