/*
 * Spec §8/§10 design: prepare a reviewable, local-only CloudFormation body.
 * The utility parses before compacting, preserves JSON values exactly, and never
 * sends the body or prints it. Explicit output plus wx prevents overwrites.
 */
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_TEMPLATE_BODY_BYTES = 51_200;

function fail(code) { throw new Error(code); }

export function compactCloudFormationTemplate(source) {
  let parsed;
  try { parsed = JSON.parse(source); } catch { fail('INVALID_TEMPLATE_JSON'); }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object' || parsed.Resources === null || Array.isArray(parsed.Resources) || typeof parsed.Resources !== 'object') fail('INVALID_TEMPLATE_OBJECT');
  const body = JSON.stringify(parsed);
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_TEMPLATE_BODY_BYTES) fail('COMPACT_TEMPLATE_TOO_LARGE');
  return { body, bytes };
}

function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output' || !argv[1] || !argv[3]) fail('USAGE_REQUIRED');
  const input = path.resolve(argv[1]); const output = path.resolve(argv[3]);
  if (input === output) fail('INPUT_OUTPUT_PATH_CONFLICT');
  return { input, output };
}

async function assertMissing(output) {
  try { await access(output, fsConstants.F_OK); fail('OUTPUT_ALREADY_EXISTS'); }
  catch (error) { if (error?.message === 'OUTPUT_ALREADY_EXISTS') throw error; if (error?.code !== 'ENOENT') fail('OUTPUT_PATH_UNAVAILABLE'); }
}

export async function runCli(argv) {
  const { input, output } = parseArguments(argv);
  await assertMissing(output);
  let source;
  try { source = await readFile(input, 'utf8'); } catch { fail('INPUT_READ_FAILED'); }
  const { body, bytes } = compactCloudFormationTemplate(source);
  try { await writeFile(output, body, { flag: 'wx' }); } catch (error) { if (error?.code === 'EEXIST') fail('OUTPUT_ALREADY_EXISTS'); fail('OUTPUT_WRITE_FAILED'); }
  return { path: output, bytes, sha256: createHash('sha256').update(body).digest('hex') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then((receipt) => console.log(JSON.stringify(receipt))).catch((error) => { console.error(error.message === 'OUTPUT_ALREADY_EXISTS' || error.message === 'INPUT_OUTPUT_PATH_CONFLICT' || error.message === 'USAGE_REQUIRED' || error.message === 'INPUT_READ_FAILED' || error.message === 'OUTPUT_WRITE_FAILED' || error.message === 'OUTPUT_PATH_UNAVAILABLE' || error.message === 'INVALID_TEMPLATE_JSON' || error.message === 'INVALID_TEMPLATE_OBJECT' || error.message === 'COMPACT_TEMPLATE_TOO_LARGE' ? error.message : 'COMPACT_TEMPLATE_FAILED'); process.exitCode = 1; });
}
