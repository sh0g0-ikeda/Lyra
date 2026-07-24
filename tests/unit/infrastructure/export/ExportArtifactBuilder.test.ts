import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PdfExportArtifactBuilder, ZipExportArtifactBuilder } from '../../../../src/infrastructure/export/ExportArtifactBuilder.js';

async function createTinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
}

describe('export artifact builders', () => {
  it('builds a bounded PDF artifact from server-side image bytes', async () => {
    const artifact = await new PdfExportArtifactBuilder().build([{ pageId: 'page-1', imageData: await createTinyPng(), mimeType: 'image/png' }]);

    expect(artifact.mimeType).toBe('application/pdf');
    expect(artifact.data.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(artifact.data.length).toBeGreaterThan(100);
  });

  it('builds a ZIP with safe page filenames', async () => {
    const artifact = await new ZipExportArtifactBuilder().build([{ pageId: 'page-1', imageData: await createTinyPng(), mimeType: 'image/png' }]);

    expect(artifact.mimeType).toBe('application/zip');
    expect(artifact.data.subarray(0, 4).toString('binary')).toBe('PK\u0003\u0004');
    expect(artifact.data.toString('utf8')).toContain('page-001.png');
  });

  it('rejects a source batch above the bounded total before assembling a ZIP', async () => {
    const source = Buffer.alloc(4);
    const sources = Array.from({ length: 3 }, (_value, index) => ({ pageId: `page-${index}`, imageData: source, mimeType: 'image/png' as const }));

    await expect(new ZipExportArtifactBuilder({ maxTotalSourceBytes: 8 }).build(sources)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('converts PDF pages with bounded single-page concurrency', async () => {
    let active = 0;
    let maximumActive = 0;
    const builder = new PdfExportArtifactBuilder({ convertPage: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { jpeg: Buffer.from([0xff, 0xd8, 0xff]), width: 1, height: 1 };
    } });

    await builder.build([
      { pageId: 'page-1', imageData: Buffer.from('one'), mimeType: 'image/png' },
      { pageId: 'page-2', imageData: Buffer.from('two'), mimeType: 'image/png' },
      { pageId: 'page-3', imageData: Buffer.from('three'), mimeType: 'image/png' },
    ]);

    expect(maximumActive).toBe(1);
  });

  it('PDF変換済み画像の累積サイズが上限を超えた時点で後続ページを保持しない', async () => {
    let conversionCount = 0;
    const builder = new PdfExportArtifactBuilder({
      maxArtifactBytes: 5,
      convertPage: async () => {
        conversionCount += 1;
        return { jpeg: Buffer.from([0xff, 0xd8, 0xff]), width: 1, height: 1 };
      },
    });

    await expect(builder.build([
      { pageId: 'page-1', imageData: Buffer.from('one'), mimeType: 'image/png' },
      { pageId: 'page-2', imageData: Buffer.from('two'), mimeType: 'image/png' },
      { pageId: 'page-3', imageData: Buffer.from('three'), mimeType: 'image/png' },
    ])).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });

    expect(conversionCount).toBe(2);
  });
});
