import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production Dockerfile', () => {
  it('Web build stageは共有contractのsourceと依存を持つ', async () => {
    const dockerfile = (await readFile(join(process.cwd(), 'Dockerfile'), 'utf8')).replace(/\r\n?/gu, '\n');
    const stage = dockerfile.split(' AS web-build\n')[1]?.split('\nFROM ')[0] ?? '';
    expect(stage).toContain('COPY packages /app/packages');
    expect(stage).toContain('COPY --from=deps /app/node_modules /app/node_modules');
    expect(stage.indexOf('COPY packages /app/packages')).toBeLessThan(stage.indexOf('RUN npm run build'));
  });

  it('実行イメージは脆弱性を含むビルドツールを持たず非rootで起動する', async () => {
    const dockerfile = (await readFile(join(process.cwd(), 'Dockerfile'), 'utf8')).replace(/\r\n?/gu, '\n');
    const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

    expect(dockerfile).toContain('FROM --platform=$BUILDPLATFORM oven/bun:1.3.14 AS deps');
    expect(dockerfile).toContain('FROM oven/bun:1.3.14 AS production-deps');
    expect(dockerfile).toContain('FROM --platform=$BUILDPLATFORM node:24-slim AS web-build');
    expect(dockerfile).toContain('COPY packages ./packages');
    expect(runtimeStage).toContain(
      'FROM oven/bun:1.3.14-distroless@sha256:c28c51287af70bab8e0b66fc4b6a30cfb92a727ebc88045223adc9f4c9d09307 AS runtime',
    );
    expect(runtimeStage).not.toContain('RUN bun install');
    expect(runtimeStage).toContain('LD_LIBRARY_PATH=/usr/lib');
    expect(runtimeStage).toContain(
      'COPY --from=production-deps /usr/lib/*-linux-gnu/libstdc++.so.6* /usr/lib/',
    );
    expect(runtimeStage).toContain(
      'COPY --from=production-deps /lib/*-linux-gnu/libgcc_s.so.1 /usr/lib/',
    );
    expect(runtimeStage).toContain('USER 65532:65532');
    expect(runtimeStage).toContain('ENTRYPOINT []');
    expect(runtimeStage).toContain(
      'CMD ["/usr/local/bin/bun", "dist/scripts/startProductionApi.js"]',
    );
  });
});
