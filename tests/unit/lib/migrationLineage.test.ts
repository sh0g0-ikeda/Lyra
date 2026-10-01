import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMigrationOptions, PRODUCTION_BRIDGE_QUIESCENCE_FLAG } from '../../../scripts/migrationOptions.js';
import { extractNamedChecks } from '../../../src/lib/migrationLineage.js';
describe('production lineage constraint parser', () => {
    it('引用内の括弧とSQLの二重引用符を壊さず名前付きCHECKだけ読む', () => {
        const source = "CREATE TABLE x (a TEXT, CONSTRAINT x_shape CHECK (a ~ '^a[(]b[)]$' AND a <> 'it''s'), UNIQUE(a)); ALTER TABLE x ADD CONSTRAINT x_len CHECK (char_length(a)>0) NOT VALID;";
        expect(extractNamedChecks(source)).toEqual([
            { name: 'x_shape', expression: "a ~ '^a[(]b[)]$' AND a <> 'it''s'" },
            { name: 'x_len', expression: 'char_length(a)>0' },
        ]);
    });
    it('閉じていないCHECKは実行せず拒否する', () => {
        expect(() => extractNamedChecks('CONSTRAINT bad CHECK ((a>0)')).toThrow();
    });
});
describe('migration operator opt-in', () => {
    it('通常実行はbridgeを許可せず明示flagだけを許可する', () => {
        expect(parseMigrationOptions([])).toEqual({ allowProductionLineageBridge: false });
        expect(parseMigrationOptions([PRODUCTION_BRIDGE_QUIESCENCE_FLAG])).toEqual({ allowProductionLineageBridge: true });
        expect(() => parseMigrationOptions(['--force'])).toThrow();
        expect(() => parseMigrationOptions([PRODUCTION_BRIDGE_QUIESCENCE_FLAG, PRODUCTION_BRIDGE_QUIESCENCE_FLAG])).toThrow();
    });
});
describe('production SQL fixture provenance', () => {
    it('固定した本番revisionのSQL名とdigestが全て一致する', async () => {
        const directory = join(process.cwd(), 'tests/fixtures/production-lineage-2debe');
        const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as {
            source_revision: string;
            files: Record<string, string>;
        };
        expect(manifest.source_revision).toBe('2debe8c3c22633ed077e7b189ddcfa8b209a00dc');
        expect((await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()).toEqual(Object.keys(manifest.files).sort());
        for (const [name, digest] of Object.entries(manifest.files))
            expect(createHash('sha256').update(await readFile(join(directory, name))).digest('hex')).toBe(digest);
    });
});
