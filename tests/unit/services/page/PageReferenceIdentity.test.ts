import { describe, expect, it } from 'vitest';
import type { EntityResolvedReferenceImage } from '../../../../src/repositories/EntityRepository.js';
import { collectPageReferenceImages, pageReferenceImageKey } from '../../../../src/services/page/PageReferenceIdentity.js';

function buildReference(overrides: Partial<EntityResolvedReferenceImage> = {}): EntityResolvedReferenceImage {
  return {
    entityId: 'entity-1', stateId: null, stateName: null, stateDescription: null,
    stateExists: true, ownerUserId: 'user-1', refId: 'base-ref',
    s3Key: 'saved/user-1/entities/entity-1/base-ref.png', cdnUrl: null, imageModel: null,
    ...overrides,
  };
}

describe('PageReferenceIdentity', () => {
  it('旧状態を最初に参照してもbaseへ正規化して全割当を保持する', () => {
    const legacy = buildReference({ stateId: 'legacy-state', stateName: 'legacy note' });
    const base = buildReference();
    const result = collectPageReferenceImages([legacy, base], [base, legacy]);

    expect(result).toHaveLength(1);
    expect(result[0]?.reference).toEqual(base);
    expect(result[0]?.assignments).toEqual([legacy, base]);
    expect(legacy.stateId).toBe('legacy-state');
  });

  it('同じrefIdでも実際の保存画像が違う場合は別参照として保持する', () => {
    const base = buildReference();
    const other = buildReference({ stateId: 'legacy-other', s3Key: 'saved/user-1/entities/entity-1/other.png' });
    expect(collectPageReferenceImages([base, other], [base, other])).toHaveLength(2);
    expect(pageReferenceImageKey(base)).not.toBe(pageReferenceImageKey(other));
  });

  it('同じ画像を共有しても確定variantの状態identityは統合しない', () => {
    const first = buildReference({ stateId: 'variant-1', stateName: 'first', stateDescription: 'confirmed first' });
    const second = buildReference({ stateId: 'variant-2', stateName: 'second', stateDescription: 'confirmed second' });
    const result = collectPageReferenceImages([first, second], [second, first]);

    expect(result.map((image) => image.reference.stateId)).toEqual(['variant-1', 'variant-2']);
  });

  it('異なる人物のidentityと未解決参照を混同しない', () => {
    const first = buildReference();
    const second = buildReference({ entityId: 'entity-2' });
    const unresolved = buildReference({ stateId: 'variant-1', refId: null, s3Key: null });
    expect(collectPageReferenceImages([first, second, unresolved], [first, second, unresolved])).toHaveLength(2);
  });
});
