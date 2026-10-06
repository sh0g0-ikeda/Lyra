import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresPageRepository } from '../../../src/repositories/PageRepository.js';
import { fingerprintEpisodePlanningContext } from '../../../src/services/page/EpisodePlanContinuity.js';
import { computeStateReferenceFingerprint } from '../../../src/domain/state/StateReferenceFingerprint.js';

const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const STATE_ID = '22222222-2222-4222-8222-222222222222';
const BASE_REF_ID = 'base-ref-1';

class EpisodeStateContextClient implements DatabaseClient {
  public readonly queries: string[] = [];
  public startingStateId: string | null = STATE_ID;
  public baseRefId = BASE_REF_ID;

  public async query<T extends QueryResultRow = QueryResultRow>(
    queryText: string,
    _values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(queryText);
    const rows = queryText.includes('SELECT episodes.id AS episode_id')
      ? [{
          episode_id: '33333333-3333-4333-8333-333333333333',
          work_id: '44444444-4444-4444-8444-444444444444',
          chapter_id: '55555555-5555-4555-8555-555555555555',
          chapter_title: null,
          chapter_purpose: null,
          chapter_starting_state: null,
          chapter_ending_state: null,
          chapter_emotion_curve: null,
          chapter_key_beats: [],
          episode_title: null,
          episode_purpose: null,
          story_full_draft: '序盤で負傷する。',
          introduction: null,
          middle: null,
          climax: null,
          ending_hook: null,
          estimated_pages: 1,
          starting_entity_states: [{ entity_id: ENTITY_ID, state_id: this.startingStateId }],
          state_library: [{
            state_id: STATE_ID,
            entity_id: ENTITY_ID,
            name: '負傷',
            description: '腕に包帯',
            revision: '2026-09-30T00:00:00.000Z',
            base_ref_id: this.baseRefId,
            base_ref_updated_at: '2026-09-30T00:00:00.000Z',
            base_image_present: true,
            reference_image: {
              ref_id: 'state-ref-1',
              s3_key: 'reference/test/state.png',
              storage_owner_user_id: '66666666-6666-4666-8666-666666666666',
              image_model: 'gpt-image-2',
              base_ref_id: BASE_REF_ID,
              created_at: '2026-09-30T00:00:00.000Z',
              input_fingerprint: computeStateReferenceFingerprint({
                entityId: ENTITY_ID,
                stateId: STATE_ID,
                name: '負傷',
                description: '腕に包帯',
                baseRefId: BASE_REF_ID,
              }),
            },
          }],
          scenes: [],
          entities: [],
        }]
      : [];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as unknown as T[],
    };
  }
}

describe('PostgresPageRepository episode state context', () => {
  it('保存した開始状態と全文草稿を全話planへ渡し変更時にfingerprintが変わる', async () => {
    const client = new EpisodeStateContextClient();
    const repository = new PostgresPageRepository(client);
    const before = await repository.findEpisodePlanningContextByIdAndUserId(
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
    );
    expect(before).not.toBeNull();
    expect(before?.episode).toMatchObject({
      storyFullDraft: '序盤で負傷する。',
      startingEntityStates: [{ entityId: ENTITY_ID, stateId: STATE_ID }],
    });
    expect(client.queries[0]).toContain('episodes.starting_entity_states');
    expect(client.queries[0]).toContain('episodes.story_full_draft');
    expect(before?.stateLibrary).toMatchObject([{ stateId: STATE_ID, referenceReady: true }]);

    client.startingStateId = null;
    const after = await repository.findEpisodePlanningContextByIdAndUserId(
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
    );
    expect(after).not.toBeNull();
    expect(fingerprintEpisodePlanningContext(before!)).not.toBe(fingerprintEpisodePlanningContext(after!));

    client.baseRefId = 'new-base-ref';
    const stale = await repository.findEpisodePlanningContextByIdAndUserId(
      '33333333-3333-4333-8333-333333333333',
      '66666666-6666-4666-8666-666666666666',
    );
    expect(stale?.stateLibrary).toMatchObject([{ stateId: STATE_ID, referenceReady: false }]);
    expect(fingerprintEpisodePlanningContext(before!)).not.toBe(fingerprintEpisodePlanningContext(stale!));
  });
});
