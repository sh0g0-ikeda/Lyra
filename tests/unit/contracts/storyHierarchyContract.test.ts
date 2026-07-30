import { describe, expect, it } from 'vitest';
import {
  chapterSchema,
  chaptersResponseSchema,
  episodeSchema,
  episodesResponseSchema,
  workSchema,
  worksResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const timestamp = '2026-07-30T00:00:00.000Z';

const validWork = {
  id: 'work-1',
  organization_id: null,
  title: '作品',
  genre: null,
  world_setting: null,
  theme: null,
  main_entity_ids: [],
  starting_point: null,
  ending_point: null,
  overall_flow: null,
  version: 1,
  status: 'draft',
  created_at: timestamp,
  updated_at: timestamp,
};

const validChapter = {
  id: 'chapter-1',
  work_id: 'work-1',
  order: 1,
  title: null,
  purpose: null,
  starting_state: null,
  ending_state: null,
  emotion_curve: null,
  entities_involved: [],
  key_beats: [],
  version: 1,
  status: 'draft',
  created_at: timestamp,
  updated_at: timestamp,
};

const validEpisode = {
  id: 'episode-1',
  chapter_id: 'chapter-1',
  order: 1,
  title: null,
  purpose: null,
  story_input_mode: 'structured',
  story_full_draft: null,
  introduction: null,
  middle: null,
  climax: null,
  ending_hook: null,
  estimated_pages: 16,
  entities_involved: [],
  page_skeleton_generated: false,
  version: 1,
  status: 'draft',
  created_at: timestamp,
  updated_at: timestamp,
};

describe('Story hierarchy response contract', () => {
  it('現行Work・Chapter・Episodeと空一覧wrapperを受理する', () => {
    expect(workSchema.safeParse(validWork).success).toBe(true);
    expect(chapterSchema.safeParse(validChapter).success).toBe(true);
    expect(episodeSchema.safeParse(validEpisode).success).toBe(true);
    expect(worksResponseSchema.safeParse({ works: [] }).success).toBe(true);
    expect(chaptersResponseSchema.safeParse({ chapters: [] }).success).toBe(true);
    expect(episodesResponseSchema.safeParse({ episodes: [] }).success).toBe(true);
  });

  it('負のversion・非正order・非正estimated_pages・未知statusを拒否する', () => {
    expect(workSchema.safeParse({ ...validWork, version: -1 }).success).toBe(false);
    expect(chapterSchema.safeParse({ ...validChapter, order: 0 }).success).toBe(false);
    expect(episodeSchema.safeParse({ ...validEpisode, estimated_pages: 0 }).success).toBe(false);
    expect(episodeSchema.safeParse({ ...validEpisode, status: 'published' }).success).toBe(false);
  });
});
