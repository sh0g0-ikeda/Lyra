import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../../src/domain/types/entity.js';
import { findIncompatibleAssignedCharacterPrimaryIds } from '../../../../src/services/page/PageCharacterPrimaryReferencePolicy.js';

const entity = (id: string, entityType: Entity['entityType']): Entity => ({
  id, workId: 'work-1', userId: 'user-1', entityType, name: id,
  freeDescription: null, promptSupplement: null, structuredFields: {}, speechProfile: {},
  status: 'ready', createdAt: new Date(0), updatedAt: new Date(0),
});

describe('assigned character active primary provider境界', () => {
  it('割当characterのHy4 primaryだけを不整合として返す', () => {
    const result = findIncompatibleAssignedCharacterPrimaryIds(
      new Set(['assigned-character', 'assigned-object']),
      [
        entity('assigned-character', 'character'),
        entity('unassigned-character', 'character'),
        entity('assigned-object', 'object'),
      ],
      [
        { entityId: 'assigned-character', refId: 'a', s3Key: 'a.png', cdnUrl: 'https://example.invalid/a.png', imageModel: 'hy4-preview' },
        { entityId: 'unassigned-character', refId: 'b', s3Key: 'b.png', cdnUrl: 'https://example.invalid/b.png', imageModel: 'hy4-preview' },
        { entityId: 'assigned-object', refId: 'c', s3Key: 'c.png', cdnUrl: 'https://example.invalid/c.png', imageModel: 'hy4-preview' },
      ],
    );
    expect(result).toEqual(['assigned-character']);
  });

  it('GPT primaryへの再confirm後は不整合を返さない', () => {
    expect(findIncompatibleAssignedCharacterPrimaryIds(
      new Set(['character']),
      [entity('character', 'character')],
      [{ entityId: 'character', refId: 'gpt', s3Key: 'gpt.png', cdnUrl: 'https://example.invalid/gpt.png',
        imageModel: 'gpt-image-2', providerModelId: 'gpt-image-2', provider: 'openai' }],
    )).toEqual([]);
  });
});
