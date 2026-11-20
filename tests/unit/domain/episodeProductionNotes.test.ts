import { describe, expect, it } from 'vitest';
import { assertProductionPanelConstraints, readEpisodeProductionNotes } from '../../../src/domain/episodeProductionNotes.js';

describe('splitEpisodeProductionNotes', () => {
  it('作者が同じコマを指定した出来事が別のままなら保存前の判定で拒否する', () => {
    const directive = { kind: 'same_panel', first: '扉を押す', second: '息をのむ' } as const;
    expect(() => assertProductionPanelConstraints([{ text: ['扉を押す。'] }, { text: ['息をのむ。'] }], [directive])).toThrow();
    expect(() => assertProductionPanelConstraints([{ text: ['扉を押す。息をのむ。'] }], [directive])).not.toThrow();
  });
  it('同じコマ、別コマ、状態開始と終了を本文中の固有の引用に結び付ける', () => {
    const raw = '扉を押す。隙間をのぞく。翼が光る。ミオが息をのむ。光が消える。';
    const result = readEpisodeProductionNotes({ storyFullDraft: raw }, [
      '「扉を押す」と「隙間をのぞく」は同じコマにする。',
      '「翼が光る」と「ミオが息をのむ」は別のコマにする。',
      '「翼が光る」のコマから「ルカ」は「覚醒」状態。',
      '「光が消える」のコマで「ルカ」は通常に戻る。',
    ]);
    expect(result.directives).toEqual([
      { kind: 'same_panel', first: '扉を押す', second: '隙間をのぞく' },
      { kind: 'separate_panels', first: '翼が光る', second: 'ミオが息をのむ' },
      { kind: 'state', at: '翼が光る', name: 'ルカ', state: '覚醒' },
      { kind: 'state', at: '光が消える', name: 'ルカ', state: null },
    ]);
    expect(result.prose.storyFullDraft).toBe(raw);
  });

  it('本文内に対象がない場合と一意に絞れない場合に指示を推測しない', () => {
    expect(() => readEpisodeProductionNotes(
      { storyFullDraft: '翼が光る。翼が光る。' },
      ['「翼が光る」と「倒れる」は別コマ'],
    )).toThrow('ambiguous');
  });
  it('本文中の#見出しは明示ノートとして推測しない', () => {
    const input = 'ミオが扉を押す。\r\n# 「扉を押す」は見出しとして残る\r\n＃ これも本文';
    const result = readEpisodeProductionNotes({ storyFullDraft: input }, []);
    expect(result.prose.storyFullDraft).toBe(input);
    expect(result.directives).toEqual([]);
  });
  it('＃で囲んだ既存の状態タイミング指示を従来の状態制約へ渡す', () => {
    const result = readEpisodeProductionNotes({ storyFullDraft:
      'ルカの翼が光る。＃「翼が光る」のコマから「ルカ」は「覚醒」状態。＃' }, []);
    expect(result.directives).toEqual([{ kind: 'state', at: '翼が光る', name: 'ルカ', state: '覚醒' }]);
    expect(result.prose.storyFullDraft).toBe('ルカの翼が光る。');
  });
});
