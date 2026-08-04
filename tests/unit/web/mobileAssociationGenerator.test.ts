import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve('apps/web/scripts/generateMobileAssociations.mjs');

function runGenerator(
  outputDirectory: string,
  environment: Record<string, string | undefined>,
): string {
  const env = { ...process.env };
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }

  return execFileSync(process.execPath, [scriptPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...env,
      MOBILE_ASSOCIATION_OUTPUT_DIR: outputDirectory,
    },
  });
}

describe('Mobile association generator', () => {
  it('有効な Team ID から限定された AASA を生成する', () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'lyra-aasa-valid-'));

    runGenerator(outputDirectory, {
      APPLE_DEVELOPER_TEAM_ID: 'A1B2C3D4E5',
      LYRA_STRICT_WEB_PRODUCTION_CONFIG: 'true',
    });

    const associationPath = path.join(
      outputDirectory,
      'apple-app-site-association',
    );
    const association = JSON.parse(readFileSync(associationPath, 'utf8')) as {
      applinks: {
        apps: unknown[];
        details: Array<{ appID: string; paths: string[] }>;
      };
    };

    expect(association).toEqual({
      applinks: {
        apps: [],
        details: [
          {
            appID: 'A1B2C3D4E5.jp.lyra.mobile',
            paths: ['/auth/mobile/*', '/invitations/*'],
          },
        ],
      },
    });
  });

  it('本番ビルドで Team ID がない場合は失敗する', () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'lyra-aasa-missing-'));

    expect(() =>
      runGenerator(outputDirectory, {
        APPLE_DEVELOPER_TEAM_ID: undefined,
        LYRA_STRICT_WEB_PRODUCTION_CONFIG: 'true',
      }),
    ).toThrow(/APPLE_DEVELOPER_TEAM_ID/u);
  });

  it('不正な Team ID は環境にかかわらず拒否する', () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'lyra-aasa-invalid-'));

    expect(() =>
      runGenerator(outputDirectory, {
        APPLE_DEVELOPER_TEAM_ID: 'not-a-team-id',
        LYRA_STRICT_WEB_PRODUCTION_CONFIG: 'false',
      }),
    ).toThrow(/APPLE_DEVELOPER_TEAM_ID/u);
  });

  it('非本番で Team ID がない場合は古い生成ファイルを除去する', () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'lyra-aasa-stale-'));
    const associationPath = path.join(
      outputDirectory,
      'apple-app-site-association',
    );
    writeFileSync(associationPath, '{"stale":true}', 'utf8');

    runGenerator(outputDirectory, {
      APPLE_DEVELOPER_TEAM_ID: undefined,
      LYRA_STRICT_WEB_PRODUCTION_CONFIG: 'false',
    });

    expect(existsSync(associationPath)).toBe(false);
  });
});
