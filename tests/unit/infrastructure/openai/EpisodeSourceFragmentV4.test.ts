import { describe, expect, it } from 'vitest';
import { prepareEpisodeSourceRequirementExtraction } from '../../../../src/services/page/EpisodeSourceRequirements.js';

const PAGE_1 = '11111111-1111-4111-8111-111111111111';
const PAGE_2 = '22222222-2222-4222-8222-222222222222';

describe('Episode source fragment protocol v4', () => {
  it('全unitで一意なfragment IDからtrusted UTF-16 spanを復元する', () => {
    const source = [
      '全頁で😀の姿を保つ。',
      '1ページ目：扉へ進む、鍵を回す。「開いた」',
      '2ページ目：灯りを確認する。',
    ].join('\n');
    const extraction = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: source,
      pages: [
        { pageId: PAGE_1, pageNumber: 1 },
        { pageId: PAGE_2, pageNumber: 2 },
      ],
    });

    expect(extraction).not.toBeNull();
    const fragments = extraction!.units.flatMap((unit) => unit.fragmentCatalog.map((fragment) => ({
      ...fragment,
      text: unit.text.slice(fragment.start, fragment.end),
    })));
    expect(fragments.length).toBeGreaterThan(extraction!.units.filter((unit) => unit.text.trim()).length);
    expect(new Set(fragments.map((fragment) => fragment.id)).size).toBe(fragments.length);
    expect(fragments.every((fragment) => /^f\d{1,4}$/u.test(fragment.id))).toBe(true);
    expect(fragments.some((fragment) => fragment.text === '全頁で😀の姿を保つ')).toBe(true);
    expect(fragments.some((fragment) => fragment.text === '開いた')).toBe(true);
    expect(extraction!.compilerBrief).toContain('"fragments"');
    expect(extraction!.compilerBrief).not.toContain('locator_catalog=');
  });
});
