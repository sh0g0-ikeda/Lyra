import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/lib/env.js';

const originalNodeEnv = process.env.NODE_ENV;

describe('parseEnv', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('production では GENERATION_ENABLED 未設定時に生成を無効化する', () => {
    process.env.NODE_ENV = 'production';

    const parsed = parseEnv({});

    expect(parsed.GENERATION_ENABLED).toBe(false);
  });

  it('production でも GENERATION_ENABLED=true が明示されていれば生成を有効化する', () => {
    process.env.NODE_ENV = 'production';

    const parsed = parseEnv({ GENERATION_ENABLED: 'true' });

    expect(parsed.GENERATION_ENABLED).toBe(true);
  });

  it('development では GENERATION_ENABLED 未設定時に従来どおり生成を有効化する', () => {
    process.env.NODE_ENV = 'development';

    const parsed = parseEnv({});

    expect(parsed.GENERATION_ENABLED).toBe(true);
  });
});
