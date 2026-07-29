import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

function runRunner(environment: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['scripts/runMaestroStaging.mjs'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...environment
    }
  });
}

describe('Maestro staging runner fail-closed contract', () => {
  it('不正なプラットフォームをMaestro起動前に拒否する', () => {
    const result = runRunner({ E2E_PLATFORM: 'web' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('E2E_PLATFORM must be exactly ios or android.');
  });

  it('選択シナリオの必須値がないと証跡作成やMaestro起動を行わない', async () => {
    const evidenceDirectory = await mkdtemp(join(tmpdir(), 'lyra-maestro-'));

    try {
      const result = runRunner({
        E2E_EVIDENCE_DIR: evidenceDirectory,
        E2E_PLATFORM: 'android',
        E2E_SCENARIOS: 'E2E-01'
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Missing required environment variables for E2E-01');
      expect(`${result.stdout}${result.stderr}`).not.toContain('Could not start Maestro CLI');
    } finally {
      await rm(evidenceDirectory, { force: true, recursive: true });
    }
  });

  it('StoreKitとPlayの購入試験を通常のstaging実行として扱わない', async () => {
    const source = await readFile(join(projectRoot, 'scripts', 'runMaestroStaging.mjs'), 'utf8');

    expect(source).toContain('E2E_STOREKIT_SANDBOX_ACCOUNT');
    expect(source).toContain('E2E_PLAY_LICENSE_TEST_ACCOUNT');
    expect(source).toContain('E2E_STORE_TEST_ACKNOWLEDGED');
    expect(source).toContain('--test-output-dir=');
    expect(source).toContain('E2E_RUN_ID');
    expect(source).toContain('verifyExternalEvidence');
  });

  it('外部イベント証跡はMaestro実行後に同じrun IDで検証する', async () => {
    const source = await readFile(
      join(projectRoot, 'scripts', 'runMaestroStaging.mjs'),
      'utf8'
    );
    const executionIndex = source.indexOf('const result = spawnSync(');
    const successIndex = source.indexOf(
      'if (result.error || result.status !== 0)',
      executionIndex
    );
    const evidenceIndex = source.lastIndexOf(
      'await verifyExternalEvidence(scenario, platform, runId)'
    );

    expect(executionIndex).toBeGreaterThanOrEqual(0);
    expect(successIndex).toBeGreaterThan(executionIndex);
    expect(evidenceIndex).toBeGreaterThan(successIndex);
  });

  it('E2E-15はrun IDを含む任意テキストの課金証跡を拒否する', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'lyra-maestro-store-'));
    const evidenceDirectory = join(sandbox, 'evidence');
    const maestroWrapperPath = join(sandbox, 'maestro-wrapper.mjs');
    const runId = 'store-run-0001';
    const evidenceNames = [
      'provider.json',
      'webhook.json',
      'pending.json',
      'restore.json',
      'refund.json',
      'renewal.json'
    ];

    try {
      await Promise.all([
        ...evidenceNames.map((name) => writeFile(join(sandbox, name), `untrusted ${runId}`, 'utf8')),
        writeFile(
          maestroWrapperPath,
          [
            "import { mkdirSync, writeFileSync } from 'node:fs';",
            "import { dirname, join } from 'node:path';",
            "if (process.argv.includes('--version')) process.exit(0);",
            "const outputIndex = process.argv.indexOf('--output');",
            'const output = process.argv[outputIndex + 1];',
            'mkdirSync(dirname(output), { recursive: true });',
            "writeFileSync(output, '<testsuites/>');",
            "writeFileSync(join(process.env.E2E_EVIDENCE_DIR, 'E2E-15-store-result.png'), 'screenshot');"
          ].join('\n'),
          'utf8'
        )
      ]);

      const result = runRunner({
        E2E_EVIDENCE_DIR: evidenceDirectory,
        E2E_PLATFORM: 'android',
        E2E_SCENARIOS: 'E2E-15',
        E2E_RUN_ID: runId,
        E2E_EVIDENCE_HMAC_SECRET: 'test-only-secret-with-at-least-thirty-two-characters',
        E2E_MAESTRO_EXECUTABLE: process.execPath,
        E2E_MAESTRO_ARGUMENT_PREFIX: maestroWrapperPath,
        E2E_STORE_TEST_ACKNOWLEDGED: 'true',
        E2E_PLAY_LICENSE_TEST_ACCOUNT: 'license-test-account',
        E2E_PLAY_PROVIDER_EVIDENCE_PATH: join(sandbox, 'provider.json'),
        E2E_STORE_SERVER_WEBHOOK_EVIDENCE_PATH: join(sandbox, 'webhook.json'),
        E2E_STORE_PENDING_EVIDENCE_PATH: join(sandbox, 'pending.json'),
        E2E_STORE_RESTORE_EVIDENCE_PATH: join(sandbox, 'restore.json'),
        E2E_STORE_REFUND_EVIDENCE_PATH: join(sandbox, 'refund.json'),
        E2E_STORE_RENEWAL_EVIDENCE_PATH: join(sandbox, 'renewal.json'),
        E2E_LOGIN_EMAIL: 'test@example.invalid',
        E2E_LOGIN_PASSWORD: 'not-a-real-password',
        E2E_AUTH_EMAIL_LABEL: 'Email',
        E2E_AUTH_PASSWORD_LABEL: 'Password',
        E2E_AUTH_SUBMIT_LABEL: 'Sign in',
        E2E_PURCHASE_LABEL: 'Purchase',
        E2E_PURCHASE_PENDING_LABEL: 'Pending',
        E2E_PURCHASE_RESTORE_LABEL: 'Restore',
        E2E_PURCHASE_REFUND_LABEL: 'Refund',
        E2E_PURCHASE_RENEWAL_LABEL: 'Renewal',
        E2E_PURCHASE_RENEWAL_RESULT_LABEL: 'Renewed',
        E2E_PURCHASE_RESULT_LABEL: 'Purchased',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('must be a JSON object');
    } finally {
      await rm(sandbox, { force: true, recursive: true });
    }
  });
});
