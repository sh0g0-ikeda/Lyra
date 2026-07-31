import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { EpisodeExportArtifactBuilder } from '../../../../src/services/export/EpisodeExportArtifactBuilder.js';

describe('EpisodeExportArtifactBuilder', () => {
  it('指定順の画像を決定的なPDFへ変換する', async () => {
    const first = await buildImage('png', 40, 60, '#cc0000');
    const second = await buildImage('webp', 60, 40, '#0000cc');
    const builder = new EpisodeExportArtifactBuilder();
    const input = {
      format: 'pdf' as const,
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      pages: [
        buildPage(2, first, 'image/png'),
        buildPage(1, second, 'image/webp'),
      ],
    };

    const firstBuild = await builder.build(input);
    const secondBuild = await builder.build(input);
    const document = await PDFDocument.load(firstBuild.artifactData);

    expect(firstBuild.mimeType).toBe('application/pdf');
    expect(firstBuild.artifactData.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(document.getPageCount()).toBe(2);
    expect(secondBuild.artifactData.equals(firstBuild.artifactData)).toBe(true);
  });

  it('画像を再圧縮せず固定日時・server filenameの決定的なZIPへ格納する', async () => {
    const first = await buildImage('png', 12, 12, '#00cc00');
    const second = await buildImage('jpeg', 12, 12, '#cccc00');
    const builder = new EpisodeExportArtifactBuilder();
    const input = {
      format: 'zip' as const,
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      pages: [
        buildPage(2, first, 'image/png'),
        buildPage(10, second, 'image/jpeg'),
      ],
    };

    const firstBuild = await builder.build(input);
    const secondBuild = await builder.build(input);
    const entries = unzipSync(firstBuild.artifactData);

    expect(firstBuild.mimeType).toBe('application/zip');
    expect(firstBuild.artifactData.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(Object.keys(entries)).toEqual(['page-0002.png', 'page-0010.jpeg']);
    expect(Buffer.from(entries['page-0002.png'] ?? []).equals(first)).toBe(true);
    expect(Buffer.from(entries['page-0010.jpeg'] ?? []).equals(second)).toBe(true);
    expect(secondBuild.artifactData.equals(firstBuild.artifactData)).toBe(true);
  });

  it('壊れた画像・pixel上限・artifact上限を安全な永続化エラーにする', async () => {
    const invalidBuilder = new EpisodeExportArtifactBuilder();
    await expect(invalidBuilder.build({
      format: 'pdf',
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      pages: [buildPage(1, Buffer.from('not-an-image'), 'image/png')],
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });

    const largeImage = await buildImage('png', 10, 10, '#000000');
    const pixelBoundBuilder = new EpisodeExportArtifactBuilder({
      maxInputPixels: 50,
    });
    await expect(pixelBoundBuilder.build({
      format: 'pdf',
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      pages: [buildPage(1, largeImage, 'image/png')],
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });

    const artifactBoundBuilder = new EpisodeExportArtifactBuilder({
      maxArtifactBytes: 32,
    });
    await expect(artifactBoundBuilder.build({
      format: 'zip',
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      pages: [buildPage(1, largeImage, 'image/png')],
    })).rejects.toMatchObject({
      code: 'EXPORT_ARTIFACT_TOO_LARGE',
      retryable: false,
    });
  });
});

function buildPage(
  pageNumber: number,
  imageData: Buffer,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
): {
  pageId: string;
  pageNumber: number;
  imageData: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
} {
  return {
    pageId: `page-${pageNumber}`,
    pageNumber,
    imageData,
    mimeType,
  };
}

async function buildImage(
  format: 'png' | 'jpeg' | 'webp',
  width: number,
  height: number,
  background: string,
): Promise<Buffer> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  });
  if (format === 'jpeg') {
    return image.jpeg().toBuffer();
  }
  if (format === 'webp') {
    return image.webp().toBuffer();
  }
  return image.png().toBuffer();
}
