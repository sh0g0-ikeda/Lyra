import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildWebDeployEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    LYRA_STRICT_WEB_PRODUCTION_CONFIG: 'true',
    VITE_SUPABASE_URL: baseEnv.VITE_SUPABASE_URL ?? '',
    VITE_SUPABASE_ANON_KEY: baseEnv.VITE_SUPABASE_ANON_KEY ?? '',
  };
}

export function runWebDeployBuild(): number {
  const result = spawnSync('bun', ['run', '--cwd', 'apps/web', 'build'], {
    env: buildWebDeployEnv(),
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runWebDeployBuild());
}
