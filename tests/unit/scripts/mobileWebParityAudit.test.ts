import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { auditMobileWebParity } from '../../../scripts/auditMobileWebParity.mjs';

const projectRoot = resolve(import.meta.dirname, '../../..');
const inventoryPath = resolve(
  projectRoot,
  'docs/mobile-web-parity-inventory.md',
);

const requiredWebRequirements = [
  'full story input',
  'optional scene',
  'story hierarchy',
  'character free description/import/preview/confirm',
  'page style reference',
  'page provenance',
  'layout reading order/preview',
  'panel reorder/delete',
  'generation blocker messages',
  'personal/org billing separation',
  'jobs/credits/tutorial',
] as const;

describe('Mobile Web parity audit', () => {
  it('Audit Cの全要件を実装・検証パス付きで生成しdriftを拒否する', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/auditMobileWebParity.mjs', '--check'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const inventory = readFileSync(inventoryPath, 'utf8');
    for (const requirement of requiredWebRequirements) {
      expect(inventory).toContain(`| ${requirement} |`);
    }
    expect(inventory).toContain('Unclassified requirements: 0');
    expect(inventory).toContain('| Web implementation evidence |');
    expect(inventory).toContain('| Mobile implementation evidence |');
    expect(inventory).toContain('| Shared contract / intentional Mobile difference |');
    expect(inventory).toContain('| Verification evidence |');
  });

  it('証拠マーカーが実装から欠落した場合にAudit Cを失敗させる', () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'lyra-mobile-web-parity-'));
    try {
      writeFileSync(resolve(fixtureRoot, 'spec.md'), '### Audit C\n\n- fixture requirement\n\n### Audit D\n', 'utf8');
      writeFileSync(resolve(fixtureRoot, 'web.ts'), 'export const webMarker = true;\n', 'utf8');
      writeFileSync(resolve(fixtureRoot, 'mobile.ts'), 'export const mobileMarker = true;\n', 'utf8');
      writeFileSync(resolve(fixtureRoot, 'contract.ts'), 'export const contractMarker = true;\n', 'utf8');
      writeFileSync(resolve(fixtureRoot, 'verification.ts'), 'export const verificationMarker = true;\n', 'utf8');

      expect(() => auditMobileWebParity({
        projectRoot: fixtureRoot,
        specPath: 'spec.md',
        requirements: [{
          requirement: 'fixture requirement',
          behavior: 'fixture',
          web: [{ path: 'web.ts', markers: ['missing web marker'] }],
          mobile: [{ path: 'mobile.ts', markers: ['mobileMarker'] }],
          contract: {
            kind: 'shared',
            web: [{ path: 'contract.ts', markers: ['contractMarker'] }],
            mobile: [{ path: 'contract.ts', markers: ['contractMarker'] }]
          },
          verification: [{ path: 'verification.ts', markers: ['verificationMarker'] }]
        }]
      })).toThrow('missing web marker');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('証拠パスが欠落した場合にAudit Cを失敗させる', () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'lyra-mobile-web-parity-'));
    try {
      writeFileSync(resolve(fixtureRoot, 'spec.md'), '### Audit C\n\n- fixture requirement\n\n### Audit D\n', 'utf8');

      expect(() => auditMobileWebParity({
        projectRoot: fixtureRoot,
        specPath: 'spec.md',
        requirements: [{
          requirement: 'fixture requirement',
          behavior: 'fixture',
          web: [{ path: 'missing-web.ts', markers: ['webMarker'] }],
          mobile: [{ path: 'spec.md', markers: ['fixture requirement'] }],
          contract: { kind: 'intentional-mobile-difference', reason: 'fixture difference' },
          verification: [{ path: 'spec.md', markers: ['fixture requirement'] }]
        }]
      })).toThrow('missing path missing-web.ts');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('仕様のAudit C要件と監査定義がずれた場合に失敗させる', () => {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'lyra-mobile-web-parity-'));
    try {
      writeFileSync(resolve(fixtureRoot, 'spec.md'), '### Audit C\n\n- fixture requirement\n- unclassified fixture requirement\n\n### Audit D\n', 'utf8');

      expect(() => auditMobileWebParity({
        projectRoot: fixtureRoot,
        specPath: 'spec.md',
        requirements: [{
          requirement: 'fixture requirement',
          behavior: 'fixture',
          web: [{ path: 'spec.md', markers: ['fixture requirement'] }],
          mobile: [{ path: 'spec.md', markers: ['fixture requirement'] }],
          contract: { kind: 'difference', reason: 'fixture difference' },
          verification: [{ path: 'spec.md', markers: ['fixture requirement'] }]
        }]
      })).toThrow('Unclassified Audit C requirements: unclassified fixture requirement');
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});
