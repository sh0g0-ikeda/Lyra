import { afterEach, vi } from 'vitest';

afterEach((): void => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
