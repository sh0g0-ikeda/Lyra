import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

// A tab from the previous release can import these modules long after loading
// its HTML. Keep its verified bytes alongside the new release's hashed files.
const build = process.argv[2] === '--for-build';
if (build) {
  const origin = process.env.VITE_API_BASE_URL || 'https://app.lyra-editor.com';
  if (origin !== 'https://app.lyra-editor.com' || process.env.VITE_COGNITO_CLIENT_ID !== '6b2h941o888u2l7ejhv5jog94') {
    process.exit(0);
  }
}
const archive = new URL('../released-assets/', import.meta.url);
const { assets } = JSON.parse(await readFile(new URL('manifest.json', archive), 'utf8'));
const output = resolve(build ? 'dist/assets' : process.argv[2] ?? 'dist/assets');
await mkdir(output, { recursive: true });
for (const [filename, expected] of Object.entries(assets)) {
  if (!/^[\w.-]+\.(js|css)$/u.test(filename)) throw new Error('Invalid asset filename');
  const bytes = gunzipSync(await readFile(new URL(filename + '.gz', archive)));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error('Released asset checksum mismatch: ' + filename);
  }
  const target = join(output, filename);
  try {
    await writeFile(target, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await readFile(target)).equals(bytes)) throw error;
  }
}
