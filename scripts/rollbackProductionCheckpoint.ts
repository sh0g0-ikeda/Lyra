import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AwsCliProductionRollbackCloud,
  ExecFileAwsCliRunner,
  FileRollbackReceiptStore,
} from '../src/ops/AwsCliProductionRollbackCloud.js';
import { parseRollbackManifest, RollbackSafetyError } from '../src/ops/ProductionRollback.js';
import { parseProductionRollbackCliArgs } from '../src/ops/ProductionRollbackCli.js';
import { runProductionRollback } from '../src/ops/ProductionRollbackOrchestrator.js';

const manifestPath = join(
  process.cwd(),
  'ops',
  'rollback',
  'checkpoints',
  '2026-07-14T1500-jst.json',
);

try {
  const options = parseProductionRollbackCliArgs(process.argv.slice(2), process.env);
  const manifest = parseRollbackManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
  const awsCliPath = resolveAwsCliExecutable(options.awsCliPath);
  const runner = new ExecFileAwsCliRunner({
    executable: awsCliPath,
    profile: options.profile,
    region: manifest.aws.region,
  });
  const cloud = new AwsCliProductionRollbackCloud({
    runner,
    manifest,
    log: (message) => console.log(`[rollback] ${message}`),
  });

  console.log(
    options.apply
      ? `[rollback] ${manifest.checkpointId} を本番へ適用します。`
      : `[rollback] ${manifest.checkpointId} のdry-runです。AWS runtimeは切り替えません。`,
  );
  const result = await runProductionRollback({
    manifest,
    options: {
      apply: options.apply,
      confirmation: options.confirmation,
    },
    cloud,
    receiptStore: new FileRollbackReceiptStore(),
  });

  if (result.mode === 'dry-run') {
    console.log('[rollback] 前提条件を通過しました。適用予定工程:');
    for (const action of result.actions) {
      console.log(`  - ${action.kind}`);
    }
    console.log(
      `[rollback] 適用する場合: npm run prod:rollback:20260714 -- --apply --profile ${options.profile} --confirm ${manifest.confirmationToken}`,
    );
  } else {
    console.log(`[rollback] 適用完了。切替前receipt: ${result.receiptPath}`);
  }
} catch (error) {
  const message =
    error instanceof RollbackSafetyError || error instanceof Error
      ? error.message
      : 'Unknown rollback error';
  console.error(`[rollback] 中止: ${message}`);
  process.exitCode = 1;
}

function resolveAwsCliExecutable(configuredPath: string | undefined): string {
  if (configuredPath !== undefined) {
    return configuredPath;
  }
  const windowsDefault = 'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe';
  if (process.platform === 'win32' && existsSync(windowsDefault)) {
    return windowsDefault;
  }
  return 'aws';
}
