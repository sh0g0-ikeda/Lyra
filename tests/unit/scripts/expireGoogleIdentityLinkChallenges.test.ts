import { describe, expect, it } from 'vitest';
import { parseGoogleLinkExpiryArgs } from '../../../scripts/expireGoogleIdentityLinkChallenges.js';
describe('Google challenge cleanup command', () => {
    it('defaults to bounded dry-run', () => expect(parseGoogleLinkExpiryArgs([])).toEqual({ apply: false, limit: 100 }));
    it('requires explicit apply and accepts a smaller bound', () => expect(parseGoogleLinkExpiryArgs(['--apply', '--limit', '5'])).toEqual({ apply: true, limit: 5 }));
    it.each([['--limit', '0'], ['--limit', '101'], ['--limit', '1.1'], ['--anything'], ['--apply', '--dry-run'], ['--limit', '5', '--limit', '6']])('rejects unsafe arguments %j', (...args) => expect(() => parseGoogleLinkExpiryArgs(args)).toThrow());
});
