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

  it('個別 generation kill switch は未設定時に有効になる', () => {
    const parsed = parseEnv({});

    expect(parsed.PAGE_GENERATION_ENABLED).toBe(true);
    expect(parsed.ENTITY_GENERATION_ENABLED).toBe(true);
    expect(parsed.ENTITY_IMPORT_ANALYSIS_ENABLED).toBe(true);
    expect(parsed.ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED).toBe(false);
  });

  it('個別 generation kill switch は false を明示できる', () => {
    const parsed = parseEnv({
      PAGE_GENERATION_ENABLED: 'false',
      ENTITY_GENERATION_ENABLED: 'false',
      ENTITY_IMPORT_ANALYSIS_ENABLED: 'false',
      ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED: 'true',
    });

    expect(parsed.PAGE_GENERATION_ENABLED).toBe(false);
    expect(parsed.ENTITY_GENERATION_ENABLED).toBe(false);
    expect(parsed.ENTITY_IMPORT_ANALYSIS_ENABLED).toBe(false);
    expect(parsed.ENTITY_REFERENCE_DIRECT_UPLOAD_ENABLED).toBe(true);
  });

  it('database timeout は安全な既定値を持つ', () => {
    const parsed = parseEnv({});

    expect(parsed.DATABASE_STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(parsed.DATABASE_QUERY_TIMEOUT_MS).toBe(30_000);
  });

  it('episode continuity v3 は未設定時に有効になる', () => {
    const parsed = parseEnv({});

    expect(parsed.EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED).toBe(true);
  });

  it('episode continuity v3 は明示的に無効化できる', () => {
    const parsed = parseEnv({ EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED: 'false' });

    expect(parsed.EPISODE_PAGE_PLAN_CONTINUITY_V3_ENABLED).toBe(false);
  });
});
