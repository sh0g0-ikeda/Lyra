import { describe, expect, it } from 'vitest';
import { pageGenerationReadinessSchema } from '@/domain/apiSchemas';
import { ApiError } from '@/lib/api';
import { errorRecoveryTarget, pageGenerationBlockerRecoveryTarget } from '@/lib/errorRecovery';
import { t } from '@/lib/i18n';

const readiness = {
  ready: false,
  blockers: [{ code: 'CHARACTER_REFERENCE_MODEL_INCOMPATIBLE', entity_id: 'entity-1', field: 'entities', action: 'open_characters', message_key: 'page.blocker.characterReferenceModelIncompatible' }],
  warnings: [], estimated_credit_cost: 3, page_revision: '2026-10-03T00:00:00.000Z'
};
describe('自由生成キャラ参照のMobile生成条件', () => {
  it('Hy4確定参照のblockerをAPI契約で受理してキャラ修正へ戻れる', () => {
    expect(pageGenerationReadinessSchema.safeParse(readiness).success).toBe(true);
    expect(pageGenerationBlockerRecoveryTarget('CHARACTER_REFERENCE_MODEL_INCOMPATIBLE')).toBe('characters');
  });
  it('課金前の拒否を無条件再試行にせずキャラ確認へ案内する', () => {
    expect(errorRecoveryTarget(new ApiError('provider details hidden', 409, 'PAGE_REFERENCE_MODEL_INCOMPATIBLE'))).toBe('characters');
  });
  it('通常プレビューの再確定を案内し未知blockerは許可しない', () => {
    expect(t('ja', 'screen.pages.blocker.characterReferenceModelIncompatible')).toContain('通常生成したプレビューを確定');
    expect(t('en', 'screen.pages.blocker.characterReferenceModelIncompatible')).toContain('confirm a standard preview');
    expect(pageGenerationReadinessSchema.safeParse({ ...readiness, blockers: [{ ...readiness.blockers[0], code: 'UNKNOWN_MODEL_BLOCKER' }] }).success).toBe(false);
  });
});
