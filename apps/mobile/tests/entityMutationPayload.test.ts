import { describe, expect, it } from 'vitest';

import {
  buildCreateEntityPayload,
  buildUpdateEntityPayload,
  type EntityVisibleDraft,
} from '@/domain/entityMutationPayload';

const baseDraft: EntityVisibleDraft = {
  entityType: 'character',
  freeDescription: null,
  name: '蓮',
  promptSupplement: null,
  structuredFields: {},
};

describe('entity mutation payload', () => {
  it('名前と種別だけでバックエンドが受理できる作成payloadを作る', () => {
    expect(buildCreateEntityPayload(baseDraft)).toEqual({
      entity_type: 'character',
      free_description: null,
      name: '蓮',
      prompt_supplement: null,
      speech_profile: {},
      structured_fields: {},
    });
  });

  it('名前だけの更新では未変更の構造化項目と話し方を再送しない', () => {
    expect(
      buildUpdateEntityPayload(
        {
          entity_type: 'character',
          free_description: null,
          name: '蓮',
          prompt_supplement: null,
          speech_profile: { tone: 'quiet' },
          structured_fields: { legacy_field: 'preserve on server' },
          updated_at: '2026-07-29T00:00:00.000Z',
        },
        {
          ...baseDraft,
          name: '春香',
          structuredFields: {},
        },
        { structuredFieldsChanged: false },
      ),
    ).toEqual({
      expected_updated_at: '2026-07-29T00:00:00.000Z',
      name: '春香',
    });
  });

  it('非表示のコンパイル情報だけが違う場合は構造化項目を再送しない', () => {
    expect(
      buildUpdateEntityPayload(
        {
          entity_type: 'character',
          free_description: null,
          name: '蓮',
          prompt_supplement: null,
          structured_fields: {
            style_reference: {
              title: '標準',
              compiler_model: 'server-model',
            },
          },
          updated_at: '2026-07-29T00:00:00.000Z',
        },
        {
          ...baseDraft,
          name: '蓮 改',
          structuredFields: {
            style_reference: {
              title: '標準',
            },
          },
        },
        { structuredFieldsChanged: false },
      ),
    ).toEqual({
      expected_updated_at: '2026-07-29T00:00:00.000Z',
      name: '蓮 改',
    });
  });

  it('表示中の構造化項目を変更した場合だけstructured_fieldsを送る', () => {
    expect(
      buildUpdateEntityPayload(
        {
          entity_type: 'character',
          free_description: null,
          name: '蓮',
          prompt_supplement: null,
          speech_profile: { tone: 'quiet' },
          structured_fields: {},
          updated_at: '2026-07-29T00:00:00.000Z',
        },
        {
          ...baseDraft,
          structuredFields: { age_range: '高校生' },
        },
      ),
    ).toEqual({
      expected_updated_at: '2026-07-29T00:00:00.000Z',
      structured_fields: { age_range: '高校生' },
    });
  });
});
