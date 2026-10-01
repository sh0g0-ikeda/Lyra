import { describe, expect, it, vi } from 'vitest';
import { guardGooglePreSignUp } from '../../../../src/services/auth/GooglePreSignUpGuard.js';
const event = { triggerSource: 'PreSignUp_ExternalProvider', userPoolId: 'pool', userName: 'Google_sub', request: { userAttributes: { email: 'owner@example.com' } }, response: {} };
describe('Google pre-signup collision guard', () => {
    it('rejects native-email collisions before profile creation without alias transfer', async () => { const lookup = { hasNativeUserWithEmail: vi.fn(async () => true) }; await expect(guardGooglePreSignUp(structuredClone(event), lookup)).rejects.toMatchObject({ code: 'ACCOUNT_LINK_REQUIRED' }); expect(event.response).toEqual({}); });
    it('leaves non-colliding Google signup to existing Cognito policy', async () => { expect(await guardGooglePreSignUp(event, { hasNativeUserWithEmail: async () => false })).toBe(event); });
    it('does not replace unrelated triggers', async () => { const lookup = { hasNativeUserWithEmail: vi.fn() }; const native = { ...event, triggerSource: 'PreSignUp_SignUp' }; expect(await guardGooglePreSignUp(native, lookup)).toBe(native); expect(lookup.hasNativeUserWithEmail).not.toHaveBeenCalled(); });
    it('fails closed on provider lookup failure', async () => { await expect(guardGooglePreSignUp(event, { hasNativeUserWithEmail: async () => { throw new Error('unavailable'); } })).rejects.toThrow(); });
});
