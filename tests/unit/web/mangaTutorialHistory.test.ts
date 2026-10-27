import { describe, expect, it } from 'vitest';

import {
  mangaTutorialHistoryKey,
  readMangaTutorialHistory,
  writeMangaTutorialHistory,
} from '../../../apps/web/src/lib/mangaTutorialHistory.js';

// Web onboarding is deliberately a per-browser presentation preference: these
// tests lock it away from account, draft, credit, and generation persistence.
describe('Web manga tutorial history', () => {
  it('scope と version を含む key で閲覧済みを復元する', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value); },
    };

    expect(mangaTutorialHistoryKey('email:session')).toBe('lyra:web:manga-tutorial:v1:email:session');
    expect(readMangaTutorialHistory(storage, 'email:session')).toBe('unseen');
    expect(writeMangaTutorialHistory(storage, 'email:session')).toBe(true);
    expect(readMangaTutorialHistory(storage, 'email:session')).toBe('seen');
    expect(readMangaTutorialHistory(storage, 'another:session')).toBe('unseen');

    const legacyOrMalformed = new Map<string, string>([
      ['lyra:web:manga-tutorial:v0:email:session', 'seen'],
      ['lyra:web:manga-tutorial:v1:email:session', 'complete'],
      ['lyra:web:manga-tutorial:v1:another:session', 'seen'],
    ]);
    const legacyStorage = {
      getItem: (key: string): string | null => legacyOrMalformed.get(key) ?? null,
    };
    expect(readMangaTutorialHistory(legacyStorage, 'email:session')).toBe('unseen');
    expect(readMangaTutorialHistory(legacyStorage, 'another:session')).toBe('seen');
  });

  it('古い version または storage error は未確認扱いにして例外を漏らさない', () => {
    const storage = {
      getItem: (): string | null => { throw new Error('blocked'); },
      setItem: (): void => { throw new Error('blocked'); },
    };

    expect(readMangaTutorialHistory(storage, 'email:session')).toBe('unavailable');
    expect(writeMangaTutorialHistory(storage, 'email:session')).toBe(false);
  });
});
