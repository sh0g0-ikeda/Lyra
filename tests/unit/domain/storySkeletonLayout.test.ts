import { describe, expect, it } from 'vitest';
import { selectStoryPurposeLayout } from '../../../src/domain/storySkeletonLayout.js';

describe('story skeleton layout selection', () => {
  it('強い導入は4コマなら上段ワイドを選ぶ', () => {
    expect(selectStoryPurposeLayout(page('A wide city is revealed.', ['establish', 'action', 'reaction', 'transition']), 0, 3)).toBe('wide_top_4');
  });

  it('決着の4コマは下段の焦点コマを選ぶ', () => {
    expect(selectStoryPurposeLayout(page('The decisive payoff lands.', ['action', 'reaction', 'action', 'impact']), 2, 3)).toBe('wide_bottom_4');
  });

  it('同じグリッドを連続で選んでも拒否しない', () => {
    const quietPage = page('A quiet exchange continues.', ['establish', 'action', 'reaction', 'transition']);
    expect(selectStoryPurposeLayout(quietPage, 1, 4)).toBe(selectStoryPurposeLayout(quietPage, 2, 4));
  });
});

function page(
  purpose: string,
  roles: Array<'establish' | 'action' | 'reaction' | 'transition' | 'impact'>,
) {
  return {
    purpose,
    panels: roles.map((panelRole, index) => ({
      order: index + 1,
      panelRole,
      suggestedSize: 'standard' as const,
      situationHint: '',
      suggestedEntities: [],
      suggestedDialogueHint: null,
    })),
  };
}
