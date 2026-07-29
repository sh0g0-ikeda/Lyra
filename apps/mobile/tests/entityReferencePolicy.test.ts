import { describe, expect, it } from 'vitest';

import {
  buildEntityReferenceGenerationBlockers,
  buildSingleCandidateConfirmation,
  selectSingleReferenceCandidate
} from '@/domain/entityReferencePolicy';

describe('entity reference policy', () => {
  it('generated previewがあればimport候補より優先し常に1枚だけ返す', () => {
    const selected = selectSingleReferenceCandidate({
      generatedCandidates: [
        { candidate_token: 'generated-1', source: 'generated' },
        { candidate_token: 'generated-2', source: 'generated' }
      ],
      importedCandidate: { candidate_token: 'imported-1', source: 'import' }
    });

    expect(selected).toEqual({ candidate_token: 'generated-1', source: 'generated' });
  });

  it('generated previewがなければ現在のimport候補1枚を返す', () => {
    expect(
      selectSingleReferenceCandidate({
        generatedCandidates: [],
        importedCandidate: { candidate_token: 'imported-1', source: 'import' }
      })
    ).toEqual({ candidate_token: 'imported-1', source: 'import' });
  });

  it('candidate tokenを1件のselectedと同じprimaryへ入れる', () => {
    expect(buildSingleCandidateConfirmation('candidate-1')).toEqual({
      selected_candidate_tokens: ['candidate-1'],
      primary_candidate_token: 'candidate-1'
    });
    expect(buildSingleCandidateConfirmation('  ')).toBeNull();
  });

  it('生成に不足する条件を個別のblockerとして返す', () => {
    expect(
      buildEntityReferenceGenerationBlockers({
        availableCredits: 0,
        canGenerate: false,
        entityType: 'character',
        featureEnabled: false,
        hasActiveJob: true,
        importPending: true,
        name: '',
        selectedEntityId: null
      }).map((blocker) => blocker.code)
    ).toEqual([
      'PERMISSION_REQUIRED',
      'FEATURE_DISABLED',
      'ENTITY_SAVE_REQUIRED',
      'NAME_REQUIRED',
      'IMPORT_IN_PROGRESS',
      'ACTIVE_PREVIEW_JOB',
      'INSUFFICIENT_CREDITS'
    ]);
  });

  it('残高が未取得の場合は不足と断定しない', () => {
    expect(
      buildEntityReferenceGenerationBlockers({
        availableCredits: null,
        canGenerate: true,
        entityType: 'character',
        featureEnabled: true,
        hasActiveJob: false,
        importPending: false,
        name: '蓮',
        selectedEntityId: 'entity-1'
      })
    ).toEqual([]);
  });
  it('利用可否が未取得でもサーバー無効とは判定しない', () => {
    expect(
      buildEntityReferenceGenerationBlockers({
        availableCredits: null,
        canGenerate: true,
        entityType: 'character',
        featureEnabled: null,
        hasActiveJob: false,
        importPending: false,
        name: '蓮',
        selectedEntityId: 'entity-1'
      })
    ).toEqual([]);
  });
});
