import { describe, expect, it } from 'vitest';
import { createGoogleLinkMaterial, decryptGoogleLinkMaterial, encryptGoogleLinkMaterial, googleLinkHash } from '../../../../src/domain/auth/GoogleLinkProtocol.js';
const key = 'test-only-google-link-key-at-least-32-bytes';
describe('Google linking protocol material', () => {
    it('state/nonce/PKCEを別々に作りDB用に暗号化し原文を残さない', () => {
        const material = createGoogleLinkMaterial();
        expect(new Set(Object.values(material)).size).toBe(3);
        const encrypted = encryptGoogleLinkMaterial(material, key, 'challenge-1');
        expect(encrypted).not.toContain(material.verifier);
        expect(encrypted).not.toContain(material.state);
        expect(decryptGoogleLinkMaterial(encrypted, key, 'challenge-1')).toEqual(material);
        expect(googleLinkHash(material.state, key, 'state')).not.toBe(googleLinkHash(material.state, key, 'nonce'));
    });
    it('別challenge・改変ciphertext・弱いkeyを拒否する', () => {
        const material = createGoogleLinkMaterial();
        const encrypted = encryptGoogleLinkMaterial(material, key, 'challenge-1');
        expect(() => decryptGoogleLinkMaterial(encrypted, key, 'challenge-2')).toThrow();
        expect(() => decryptGoogleLinkMaterial(`${encrypted}x`, key, 'challenge-1')).toThrow();
        expect(() => encryptGoogleLinkMaterial(material, 'short', 'challenge-1')).toThrow();
    });
});
