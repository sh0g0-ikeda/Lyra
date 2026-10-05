import { describe, expect, test } from 'vitest';
import { reconcileSavedStoryDraft } from '../../../apps/web/src/domain/storyDraftSave';
const baseline = { title: 'Old title', story: 'Old story', entities_involved: 'entity-1' };
const submitted = { ...baseline, title: 'New title', story: 'New story' };
const saved = { ...submitted, title: 'Normalized title', entities_involved: 'entity-1, entity-2' };
describe('話の保存応答と未保存入力の整合性', () => {
  test('全fieldの保存成功後に追加編集がない場合は正規化済み応答を採用する', () => {
    expect(reconcileSavedStoryDraft(submitted, submitted, saved, baseline, true)).toEqual({ draft: saved, baseline: saved });
  });
  test('全fieldの保存を待つ間に本文が変わった場合は追加入力を保持する', () => {
    const current = { ...submitted, story: 'Typed after save started' };
    expect(reconcileSavedStoryDraft(current, submitted, saved, baseline, true)).toEqual({ draft: current, baseline: saved });
  });
  test('部分保存で送らない人物指定がdirtyの場合はlocal指定を保持し保存baselineは応答を採用する', () => {
    const local = { ...submitted, entities_involved: 'entity-3' };
    expect(reconcileSavedStoryDraft(local, local, saved, baseline, false)).toEqual({ draft: { ...saved, entities_involved: 'entity-3' }, baseline: saved });
  });
  test('部分保存で人物指定がcleanの場合は他sessionの保存済み人物指定を採用する', () => {
    expect(reconcileSavedStoryDraft(submitted, submitted, saved, baseline, false)).toEqual({ draft: saved, baseline: saved });
  });
  test('部分保存待機中に本文だけ変わった場合は本文とserverの人物更新を共に保持する', () => {
    const current = { ...submitted, story: 'Later story' };
    expect(reconcileSavedStoryDraft(current, submitted, saved, baseline, false)).toEqual({ draft: { ...current, entities_involved: saved.entities_involved }, baseline: saved });
  });
  test('部分保存待機中に人物指定を変更した場合は後続のlocal指定を保持する', () => {
    const current = { ...submitted, entities_involved: 'entity-4' };
    expect(reconcileSavedStoryDraft(current, submitted, saved, baseline, false)).toEqual({ draft: current, baseline: saved });
  });
  test('部分保存で人物指定を空にした場合も未保存の空指定を保持する', () => {
    const current = { ...submitted, entities_involved: '' };
    expect(reconcileSavedStoryDraft(current, current, saved, baseline, false)).toEqual({ draft: { ...saved, entities_involved: '' }, baseline: saved });
  });
  test('応答を整合させる場合に元の入力と保存baselineを変更しない', () => {
    const values = [baseline, submitted, saved].map((value) => Object.freeze({ ...value }));
    const before = JSON.stringify(values);
    reconcileSavedStoryDraft(values[1], values[1], values[2], values[0], false);
    expect(JSON.stringify(values)).toBe(before);
  });
});
