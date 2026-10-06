import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { compactCloudFormationTemplate } from './compact-template.mjs';

const run = promisify(execFile);
const taskRoot = path.resolve('C:/Users/shogo/Lyra/.tmp/codex-completion-20261002/compact-template-tests');
const utility = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//u, ''), 'compact-template.mjs');

function assertFixturePath(candidate) {
  const resolved = path.resolve(candidate);
  assert.ok(resolved.startsWith(`${taskRoot}${path.sep}`), 'fixture must remain inside TaskRoot');
  return resolved;
}

async function fixture() {
  await mkdir(taskRoot, { recursive: true });
  return assertFixturePath(await mkdtemp(path.join(taskRoot, 'compact-')));
}

async function removeFixture(directory) {
  await rm(assertFixturePath(directory), { recursive: true, force: true });
}

test('空白を除去してJSON同値のCloudFormation bodyにする', () => {
  const source = '{\n  "Resources": { "Example": { "Type": "AWS::S3::Bucket" } },\n  "Description": "fixture"\n}\n';
  const compact = compactCloudFormationTemplate(source);
  assert.deepEqual(JSON.parse(compact.body), JSON.parse(source));
  assert.equal(compact.body.includes('\n'), false);
  assert.equal(compact.bytes, Buffer.byteLength(compact.body));
});

test('文字列中の改行と空白を保持する', () => {
  const source = '{ "Resources": {}, "Description": "line one\\n line two   " }';
  const compact = compactCloudFormationTemplate(source);
  assert.equal(JSON.parse(compact.body).Description, 'line one\n line two   ');
});

for (const [name, source, code] of [
  ['壊れたJSON', '{"Resources":', 'INVALID_TEMPLATE_JSON'],
  ['配列', '[]', 'INVALID_TEMPLATE_OBJECT'],
  ['Resourcesがないobject', '{"Description":"x"}', 'INVALID_TEMPLATE_OBJECT'],
  ['compact後も上限超過', JSON.stringify({ Resources: {}, Description: 'x'.repeat(51_201) }), 'COMPACT_TEMPLATE_TOO_LARGE'],
]) {
  test(`${name}を固定エラーで拒否する`, () => assert.throws(() => compactCloudFormationTemplate(source), new RegExp(code)));
}

test('CLIはreceiptだけをstdoutへ出し既存outputを上書きしない', async () => {
  const directory = await fixture();
  const input = path.join(directory, 'runtime.json');
  const output = path.join(directory, 'runtime.compact.json');
  try {
    await writeFile(input, '{\n "Resources": {}, "Description": "safe"\n}\n');
    const first = await run(process.execPath, [utility, '--input', input, '--output', output], { timeout: 5000 });
    const receipt = JSON.parse(first.stdout);
    assert.deepEqual(Object.keys(receipt).sort(), ['bytes', 'path', 'sha256']);
    assert.equal(receipt.path, path.resolve(output));
    assert.equal(first.stdout.includes('"Resources"'), false);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).Description, 'safe');
    await assert.rejects(() => run(process.execPath, [utility, '--input', input, '--output', output], { timeout: 5000 }), /OUTPUT_ALREADY_EXISTS/);
    assert.equal(existsSync(output), true);
  } finally { await removeFixture(directory); }
});
