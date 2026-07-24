import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const generatedHeader =
  '// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.\n';

const contractFiles = [
  ['mobileApiSchemas.ts', 'apiSchemas.ts'],
  ['mobileApiTypes.ts', 'types.ts'],
  ['mobileApiPayloads.ts', 'payloads.ts'],
] as const;

describe('Mobile shared API contract generation', () => {
  it.each(contractFiles)(
    '%s から Mobile の %s がbyte-stableに生成されている',
    async (canonicalFilename, generatedFilename) => {
      const canonical = await readFile(
        join(process.cwd(), 'packages', 'api-contract', 'src', canonicalFilename),
        'utf8',
      );
      const generated = await readFile(
        join(process.cwd(), 'apps', 'mobile', 'src', 'domain', generatedFilename),
        'utf8',
      );

      expect(generated).toBe(`${generatedHeader}${canonical}`);
    },
  );

  it('generatorはwriteとcheckを明示的に分離する', async () => {
    const generator = await readFile(
      join(process.cwd(), 'scripts', 'generateMobileApiContract.mjs'),
      'utf8',
    );
    expect(generator).toContain("'--check'");
    expect(generator).toContain('process.exitCode = 1');
    expect(generator).toContain('GENERATED FILE');
  });
});
