import { spawnSync } from 'node:child_process';

const result = spawnSync('bun', ['run', '--cwd', 'apps/web', 'build'], {
  env: {
    ...process.env,
    LYRA_STRICT_WEB_PRODUCTION_CONFIG: 'true',
  },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error !== undefined) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
