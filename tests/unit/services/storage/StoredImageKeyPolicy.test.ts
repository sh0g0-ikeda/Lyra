import { describe, expect, it } from 'vitest';
import {
  ensureOwnedEntityReferenceImageKey,
  ensureOwnedPageImageKey,
} from '../../../../src/services/storage/StoredImageKeyPolicy.js';

describe('StoredImageKeyPolicy', () => {
  it('allows owned entity reference images under the saved entity prefix', () => {
    expect(() =>
      ensureOwnedEntityReferenceImageKey(
        'saved/user-1/entities/entity-1/ref-1.png',
        'user-1',
        'entity-1',
      ),
    ).not.toThrow();
  });

  it('rejects entity reference images outside the owner scope', () => {
    expect(() =>
      ensureOwnedEntityReferenceImageKey(
        'saved/user-2/entities/entity-1/ref-1.png',
        'user-1',
        'entity-1',
      ),
    ).toThrow(/outside the owner scope/);
  });

  it('allows owned session page images and exact saved final page images', () => {
    expect(() =>
      ensureOwnedPageImageKey(
        'session/user-1/pages/page-1/render.png',
        'user-1',
        'page-1',
      ),
    ).not.toThrow();
    expect(() =>
      ensureOwnedPageImageKey(
        'saved/user-1/pages/page-1_final.webp',
        'user-1',
        'page-1',
      ),
    ).not.toThrow();
  });

  it('rejects nested keys under a saved final page image name', () => {
    expect(() =>
      ensureOwnedPageImageKey(
        'saved/user-1/pages/page-1_final.png/evil.png',
        'user-1',
        'page-1',
      ),
    ).toThrow(/outside the owner scope/);
  });

  it('rejects unsafe path syntax before owner checks', () => {
    expect(() =>
      ensureOwnedPageImageKey(
        'session/user-1/pages/page-1/../render.png',
        'user-1',
        'page-1',
      ),
    ).toThrow(/invalid/);
  });
});
