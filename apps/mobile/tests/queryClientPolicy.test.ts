import { describe, expect, it } from 'vitest';

import { createMobileQueryClient } from '@/lib/queryClient';

describe('Mobile QueryClient policy', () => {
  it('書き込みをオフラインキューへ積まず即時にAPI境界へ渡す', () => {
    const queryClient = createMobileQueryClient();

    expect(queryClient.getDefaultOptions().mutations).toMatchObject({
      networkMode: 'always',
      retry: false
    });
  });
});
