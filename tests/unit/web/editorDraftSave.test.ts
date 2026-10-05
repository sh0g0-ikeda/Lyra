import { describe, expect, test } from 'vitest';
import { isOlderEditorRevision, reconcileSavedEditorDraft } from '../../../apps/web/src/domain/editorDraftSave.js';

/*
 * Design 05 / Unified Spec editable-field protection:
 * a save response becomes the authoritative baseline, while input typed after
 * submission and dirty fields omitted by a partial save remain local drafts.
 */
type EditorDraft = {
  situation: string;
  dialogue: Array<{ text: string; speakerId: string }>;
  frameIds: string[];
  style: { ink: string; density: number };
};

const baseline: EditorDraft = {
  situation: 'Arrival',
  dialogue: [{ text: 'Wait.', speakerId: 'entity-1' }],
  frameIds: ['frame-1'],
  style: { ink: 'soft', density: 2 },
};
const submitted: EditorDraft = {
  ...baseline,
  situation: 'Arrival at dusk',
  dialogue: [{ text: 'We are late.', speakerId: 'entity-1' }],
};
const authoritative: EditorDraft = {
  ...submitted,
  situation: 'Arrival at dusk.',
  dialogue: [{ text: 'We are late.', speakerId: 'entity-1' }],
  frameIds: ['frame-2'],
  style: { ink: 'hard', density: 3 },
};

describe('ページ編集保存応答と未保存入力の整合性', () => {
  test('保存待機中の追加入力がある場合はdraft全体を保持しbaselineだけ応答にする', () => {
    const current = { ...submitted, situation: 'Typed after save started', frameIds: ['frame-3'] };

    expect(reconcileSavedEditorDraft(current, submitted, authoritative, baseline)).toEqual({
      draft: current,
      baseline: authoritative,
    });
  });

  test('全field保存がcleanなら正規化済み応答をdraftとbaselineに採用する', () => {
    expect(reconcileSavedEditorDraft(submitted, submitted, authoritative, baseline)).toEqual({
      draft: authoritative,
      baseline: authoritative,
    });
  });

  test('部分保存で送らない配列membershipがdirtyならsubmitted値を保持する', () => {
    const local = { ...submitted, frameIds: ['frame-3', 'frame-4'] };

    expect(reconcileSavedEditorDraft(local, local, authoritative, baseline, ['frameIds'])).toEqual({
      draft: { ...authoritative, frameIds: local.frameIds },
      baseline: authoritative,
    });
  });

  test('部分保存で送らないfieldがcleanならremoteの正規化値を採用する', () => {
    expect(reconcileSavedEditorDraft(submitted, submitted, authoritative, baseline, ['frameIds', 'style'])).toEqual({
      draft: authoritative,
      baseline: authoritative,
    });
  });

  test('複数の省略dirty fieldを同時に保持する', () => {
    const local = {
      ...submitted,
      frameIds: ['frame-5'],
      style: { ink: 'brush', density: 4 },
    };

    expect(reconcileSavedEditorDraft(local, local, authoritative, baseline, ['frameIds', 'style'])).toEqual({
      draft: { ...authoritative, frameIds: local.frameIds, style: local.style },
      baseline: authoritative,
    });
  });

  test('省略dirty fieldと保存後の追加編集が両方ある場合はcurrent全体を保持する', () => {
    const current = { ...submitted, situation: 'Later edit', frameIds: ['frame-5'] };

    expect(reconcileSavedEditorDraft(current, submitted, authoritative, baseline, ['frameIds'])).toEqual({
      draft: current,
      baseline: authoritative,
    });
  });

  test('入力値を変更せず同じ結果を繰り返し返す', () => {
    const values = [baseline, submitted, authoritative].map((value) => Object.freeze(structuredClone(value)));
    const before = JSON.stringify(values);

    const first = reconcileSavedEditorDraft(values[1], values[1], values[2], values[0], ['frameIds']);
    const second = reconcileSavedEditorDraft(values[1], values[1], values[2], values[0], ['frameIds']);

    expect(first).toEqual(second);
    expect(JSON.stringify(values)).toBe(before);
  });
});

describe('編集resource revisionの順序', () => {
  test('有効な古いrevisionだけを古いと判定する', () => {
    expect(isOlderEditorRevision('2026-10-05T00:00:00.000Z', '2026-10-05T00:00:01.000Z')).toBe(true);
    expect(isOlderEditorRevision('2026-10-05T00:00:01.000Z', '2026-10-05T00:00:01.000Z')).toBe(false);
    expect(isOlderEditorRevision('2026-10-05T00:00:02.000Z', '2026-10-05T00:00:01.000Z')).toBe(false);
  });

  test('invalid revisionは古いと誤判定しない', () => {
    expect(isOlderEditorRevision('not-a-date', '2026-10-05T00:00:01.000Z')).toBe(false);
    expect(isOlderEditorRevision('2026-10-05T00:00:00.000Z', 'not-a-date')).toBe(false);
  });
});

test('配列draftの全保存でも配列型と権威応答の値を保持する', () => {
  const previous = [{id: 'frame-1', x: 0}];
  const submitted = [{id: 'frame-1', x: 0.25}];
  const saved = [{id: 'frame-1', x: 0.3}];
  const result = reconcileSavedEditorDraft(submitted, submitted, saved, previous);
  expect(Array.isArray(result.draft)).toBe(true);
  expect(result).toEqual({draft: saved, baseline: saved});
});
