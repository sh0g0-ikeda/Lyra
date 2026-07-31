import { afterEach, vi } from 'vitest';

(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

afterEach((): void => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
