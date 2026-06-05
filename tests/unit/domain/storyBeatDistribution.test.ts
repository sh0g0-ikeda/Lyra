import { describe, expect, it } from 'vitest';
import { distributeStoryBeats } from '../../../src/domain/storyBeatDistribution.js';

describe('distributeStoryBeats', () => {
  it('段落と文をページ単位の beat に分配する', () => {
    const beats = distributeStoryBeats(
      [
        [
          '澪は宿舎の窓から中庭を見る。',
          '',
          '訓練する隊員たちの動きが目に入る。',
          '',
          '工房と医療班も朝から動いている。',
          '',
          'エロイーズが澪を迎えに来る。',
        ].join('\n'),
      ],
      4,
      80,
    );

    expect(beats).toHaveLength(4);
    expect(new Set(beats).size).toBe(4);
    expect(beats[0]).toContain('宿舎');
    expect(beats[1]).toContain('訓練');
    expect(beats[2]).toContain('工房');
    expect(beats[3]).toContain('エロイーズ');
  });

  it('長い beat を省略しても文字化けした省略記号を出さない', () => {
    const beats = distributeStoryBeats(
      [
        '澪は神木の中で、自分が元の生活から少しずつ離れていく感覚を抱えながら、まだ説明されていない制度や人間関係を観察する。',
      ],
      1,
      36,
    );

    expect(beats[0]).toContain('...');
    expect(beats[0]).not.toContain('\u7ab6');
  });
});
