import { describe, expect, it } from 'vitest';
import {
  MAX_EXPORT_ARTIFACT_BYTES,
  MAX_EXPORT_PAGE_COUNT,
  MAX_EXPORT_SOURCE_IMAGE_BYTES,
  MAX_EXPORT_TOTAL_SOURCE_BYTES,
  normalizeExportFilename,
} from '../../../src/domain/exportJob.js';

describe('export filename normalization', () => {
  it('prevents traversal and supplies a format extension', () => {
    expect(normalizeExportFilename('../../release/scene', 'pdf')).toBe('scene.pdf');
    expect(normalizeExportFilename('  ', 'zip')).toBe('lyra-export.zip');
  });

  it('removes unsafe filename characters and bounds the result', () => {
    const filename = normalizeExportFilename('my:story?.PDF', 'pdf');
    expect(filename).toBe('my-story-.pdf');
    expect(filename).not.toContain('/');
    expect(filename).not.toContain('\\');
  });

  it('bounds total source bytes below the theoretical per-page maximum', () => {
    expect(MAX_EXPORT_TOTAL_SOURCE_BYTES).toBeLessThan(MAX_EXPORT_PAGE_COUNT * MAX_EXPORT_SOURCE_IMAGE_BYTES);
    expect(MAX_EXPORT_ARTIFACT_BYTES).toBeLessThanOrEqual(MAX_EXPORT_TOTAL_SOURCE_BYTES * 2);
  });
});
