import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const maestroRoot = join(projectRoot, '.maestro');
const manifestPath = join(maestroRoot, 'e2e-manifest.json');

const expectedScenarios = [
  ['E2E-01', 'signup/confirm/login/logout', 'required', 'required'],
  ['E2E-02', 'token refresh/background', 'required', 'required'],
  ['E2E-03', 'personal full creation flow', 'required', 'required'],
  ['E2E-04', 'entity import/generate/confirm', 'required', 'required'],
  ['E2E-05', 'skeleton/story apply/recovery', 'required', 'required'],
  ['E2E-06', 'page edit/generate/confirm/export', 'required', 'required'],
  ['E2E-07', 'insufficient credit/action', 'required', 'required'],
  ['E2E-08', 'org invitation/new account', 'required', 'required'],
  ['E2E-09', 'org role permissions', 'required', 'required'],
  ['E2E-10', 'org credit/billing handoff', 'required', 'required'],
  ['E2E-11', 'offline/retry/no draft loss', 'required', 'required'],
  ['E2E-12', 'Japanese/English switch', 'required', 'required'],
  ['E2E-13', 'deep link cold/warm start', 'required', 'required'],
  ['E2E-14', 'account deletion', 'required', 'required'],
  ['E2E-15', 'personal purchase/pending/restore/refund', 'StoreKit sandbox', 'Play license test'],
  ['E2E-16', 'save-and-generate atomicity/409 conflict', 'required', 'required'],
  ['E2E-17', 'active job recovery after app restart', 'required', 'required'],
  ['E2E-18', 'external dialogue is unavailable until balloon flow is complete', 'required', 'required']
] as const;

interface MaestroScenario {
  id: string;
  title: string;
  platforms: {
    ios: string;
    android: string;
  };
  flow: string;
  requiredEnv: string[];
  platformRequiredEnv?: {
    ios?: string[];
    android?: string[];
  };
  externalEvidence?: {
    ios?: string[];
    android?: string[];
  };
  fixtures: string[];
}

interface MaestroManifest {
  applicationId: string;
  scenarios: MaestroScenario[];
}

async function readManifest(): Promise<MaestroManifest> {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as MaestroManifest;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return children.flat();
}

describe('Maestro E2E-01 through E2E-18 executable contract', () => {
  it('11.4のID、タイトル、iOS/Android要件を漏れなく一意に保持する', async () => {
    const manifest = await readManifest();

    expect(manifest.applicationId).toBe('com.lyra.mobile');
    expect(manifest.scenarios).toHaveLength(expectedScenarios.length);
    expect(manifest.scenarios.map((scenario) => scenario.id)).toEqual(
      expectedScenarios.map(([id]) => id)
    );
    expect(new Set(manifest.scenarios.map((scenario) => scenario.id)).size).toBe(expectedScenarios.length);

    for (const [id, title, ios, android] of expectedScenarios) {
      expect(manifest.scenarios).toContainEqual(expect.objectContaining({
        id,
        title,
        platforms: { ios, android }
      }));
    }
  });

  it('全シナリオが実行可能なフロー、fixture alias、必要な環境変数を持つ', async () => {
    const manifest = await readManifest();

    for (const scenario of manifest.scenarios) {
      expect(scenario.flow).toMatch(/^flows\/e2e-\d{2}-[a-z0-9-]+\.yaml$/u);
      expect(scenario.fixtures.length).toBeGreaterThan(0);
      expect(scenario.requiredEnv.length).toBeGreaterThan(0);
      await expect(access(join(maestroRoot, scenario.flow))).resolves.toBeUndefined();

      const flow = await readFile(join(maestroRoot, scenario.flow), 'utf8');
      expect(flow).toContain(`name: "${scenario.id}: ${scenario.title}"`);
      expect(flow).toContain('appId: ${APP_ID}');
      expect(flow).toContain(`takeScreenshot: ${scenario.id}-`);
      expect(flow).toContain('runFlow:');
    }
  });

  it('YAML内で参照する共有フローがすべて存在する', async () => {
    const files = await listFiles(maestroRoot);
    const yamlFiles = files.filter((file) => /\.ya?ml$/u.test(file));

    for (const file of yamlFiles) {
      const source = await readFile(file, 'utf8');
      const references = [...source.matchAll(/^\s*file:\s*(.+\.(?:ya?ml|js))\s*$/gmu)]
        .map((match) => match[1].trim().replace(/^['"]|['"]$/gu, ''));
      for (const reference of references) {
        await expect(access(resolve(dirname(file), reference))).resolves.toBeUndefined();
      }
    }
  });

  it('フローとmanifestにはリテラルの秘密情報、メールアドレス、URLを含めない', async () => {
    const files = await listFiles(maestroRoot);
    const source = await Promise.all(files
      .filter((file) => /\.(?:json|ya?ml)$/u.test(file))
      .map(async (file) => ({
        path: relative(maestroRoot, file),
        body: await readFile(file, 'utf8')
      })));

    const literalEmail = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u;
    const literalUrl = /https?:\/\//u;
    const secretAssignment = /(?:password|token|secret)\s*:\s*(?!\$\{E2E_[A-Z0-9_]+\})\S+/iu;

    for (const file of source) {
      expect(file.path).not.toContain('evidence');
      expect(file.body).not.toMatch(literalEmail);
      expect(file.body).not.toMatch(literalUrl);
      expect(file.body).not.toMatch(secretAssignment);
    }
  });

  it('E2E-15はStoreKit sandboxとPlay license testの明示的な実行条件を持つ', async () => {
    const manifest = await readManifest();
    const storeScenario = manifest.scenarios.find((scenario) => scenario.id === 'E2E-15');

    expect(storeScenario).toMatchObject({
      platforms: {
        ios: 'StoreKit sandbox',
        android: 'Play license test'
      }
    });
    expect(storeScenario?.platformRequiredEnv).toEqual(expect.objectContaining({
      ios: expect.arrayContaining([
        'E2E_STOREKIT_SANDBOX_ACCOUNT'
      ]),
      android: expect.arrayContaining([
        'E2E_PLAY_LICENSE_TEST_ACCOUNT'
      ])
    }));
    expect(storeScenario?.requiredEnv).toContain('E2E_STORE_TEST_ACKNOWLEDGED');
  });

  it('E2E-13は停止済みアプリへのcold linkとbackground済みアプリへのwarm linkを区別する', async () => {
    const flow = await readFile(join(maestroRoot, 'flows', 'e2e-13-deep-link-cold-warm-start.yaml'), 'utf8');
    const stopIndex = flow.indexOf('- stopApp');
    const coldLinkIndex = flow.indexOf('- openLink:', stopIndex);
    const coldAssertionIndex = flow.indexOf('E2E_DEEP_LINK_DESTINATION_LABEL', coldLinkIndex);
    const warmBackgroundIndex = flow.indexOf('- pressKey: Home', coldAssertionIndex);
    const warmLinkIndex = flow.indexOf('- openLink:', warmBackgroundIndex);

    expect(stopIndex).toBeGreaterThanOrEqual(0);
    expect(coldLinkIndex).toBeGreaterThan(stopIndex);
    expect(coldAssertionIndex).toBeGreaterThan(coldLinkIndex);
    expect(warmBackgroundIndex).toBeGreaterThan(coldAssertionIndex);
    expect(warmLinkIndex).toBeGreaterThan(warmBackgroundIndex);
    expect(flow.slice(warmBackgroundIndex, warmLinkIndex)).not.toContain('launchApp');
  });

  it('E2E-11は実ネットワーク断と復帰後の下書き本文を検証する', async () => {
    const manifest = await readManifest();
    const scenario = manifest.scenarios.find((candidate) => candidate.id === 'E2E-11');
    const flow = await readFile(join(maestroRoot, 'flows', 'e2e-11-offline-retry-no-draft-loss.yaml'), 'utf8');

    expect(flow).toContain('setAirplaneMode: enabled');
    expect(flow).toContain('setAirplaneMode: disabled');
    expect(flow).toContain('set-network-state.js');
    expect(flow).toContain('tapOn: ${E2E_OFFLINE_WRITE_LABEL}');
    expect(flow).toContain('assertVisible: ${E2E_OFFLINE_WRITE_FAILURE_LABEL}');
    expect(flow).toContain('assertVisible: ${E2E_OFFLINE_WRITE_SUCCESS_LABEL}');
    expect(flow).toContain('assertVisible: ${E2E_OFFLINE_DRAFT_TEXT}');
    expect(scenario?.platformRequiredEnv?.ios).toEqual(expect.arrayContaining([
      'E2E_NETWORK_CONTROL_URL',
      'E2E_NETWORK_CONTROL_TOKEN',
      'E2E_NETWORK_DEVICE_ID',
      'E2E_NETWORK_HARNESS_EVIDENCE_PATH'
    ]));
  });

  it('E2E-15は各ストアのプロバイダ証跡を必須にしてrenewalをUIと外部証跡で確認する', async () => {
    const manifest = await readManifest();
    const scenario = manifest.scenarios.find((candidate) => candidate.id === 'E2E-15');
    const flow = await readFile(join(maestroRoot, 'flows', 'e2e-15-personal-purchase-pending-restore-refund.yaml'), 'utf8');

    expect(flow).toContain('E2E_PURCHASE_RENEWAL_LABEL');
    expect(flow).toContain('E2E_PURCHASE_RENEWAL_RESULT_LABEL');
    expect(scenario?.platformRequiredEnv?.ios).toEqual(expect.arrayContaining([
      'E2E_STOREKIT_PROVIDER_EVIDENCE_PATH',
      'E2E_STORE_PENDING_EVIDENCE_PATH',
      'E2E_STORE_REFUND_EVIDENCE_PATH',
      'E2E_STORE_RENEWAL_EVIDENCE_PATH'
    ]));
    expect(scenario?.platformRequiredEnv?.android).toEqual(expect.arrayContaining([
      'E2E_PLAY_PROVIDER_EVIDENCE_PATH',
      'E2E_STORE_PENDING_EVIDENCE_PATH',
      'E2E_STORE_REFUND_EVIDENCE_PATH',
      'E2E_STORE_RENEWAL_EVIDENCE_PATH'
    ]));
  });

  it('E2E-15は購入、webhook、ledgerと各課金状態の署名付き相関証跡を要求する', async () => {
    const runner = await readFile(join(projectRoot, 'scripts', 'runMaestroStaging.mjs'), 'utf8');

    expect(runner).toContain('E2E_EVIDENCE_HMAC_SECRET');
    expect(runner).toContain('createHmac');
    expect(runner).toContain('pending');
    expect(runner).toContain('cancel');
    expect(runner).toContain('restore');
    expect(runner).toContain('renewal');
    expect(runner).toContain('refund');
    expect(runner).toContain('purchaseTransactionDigest');
    expect(runner).toContain('webhookEventDigest');
    expect(runner).toContain('ledger');
  });
});
