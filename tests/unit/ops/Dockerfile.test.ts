import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production Dockerfile', () => {
  it('実行イメージは脆弱性を含むビルドツールを持たず非rootで起動する', async () => {
    const dockerfile = await readFile(join(process.cwd(), 'Dockerfile'), 'utf8');
    const runtimeBaseStart = dockerfile.indexOf(
      '\nFROM oven/bun:1.3.14-distroless@sha256:c28c51287af70bab8e0b66fc4b6a30cfb92a727ebc88045223adc9f4c9d09307 AS runtime-base',
    );
    const migrationRuntimeStart = dockerfile.indexOf(
      '\nFROM runtime-base AS migration-runtime',
    );
    const runtimeStart = dockerfile.indexOf('\nFROM runtime-base AS runtime');
    const runtimeBaseStage = dockerfile.slice(
      runtimeBaseStart,
      migrationRuntimeStart,
    );
    const migrationRuntimeStage = dockerfile.slice(
      migrationRuntimeStart,
      runtimeStart,
    );
    const runtimeStage = dockerfile.slice(runtimeStart);

    expect(dockerfile).toContain('FROM --platform=$BUILDPLATFORM oven/bun:1.3.14 AS deps');
    expect(dockerfile).toContain('FROM oven/bun:1.3.14 AS production-deps');
    expect(dockerfile).toContain(
      'COPY packages/api-contract ./packages/api-contract',
    );
    expect(dockerfile).toContain('FROM --platform=$BUILDPLATFORM node:24-slim AS web-build');
    expect(runtimeBaseStart).toBeGreaterThanOrEqual(0);
    expect(migrationRuntimeStart).toBeGreaterThan(runtimeBaseStart);
    expect(runtimeStart).toBeGreaterThan(migrationRuntimeStart);
    expect(runtimeBaseStage).not.toContain('RUN bun install');
    expect(runtimeBaseStage).toContain('LD_LIBRARY_PATH=/usr/lib');
    expect(runtimeBaseStage).toContain(
      'COPY --from=production-deps /usr/lib/*-linux-gnu/libstdc++.so.6* /usr/lib/',
    );
    expect(runtimeBaseStage).toContain(
      'COPY --from=production-deps /lib/*-linux-gnu/libgcc_s.so.1 /usr/lib/',
    );
    expect(runtimeBaseStage).toContain('COPY --chown=65532:65532 migrations ./migrations');
    expect(runtimeBaseStage).toContain('COPY --chown=65532:65532 ops/certs ./certs');
    expect(runtimeBaseStage).toContain('USER 65532:65532');
    expect(runtimeBaseStage).toContain('ENTRYPOINT []');
    expect(migrationRuntimeStage).toContain(
      'CMD ["/usr/local/bin/bun", "dist/scripts/startProductionMigration.js"]',
    );
    expect(migrationRuntimeStage).not.toContain('--from=web-build');
    expect(runtimeStage).toContain(
      'COPY --chown=65532:65532 --from=web-build /app/apps/web/dist ./public',
    );
    expect(runtimeStage).toContain(
      'CMD ["/usr/local/bin/bun", "dist/scripts/startProductionApi.js"]',
    );
  });

  it('CIはApple Team IDなしでmigration専用targetをbuildする', async () => {
    const workflow = await readFile(
      join(process.cwd(), '.github', 'workflows', 'ci.yml'),
      'utf8',
    );

    expect(workflow).toContain('uses: docker/setup-qemu-action@v3');
    expect(workflow).toContain('platforms: arm64');
    expect(workflow).toContain(
      'docker buildx build --platform linux/arm64 --target migration-runtime --tag lyra-migration-ci --load .',
    );
    expect(workflow).toContain(
      "test \"$(docker image inspect lyra-migration-ci --format '{{.Architecture}}/{{.Config.User}}')\" = 'arm64/65532:65532'",
    );
    expect(workflow).toContain(
      'docker run --rm --platform linux/arm64 --entrypoint /usr/local/bin/bun lyra-migration-ci',
    );
  });
});
