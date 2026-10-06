import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The existing Bun lock is the production dependency authority. Keep npm's
// manifest and the credential-provider closure complete without updating versions.
const root = new URL('../../', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const manifest = read('package.json');
const npm = read('package-lock.json');
const bun = JSON.parse(readFileSync(new URL('bun.lock', root), 'utf8').replace(/,\s*([}\]])/gu, '$1'));

test('npm lock root matches all declared runtime and development dependencies', () => {
  for (const section of ['dependencies', 'devDependencies']) {
    assert.deepEqual(npm.packages[''][section], manifest[section]);
    for (const name of Object.keys(manifest[section])) {
      assert.ok(npm.packages[`node_modules/${name}`], `missing npm package: ${name}`);
    }
  }
});

test('npm credential-provider closure retains Bun versions, integrity and dependencies', () => {
  for (const name of ['@aws-sdk/credential-providers', '@aws-sdk/client-cognito-identity', '@aws-sdk/credential-provider-cognito-identity']) {
    const [spec, , metadata, integrity] = bun.packages[name];
    const entry = npm.packages[`node_modules/${name}`];
    assert.ok(entry, `missing npm package: ${name}`);
    assert.equal(entry.version, spec.slice(name.length + 1));
    assert.equal(entry.integrity, integrity);
    assert.deepEqual(entry.dependencies, metadata.dependencies);
    for (const dependency of Object.keys(entry.dependencies)) {
      assert.ok(npm.packages[`node_modules/${dependency}`], `unresolved dependency: ${dependency}`);
    }
  }
});
