import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositorySource = (fileName: string): string =>
  readFileSync(resolve(process.cwd(), 'src', 'repositories', fileName), 'utf8');

describe('更新競合トークンの時刻精度', () => {
  it('作品・章・話はAPIが保持できるミリ秒精度で版を比較する', () => {
    const source = repositorySource('StoryRepository.ts');

    expect(source).toContain(
      "date_trunc('milliseconds', works.updated_at) = $20::timestamptz",
    );
    expect(source).toContain(
      "date_trunc('milliseconds', chapters.updated_at) = $20::timestamptz",
    );
    expect(source).toContain(
      "date_trunc('milliseconds', episodes.updated_at) = $25::timestamptz",
    );
  });

  it('同じミリ秒内の連続更新でもストーリーの版を必ず前進させる', () => {
    const source = repositorySource('StoryRepository.ts');

    expect(source).not.toContain('updated_at = NOW()');
    expect(source).toContain("date_trunc('milliseconds', clock_timestamp())");
    expect(source).toContain("+ INTERVAL '1 millisecond'");
  });

  it('同じ版契約を使うキャラクター更新もミリ秒精度で安全に比較する', () => {
    const source = repositorySource('EntityRepository.ts');

    expect(source).toContain(
      "date_trunc('milliseconds', entities.updated_at) = $14::timestamptz",
    );
    expect(source).not.toContain('updated_at = NOW()');
    expect(source).toContain("date_trunc('milliseconds', clock_timestamp())");
    expect(source).toContain("+ INTERVAL '1 millisecond'");
  });
});
