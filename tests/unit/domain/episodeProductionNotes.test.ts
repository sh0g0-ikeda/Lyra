import { describe, expect, it } from 'vitest';
import { assertProductionPanelConstraints, readEpisodeProductionNotes, splitEpisodeProductionNotes } from '../../../src/domain/episodeProductionNotes.js';

describe('splitEpisodeProductionNotes', () => {
  it('作者が同じコマを指定した出来事が別のままなら保存前の判定で拒否する', () => {
    const directive = { kind: 'same_panel', first: '扉を押す', second: '息をのむ' } as const;
    expect(() => assertProductionPanelConstraints([{ text: ['扉を押す。'] }, { text: ['息をのむ。'] }], [directive])).toThrow();
    expect(() => assertProductionPanelConstraints([{ text: ['扉を押す。息をのむ。'] }], [directive])).not.toThrow();
  });
  it('同じコマ、別コマ、状態開始と終了を本文中の固有の引用に結び付ける', () => {
    const raw = '扉を押す。隙間をのぞく。翼が光る。ミオが息をのむ。光が消える。\n'
      + '# 「扉を押す」と「隙間をのぞく」は同じコマにする。\n'
      + '# 「翼が光る」と「ミオが息をのむ」は別のコマにする。\n'
      + '# 「翼が光る」のコマから「ルカ」は「覚醒」状態。\n'
      + '# 「光が消える」のコマで「ルカ」は通常に戻る。';
    const result = readEpisodeProductionNotes({ storyFullDraft: raw });
    expect(result.directives).toEqual([
      { kind: 'same_panel', first: '扉を押す', second: '隙間をのぞく' },
      { kind: 'separate_panels', first: '翼が光る', second: 'ミオが息をのむ' },
      { kind: 'state', at: '翼が光る', name: 'ルカ', state: '覚醒' },
      { kind: 'state', at: '光が消える', name: 'ルカ', state: null },
    ]);
    expect(result.prose.storyFullDraft).not.toContain('#');
  });

  it('本文内に対象がない場合と一意に絞れない場合に指示を推測しない', () => {
    expect(() => readEpisodeProductionNotes({
      storyFullDraft: '翼が光る。翼が光る。\n# 「翼が光る」と「倒れる」は別コマ',
    })).toThrow('ambiguous');
  });
  it('有効な演出指示だけを本文から分けて元の位置を保持する', () => {
    const input = 'ミオが扉を押す。ルカがのぞく。\r\n  ＃ 同じコマ\r\n#見出し\r\n「#ライブ」';
    const result = splitEpisodeProductionNotes(input, true);
    expect(result.body).toBe('ミオが扉を押す。ルカがのぞく。\r\n#見出し\r\n「#ライブ」');
    expect(result.notes).toHaveLength(1);
    const [note] = result.notes;
    expect(note?.text).toBe('同じコマ');
    expect(input.slice(note?.start, note?.end)).toBe('  ＃ 同じコマ');
  });

  it('旧原稿を指定した場合に行頭のハッシュ記号を本文として保つ', () => {
    const input = '# 序章\nミオが歩く。';
    expect(splitEpisodeProductionNotes(input, false)).toEqual({ body: input, notes: [] });
  });

  it('作者がエスケープした指示行を本文として保つ', () => {
    expect(splitEpisodeProductionNotes('\\# 章題\n# 演出', true)).toMatchObject({
      body: '# 章題\n',
      notes: [{ text: '演出' }],
    });
  });
});
