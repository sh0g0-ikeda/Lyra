import { describe, expect, it } from 'vitest';
import {
  buildFencedStateReferenceKey,
  ensureOwnedFencedStateReferenceKey,
  isReservedFencedStateReferenceNamespace,
} from '../../../../src/domain/state/FencedStateReferenceKey.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const attemptToken = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const input = { ownerUserId, entityId, attemptToken, mimeType: 'image/png' as const };

describe('FencedStateReferenceKey', () => {
  it('同じ試行は同じkeyで復旧し、別試行は別keyになり生の所有者IDを含めない', () => {
    const key = buildFencedStateReferenceKey(input);
    expect(buildFencedStateReferenceKey(input)).toBe(key);
    expect(buildFencedStateReferenceKey({ ...input, attemptToken: other })).not.toBe(key);
    expect(key).not.toContain(ownerUserId);
    expect(key).not.toContain(entityId);
    expect(() => ensureOwnedFencedStateReferenceKey(key, ownerUserId, entityId)).not.toThrow();
  });

  it('同じkeyを別所有者や別entityへ流用できない', () => {
    const key = buildFencedStateReferenceKey(input);
    expect(() => ensureOwnedFencedStateReferenceKey(key, other, entityId)).toThrow(/owner scope/);
    expect(() => ensureOwnedFencedStateReferenceKey(key, ownerUserId, other)).toThrow(/owner scope/);
  });

  it.each(['image/png', 'image/jpeg', 'image/webp'] as const)('対応MIME %s は正確なscopeに限って復元する', (mimeType) => {
    const key = buildFencedStateReferenceKey({ ...input, mimeType });
    expect(() => ensureOwnedFencedStateReferenceKey(key, ownerUserId, entityId)).not.toThrow();
    const wrongExtension = key.endsWith('.webp') ? key.replace(/webp$/u, 'png') : key.replace(/\.[^.]+$/u, '.webp');
    expect(() => ensureOwnedFencedStateReferenceKey(wrongExtension, ownerUserId, entityId)).toThrow();
  });

  it.each([
    (key: string) => key.replace(attemptToken, other),
    (key: string) => `${key}/other.png`,
    (key: string) => key.replace('state-reference-v2/', 'saved/'),
    (key: string) => key.replace('/33333333-', '/ABC33333-'),
    (key: string) => key.replace('.png', '.jpg'),
    (key: string) => key.replace('state-reference-v2/', 'state-reference-v2/../'),
  ])('token・形式・階層の書換えを拒否する', (mutate) => {
    expect(() => ensureOwnedFencedStateReferenceKey(mutate(buildFencedStateReferenceKey(input)), ownerUserId, entityId)).toThrow();
  });

  it('不正なIDをkeyに埋め込まず、予約prefixの不正なkeyも汎用削除対象から分離できる', () => {
    expect(() => buildFencedStateReferenceKey({ ...input, entityId: '../other' })).toThrow();
    expect(isReservedFencedStateReferenceNamespace('state-reference-v2/malformed')).toBe(true);
    expect(isReservedFencedStateReferenceNamespace(`saved/${ownerUserId}/entities/${entityId}/ref.png`)).toBe(false);
  });
});
