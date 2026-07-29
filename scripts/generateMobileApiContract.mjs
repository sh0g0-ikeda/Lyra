import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const generatedHeader =
  '// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.\n';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const contractFiles = [
  ['packages/api-contract/src/mobileApiSchemas.ts', 'apps/mobile/src/domain/apiSchemas.ts'],
  ['packages/api-contract/src/mobileApiTypes.ts', 'apps/mobile/src/domain/types.ts'],
  ['packages/api-contract/src/mobileApiPayloads.ts', 'apps/mobile/src/domain/payloads.ts'],
];

const normalizeNewlines = (content) => content.replace(/\r\n?/g, '\n');
const relativePath = (path) => relative(projectRoot, path).replaceAll('\\', '/');

const checkOnly = process.argv.slice(2).includes('--check');

for (const [canonicalRelativePath, generatedRelativePath] of contractFiles) {
  const canonicalPath = resolve(projectRoot, canonicalRelativePath);
  const generatedPath = resolve(projectRoot, generatedRelativePath);
  const canonical = normalizeNewlines(await readFile(canonicalPath, 'utf8'));
  const expected = `${generatedHeader}${canonical}`;

  if (!checkOnly) {
    await writeFile(generatedPath, expected, 'utf8');
    continue;
  }

  let generated;
  try {
    generated = await readFile(generatedPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.error(`generated file is missing: ${relativePath(generatedPath)}`);
      process.exitCode = 1;
      continue;
    }
    throw error;
  }

  if (generated !== expected) {
    console.error(`generated file is stale: ${relativePath(generatedPath)}`);
    process.exitCode = 1;
  }
}
