import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/lib/env.js';
import { assertProductionRuntimeConfig } from '../../../src/lib/runtimeGuards.js';

describe('generation worker warm configuration', () => {
  it('未指定の場合に予熱を無効にし明示trueだけ有効になる', () => {
    expect(parseEnv({}).GENERATION_WORKER_WARM_ENABLED).toBe(false);
    expect(parseEnv({ GENERATION_WORKER_WARM_ENABLED: 'true' }).GENERATION_WORKER_WARM_ENABLED).toBe(true);
    expect(() => parseEnv({ GENERATION_WORKER_WARM_ENABLED: 'yes' })).toThrow();
  });

  it('server resourceがECS service形式でない場合に拒否する', () => {
    expect(() => parseEnv({ GENERATION_WORKER_SCALABLE_RESOURCE_ID: 'service/cluster/worker/extra' })).toThrow();
    expect(parseEnv({ GENERATION_WORKER_SCALABLE_RESOURCE_ID: 'service/lyra-prod/lyra-prod-worker' }).GENERATION_WORKER_SCALABLE_RESOURCE_ID)
      .toBe('service/lyra-prod/lyra-prod-worker');
  });

  it('予熱を有効にして対象設定が欠ける場合にtest環境でも起動を拒否する', () => {
    expect(() => assertProductionRuntimeConfig({
      APP_ENV: 'test', DEV_AUTH_BYPASS: false, GENERATION_WORKER_WARM_ENABLED: true,
    }, 'test')).toThrow('Generation worker warm control configuration is incomplete');
  });
});
