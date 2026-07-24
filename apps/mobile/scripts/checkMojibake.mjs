import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkerFile = fileURLToPath(import.meta.url);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ignoredDirectories = new Set(['.expo', 'dist', 'node_modules']);
const checkedExtensions = new Set(['.js', '.json', '.md', '.mjs', '.ts', '.tsx']);
const mojibakePattern = /\uFFFD|縺|繧|蜿|謇|譁|莠|迚|髫|蛟倶|豕穂/u;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await collectFiles(join(directory, entry.name))));
      }
      continue;
    }

    if (checkedExtensions.has(extname(entry.name))) {
      files.push(join(directory, entry.name));
    }
  }

  return files;
}

const failures = [];
for (const file of await collectFiles(projectRoot)) {
  if (file === checkerFile) {
    continue;
  }

  const lines = (await readFile(file, 'utf8')).split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (mojibakePattern.test(line)) {
      failures.push(`${relative(projectRoot, file)}:${index + 1}`);
    }
  });
}

if (failures.length > 0) {
  console.error('Mojibake-like text was found:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log('Mojibake check passed.');
}
