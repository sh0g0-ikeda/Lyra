import { describe, expect, it } from 'vitest';
import {
  pageSchema,
  pagesResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validPage = {
  id: 'page-1',
  episode_id: 'episode-1',
  page_number: 1,
  layout_config: { type: 'template', template_id: 'standard_4' },
  story_source_scene_ids: [],
  story_page_purpose: null,
  story_continuity_note: null,
  dialogue_mode: 'mixed',
  page_dialogue_toggle: true,
  generation_mode: null,
  generated_image: null,
  status: 'designing',
  panel_count: 0,
  frame_count: 0,
  balloon_count: 0,
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

describe('Page summary response contract', () => {
  it('空scene・null画像と署名URL省略またはnullの生成画像を受理する', () => {
    expect(pageSchema.safeParse(validPage).success).toBe(true);
    expect(
      pagesResponseSchema.safeParse({
        pages: [
          {
            ...validPage,
            generation_mode: 'thinking',
            generated_image: {
              generation_mode: 'thinking',
              generated_at: null,
            },
            status: 'generated',
          },
          {
            ...validPage,
            id: 'page-2',
            generated_image: {
              cdn_url: null,
              generation_mode: 'standard',
              generated_at: '2026-07-30T00:00:00.000Z',
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('内部S3 key・未知enum・不正なpage番号と負数countを拒否する', () => {
    expect(
      pageSchema.safeParse({
        ...validPage,
        generated_image: {
          s3_key: 'saved/private.png',
          generation_mode: 'standard',
          generated_at: '2026-07-30T00:00:00.000Z',
        },
      }).success,
    ).toBe(false);
    expect(pageSchema.safeParse({ ...validPage, status: 'failed' }).success).toBe(false);
    expect(pageSchema.safeParse({ ...validPage, dialogue_mode: 'legacy' }).success).toBe(false);
    expect(pageSchema.safeParse({ ...validPage, generation_mode: 'turbo' }).success).toBe(false);
    expect(pageSchema.safeParse({ ...validPage, page_number: 0 }).success).toBe(false);
    expect(pageSchema.safeParse({ ...validPage, panel_count: -1 }).success).toBe(false);
  });
});
