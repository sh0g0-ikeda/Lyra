import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maestroRoot = join(projectRoot, '.maestro');
const manifestPath = join(maestroRoot, 'e2e-manifest.json');
const supportedPlatforms = new Set(['ios', 'android']);
const scenarioIdPattern = /^E2E-(?:0[1-9]|1[0-8])$/u;
const storeAccountEnvironmentByPlatform = {
  ios: 'E2E_STOREKIT_SANDBOX_ACCOUNT',
  android: 'E2E_PLAY_LICENSE_TEST_ACCOUNT'
};
const storeProviderByPlatform = {
  ios: 'storekit',
  android: 'google-play'
};
const storeEnvironmentByPlatform = {
  ios: 'StoreKit sandbox',
  android: 'Play license test'
};
const storeEvidenceRequirements = {
  E2E_STOREKIT_PROVIDER_EVIDENCE_PATH: { platform: 'ios', artifact: 'provider', state: 'purchase' },
  E2E_PLAY_PROVIDER_EVIDENCE_PATH: { platform: 'android', artifact: 'provider', state: 'purchase' },
  E2E_STORE_SERVER_WEBHOOK_EVIDENCE_PATH: { artifact: 'webhook', state: 'purchase' },
  E2E_STORE_PENDING_EVIDENCE_PATH: { artifact: 'lifecycle', state: 'pending' },
  E2E_STORE_RESTORE_EVIDENCE_PATH: { artifact: 'lifecycle', state: 'restore' },
  E2E_STORE_REFUND_EVIDENCE_PATH: { artifact: 'lifecycle', state: 'refund' },
  E2E_STORE_RENEWAL_EVIDENCE_PATH: { artifact: 'lifecycle', state: 'renewal' }
};
const requiredStoreCorrelationStates = ['purchase', 'pending', 'cancel', 'restore', 'renewal', 'refund'];
const offlineWriteEvidenceName = 'E2E_OFFLINE_WRITE_EVIDENCE_PATH';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function nonEmptyEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function readScenarioSelection() {
  const argument = process.argv.find((value) => value.startsWith('--scenarios='));
  const value = argument === undefined
    ? nonEmptyEnvironmentValue('E2E_SCENARIOS')
    : argument.slice('--scenarios='.length);

  if (value === null || value.trim().length === 0) {
    fail('E2E_SCENARIOS or --scenarios=E2E-01,... is required.');
  }

  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !scenarioIdPattern.test(id))) {
    fail('E2E_SCENARIOS must contain only E2E-01 through E2E-18 IDs.');
  }
  if (new Set(ids).size !== ids.length) {
    fail('E2E_SCENARIOS must not contain duplicate scenario IDs.');
  }
  return ids;
}

function validateManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object' || manifest.applicationId !== 'com.lyra.mobile') {
    fail('Invalid Maestro manifest applicationId.');
  }
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length !== 18) {
    fail('Maestro manifest must contain exactly 18 scenarios.');
  }
  const ids = manifest.scenarios.map((scenario) => scenario?.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !scenarioIdPattern.test(id))) {
    fail('Maestro manifest contains invalid or duplicate scenario IDs.');
  }
}

function requiredEnvironmentNames(scenario, platform) {
  const base = Array.isArray(scenario.requiredEnv) ? scenario.requiredEnv : [];
  const platformSpecific = scenario.platformRequiredEnv?.[platform];
  const externalEvidence = externalEvidenceNames(scenario, platform);
  const scenarioSpecific = scenarioSpecificEnvironmentNames(scenario);
  const runId = externalEvidence.length > 0 ? ['E2E_RUN_ID'] : [];
  return [...new Set([
    ...base,
    ...(Array.isArray(platformSpecific) ? platformSpecific : []),
    ...scenarioSpecific,
    ...externalEvidence,
    ...runId
  ])];
}

function externalEvidenceNames(scenario, platform) {
  const names = scenario.externalEvidence?.[platform];
  const manifestNames = Array.isArray(names) ? names : [];
  return scenario.id === 'E2E-11'
    ? [...new Set([...manifestNames, offlineWriteEvidenceName])]
    : manifestNames;
}

function scenarioSpecificEnvironmentNames(scenario) {
  if (scenario.id === 'E2E-11') {
    return [
      'E2E_OFFLINE_WRITE_LABEL',
      'E2E_OFFLINE_WRITE_FAILURE_LABEL',
      'E2E_OFFLINE_WRITE_SUCCESS_LABEL'
    ];
  }
  return scenario.id === 'E2E-15' ? ['E2E_EVIDENCE_HMAC_SECRET'] : [];
}

function runnerOnlyEnvironmentNames(scenario) {
  return scenario.id === 'E2E-15' ? new Set(['E2E_EVIDENCE_HMAC_SECRET']) : new Set();
}

async function fileExists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function hasScreenshotEvidence(directory, scenarioId) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await hasScreenshotEvidence(path, scenarioId)) {
        return true;
      }
      continue;
    }
    if (entry.isFile() && entry.name.startsWith(scenarioId) && entry.name.endsWith('.png')) {
      return true;
    }
  }
  return false;
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('Evidence JSON must not contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  fail('Evidence JSON contains an unsupported value.');
}

function readRequiredString(value, name, property) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`External evidence artifact ${name} must provide ${property}.`);
  }
  return value;
}

function readSha256(value, name, property) {
  const digest = readRequiredString(value, name, property);
  if (!/^[a-f0-9]{64}$/iu.test(digest)) {
    fail(`External evidence artifact ${name} must provide a SHA-256 ${property}.`);
  }
  return digest.toLowerCase();
}

function readRequiredObject(value, name, property) {
  if (!isJsonObject(value)) {
    fail(`External evidence artifact ${name} must provide object ${property}.`);
  }
  return value;
}

function readLedger(value, name, property) {
  const ledger = readRequiredObject(value, name, property);
  const event = readRequiredString(ledger.event, name, `${property}.event`);
  if (!Number.isFinite(ledger.delta)) {
    fail(`External evidence artifact ${name} must provide numeric ${property}.delta.`);
  }
  if (!Number.isFinite(ledger.balance) || ledger.balance < 0) {
    fail(`External evidence artifact ${name} must provide non-negative ${property}.balance.`);
  }
  return { event, delta: ledger.delta, balance: ledger.balance };
}

function resolvedEvidencePath(name) {
  const evidenceInput = nonEmptyEnvironmentValue(name);
  if (evidenceInput === null) {
    fail(`Missing external evidence input ${name}.`);
  }
  return isAbsolute(evidenceInput) ? resolve(evidenceInput) : resolve(projectRoot, evidenceInput);
}

async function readJsonEvidence(name, scenario) {
  const evidencePath = resolvedEvidencePath(name);
  if (!(await fileExists(evidencePath))) {
    fail(`Missing external evidence artifact ${name} for ${scenario.id}.`);
  }
  let evidence;
  try {
    evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  } catch {
    fail(`External evidence artifact ${name} for ${scenario.id} must be a JSON object.`);
  }
  if (!isJsonObject(evidence)) {
    fail(`External evidence artifact ${name} for ${scenario.id} must be a JSON object.`);
  }
  return evidence;
}

function verifyEvidenceHmac(evidence, name, secret) {
  const signature = readRequiredString(evidence.hmacSha256, name, 'hmacSha256');
  if (!/^[a-f0-9]{64}$/iu.test(signature)) {
    fail(`External evidence artifact ${name} must provide a SHA-256 hmacSha256.`);
  }
  const unsignedEvidence = { ...evidence };
  delete unsignedEvidence.hmacSha256;
  const expected = createHmac('sha256', secret).update(canonicalJson(unsignedEvidence)).digest();
  const provided = Buffer.from(signature, 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    fail(`External evidence artifact ${name} has an invalid HMAC.`);
  }
}

function verifyEvidenceIdentity(evidence, name, scenario, platform, runId) {
  if (evidence.schemaVersion !== 1) {
    fail(`External evidence artifact ${name} must use schemaVersion 1.`);
  }
  if (evidence.scenarioId !== scenario.id || evidence.runId !== runId || evidence.platform !== platform) {
    fail(`External evidence artifact ${name} does not match the selected scenario, platform, and E2E_RUN_ID.`);
  }
}

function verifyStoreEvidenceShape(evidence, name, requirement, platform, runId) {
  const expectedEnvironment = storeEnvironmentByPlatform[platform];
  const expectedProvider = storeProviderByPlatform[platform];
  if (requirement.platform !== undefined && requirement.platform !== platform) {
    fail(`External evidence artifact ${name} is not valid for ${platform}.`);
  }
  if (evidence.artifact !== requirement.artifact || evidence.state !== requirement.state) {
    fail(`External evidence artifact ${name} has an unexpected artifact or state.`);
  }
  if (evidence.storeEnvironment !== expectedEnvironment || evidence.provider !== expectedProvider) {
    fail(`External evidence artifact ${name} does not identify the required store environment and provider.`);
  }
  const productId = readRequiredString(evidence.productId, name, 'productId');
  const purchaseTransactionDigest = readSha256(evidence.purchaseTransactionDigest, name, 'purchaseTransactionDigest');
  const webhookEventDigest = readSha256(evidence.webhookEventDigest, name, 'webhookEventDigest');
  const verification = readRequiredObject(evidence.providerVerification, name, 'providerVerification');
  if (verification.status !== 'verified') {
    fail(`External evidence artifact ${name} must record providerVerification.status=verified.`);
  }
  readSha256(verification.evidenceDigest, name, 'providerVerification.evidenceDigest');
  const ledger = readLedger(evidence.ledger, name, 'ledger');
  const correlations = readRequiredObject(evidence.correlations, name, 'correlations');
  for (const state of requiredStoreCorrelationStates) {
    const correlation = readRequiredObject(correlations[state], name, `correlations.${state}`);
    if (correlation.state !== state) {
      fail(`External evidence artifact ${name} must correlate ${state} state.`);
    }
    if (correlation.providerVerification !== 'verified') {
      fail(`External evidence artifact ${name} must verify provider state ${state}.`);
    }
    if (readSha256(correlation.purchaseTransactionDigest, name, `correlations.${state}.purchaseTransactionDigest`) !== purchaseTransactionDigest) {
      fail(`External evidence artifact ${name} has an uncorrelated ${state} purchase transaction.`);
    }
    readSha256(correlation.webhookEventDigest, name, `correlations.${state}.webhookEventDigest`);
    readLedger(correlation.ledger, name, `correlations.${state}.ledger`);
  }
  const selectedCorrelation = readRequiredObject(correlations[requirement.state], name, `correlations.${requirement.state}`);
  if (
    selectedCorrelation.webhookEventDigest !== webhookEventDigest
    || selectedCorrelation.ledger.event !== ledger.event
    || selectedCorrelation.ledger.delta !== ledger.delta
    || selectedCorrelation.ledger.balance !== ledger.balance
  ) {
    fail(`External evidence artifact ${name} does not correlate its ${requirement.state} webhook and ledger event.`);
  }
  return { productId, purchaseTransactionDigest, storeEnvironment: expectedEnvironment, provider: expectedProvider, runId };
}

async function verifyOfflineWriteEvidence(scenario, platform, runId) {
  const evidence = await readJsonEvidence(offlineWriteEvidenceName, scenario);
  verifyEvidenceIdentity(evidence, offlineWriteEvidenceName, scenario, platform, runId);
  if (!['save', 'generate'].includes(evidence.operation) || evidence.clientOutcome !== 'network_error') {
    fail(`External evidence artifact ${offlineWriteEvidenceName} must record an offline save or generate failure.`);
  }
  readRequiredString(evidence.requestCorrelationId, offlineWriteEvidenceName, 'requestCorrelationId');
  const backend = readRequiredObject(evidence.backend, offlineWriteEvidenceName, 'backend');
  readRequiredString(backend.proofSource, offlineWriteEvidenceName, 'backend.proofSource');
  readRequiredString(backend.observedAt, offlineWriteEvidenceName, 'backend.observedAt');
  for (const field of ['writeRequestCount', 'queuedWriteCount', 'acceptedWriteCount']) {
    if (backend[field] !== 0) {
      fail(`External evidence artifact ${offlineWriteEvidenceName} must prove backend.${field}=0.`);
    }
  }
}

async function verifyStoreEvidence(scenario, platform, runId) {
  const secret = nonEmptyEnvironmentValue('E2E_EVIDENCE_HMAC_SECRET');
  if (secret === null || secret.length < 32) {
    fail('E2E-15 requires E2E_EVIDENCE_HMAC_SECRET with at least 32 characters.');
  }
  const evidenceNames = externalEvidenceNames(scenario, platform);
  let baseline = null;
  for (const name of evidenceNames) {
    const requirement = storeEvidenceRequirements[name];
    if (requirement === undefined) {
      fail(`E2E-15 has no schema for external evidence ${name}.`);
    }
    const evidence = await readJsonEvidence(name, scenario);
    verifyEvidenceHmac(evidence, name, secret);
    verifyEvidenceIdentity(evidence, name, scenario, platform, runId);
    const normalized = verifyStoreEvidenceShape(evidence, name, requirement, platform, runId);
    if (baseline === null) {
      baseline = normalized;
      continue;
    }
    if (
      baseline.productId !== normalized.productId
      || baseline.purchaseTransactionDigest !== normalized.purchaseTransactionDigest
      || baseline.storeEnvironment !== normalized.storeEnvironment
      || baseline.provider !== normalized.provider
      || baseline.runId !== normalized.runId
    ) {
      fail(`External evidence artifact ${name} does not correlate to the E2E-15 purchase.`);
    }
  }
}

async function verifyExternalEvidence(scenario, platform, runId) {
  if (scenario.id === 'E2E-15') {
    await verifyStoreEvidence(scenario, platform, runId);
    return;
  }
  if (scenario.id === 'E2E-11') {
    await verifyOfflineWriteEvidence(scenario, platform, runId);
  }
  for (const name of externalEvidenceNames(scenario, platform)) {
    if (name === offlineWriteEvidenceName) {
      continue;
    }
    const evidenceInput = nonEmptyEnvironmentValue(name);
    if (evidenceInput === null) {
      fail(`Missing external evidence input ${name} for ${scenario.id}.`);
    }
    const evidencePath = isAbsolute(evidenceInput)
      ? resolve(evidenceInput)
      : resolve(projectRoot, evidenceInput);
    if (!(await fileExists(evidencePath))) {
      fail(`Missing external evidence artifact ${name} for ${scenario.id}.`);
    }
    const evidence = await readFile(evidencePath, 'utf8');
    if (evidence.trim().length === 0 || !evidence.includes(runId)) {
      fail(`External evidence artifact ${name} for ${scenario.id} must include E2E_RUN_ID.`);
    }
  }
}

const platform = nonEmptyEnvironmentValue('E2E_PLATFORM');
if (platform === null || !supportedPlatforms.has(platform)) {
  fail('E2E_PLATFORM must be exactly ios or android.');
}

const selectedIds = readScenarioSelection();
const evidenceInput = nonEmptyEnvironmentValue('E2E_EVIDENCE_DIR');
if (evidenceInput === null) {
  fail('E2E_EVIDENCE_DIR is required for JUnit and screenshot evidence.');
}

const evidenceDirectory = isAbsolute(evidenceInput)
  ? resolve(evidenceInput)
  : resolve(projectRoot, evidenceInput);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
validateManifest(manifest);

const selectedScenarios = selectedIds.map((id) => manifest.scenarios.find((scenario) => scenario.id === id));
if (selectedScenarios.some((scenario) => scenario === undefined)) {
  fail('E2E_SCENARIOS includes an ID that is not present in the Maestro manifest.');
}

for (const scenario of selectedScenarios) {
  if (!scenario.platforms || typeof scenario.platforms[platform] !== 'string') {
    fail(`Scenario ${scenario.id} is not configured for ${platform}.`);
  }
  const missing = requiredEnvironmentNames(scenario, platform)
    .filter((name) => nonEmptyEnvironmentValue(name) === null);
  if (missing.length > 0) {
    fail(`Missing required environment variables for ${scenario.id}: ${missing.join(', ')}`);
  }
  if (!(await fileExists(join(maestroRoot, scenario.flow)))) {
    fail(`Missing Maestro flow for ${scenario.id}.`);
  }
  const externalEvidence = externalEvidenceNames(scenario, platform);
  if (externalEvidence.length > 0) {
    const runId = nonEmptyEnvironmentValue('E2E_RUN_ID');
    if (runId === null || !/^[A-Za-z0-9._-]{8,128}$/u.test(runId)) {
      fail(`Scenario ${scenario.id} requires a bounded E2E_RUN_ID for external evidence.`);
    }
  }
}

if (selectedIds.includes('E2E-15')) {
  const storeAccountEnvironment = storeAccountEnvironmentByPlatform[platform];
  if (
    nonEmptyEnvironmentValue('E2E_STORE_TEST_ACKNOWLEDGED') !== 'true'
    || nonEmptyEnvironmentValue(storeAccountEnvironment) === null
  ) {
    fail(`E2E-15 requires E2E_STORE_TEST_ACKNOWLEDGED=true and ${storeAccountEnvironment}.`);
  }
  const evidenceSecret = nonEmptyEnvironmentValue('E2E_EVIDENCE_HMAC_SECRET');
  if (evidenceSecret === null || evidenceSecret.length < 32) {
    fail('E2E-15 requires E2E_EVIDENCE_HMAC_SECRET with at least 32 characters.');
  }
}

const appId = nonEmptyEnvironmentValue('E2E_APP_ID') ?? manifest.applicationId;
if (appId !== manifest.applicationId) {
  fail(`E2E_APP_ID must be ${manifest.applicationId}.`);
}

const executable = nonEmptyEnvironmentValue('E2E_MAESTRO_EXECUTABLE')
  ?? (process.platform === 'win32' ? 'maestro.bat' : 'maestro');
const executableArgumentPrefix = nonEmptyEnvironmentValue('E2E_MAESTRO_ARGUMENT_PREFIX');
const maestroArgumentPrefix = executableArgumentPrefix === null ? [] : [executableArgumentPrefix];
const version = spawnSync(executable, [...maestroArgumentPrefix, '--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
  fail('Could not start Maestro CLI. Install Maestro and ensure it is on PATH.');
}

const junitDirectory = join(evidenceDirectory, 'junit');
const maestroTestOutputDirectory = relative(projectRoot, evidenceDirectory) || '.';
try {
  await mkdir(junitDirectory, { recursive: true });
  await access(evidenceDirectory, constants.W_OK);
} catch {
  fail('E2E_EVIDENCE_DIR must be a writable directory.');
}

for (const scenario of selectedScenarios) {
  const junitPath = join(junitDirectory, `${scenario.id}.xml`);
  const names = requiredEnvironmentNames(scenario, platform);
  const runnerOnlyNames = runnerOnlyEnvironmentNames(scenario);
  const environmentArguments = [
    '-e', `APP_ID=${appId}`,
    '-e', `E2E_EVIDENCE_DIR=${evidenceDirectory}`,
    ...names
      .filter((name) => !runnerOnlyNames.has(name))
      .flatMap((name) => ['-e', `${name}=${process.env[name]}`])
  ];
  const result = spawnSync(
    executable,
    [
      ...maestroArgumentPrefix,
      `--platform=${platform}`,
      'test',
      '--format',
      'junit',
      '--output',
      junitPath,
      `--test-output-dir=${maestroTestOutputDirectory}`,
      ...environmentArguments,
      join(maestroRoot, scenario.flow)
    ],
    {
      cwd: projectRoot,
      stdio: 'inherit'
    }
  );

  if (result.error || result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!(await fileExists(junitPath)) || (await stat(junitPath)).size === 0) {
    fail(`Maestro did not produce JUnit evidence for ${scenario.id}.`);
  }
  if (!(await hasScreenshotEvidence(evidenceDirectory, scenario.id))) {
    fail(`Maestro did not produce screenshot evidence for ${scenario.id}.`);
  }
  if (externalEvidenceNames(scenario, platform).length > 0) {
    const runId = nonEmptyEnvironmentValue('E2E_RUN_ID');
    if (runId === null) {
      fail(`Scenario ${scenario.id} did not retain E2E_RUN_ID for external evidence.`);
    }
    await verifyExternalEvidence(scenario, platform, runId);
  }
}
