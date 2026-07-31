import { zipSync } from 'fflate';
import { PDFDocument, PageSizes } from 'pdf-lib';
import sharp from 'sharp';
import {
  EPISODE_EXPORT_MAX_ARTIFACT_BYTES,
  EPISODE_EXPORT_MAX_PAGE_COUNT,
  type EpisodeExportFormat,
  type EpisodeExportImageMimeType,
} from '../../domain/episodeExportJob.js';
import {
  EPISODE_EXPORT_IMAGE_DECODE_TIMEOUT_SECONDS,
  EPISODE_EXPORT_MAX_INPUT_PIXELS,
  EpisodeExportProcessingError,
  assertEpisodeExportSourceImage,
  episodeExportArtifactMimeType,
  isEpisodeExportProcessingError,
  type EpisodeExportArtifactMimeType,
} from '../../domain/episodeExportProcessing.js';

export interface EpisodeExportArtifactPage {
  pageId: string;
  pageNumber: number;
  imageData: Buffer;
  mimeType: EpisodeExportImageMimeType;
}

export interface BuildEpisodeExportArtifactInput {
  format: EpisodeExportFormat;
  createdAt: Date;
  pages: EpisodeExportArtifactPage[];
  onPageProcessed?: (
    completedCount: number,
    totalCount: number,
  ) => Promise<void>;
}

export interface BuiltEpisodeExportArtifact {
  artifactData: Buffer;
  mimeType: EpisodeExportArtifactMimeType;
}

export interface EpisodeExportArtifactBuilderPort {
  build(
    input: BuildEpisodeExportArtifactInput,
  ): Promise<BuiltEpisodeExportArtifact>;
}

export interface EpisodeExportArtifactBuilderOptions {
  maxArtifactBytes?: number;
  maxInputPixels?: number;
  imageDecodeTimeoutSeconds?: number;
}

const ZIP_ENTRY_TIME = new Date(1980, 0, 1, 0, 0, 0);

export class EpisodeExportArtifactBuilder
implements EpisodeExportArtifactBuilderPort {
  private readonly maxArtifactBytes: number;
  private readonly maxInputPixels: number;
  private readonly imageDecodeTimeoutSeconds: number;

  public constructor(options: EpisodeExportArtifactBuilderOptions = {}) {
    this.maxArtifactBytes = boundedInteger(
      options.maxArtifactBytes ?? EPISODE_EXPORT_MAX_ARTIFACT_BYTES,
      1,
      EPISODE_EXPORT_MAX_ARTIFACT_BYTES,
      'Episode export artifact size configuration is invalid',
    );
    this.maxInputPixels = boundedInteger(
      options.maxInputPixels ?? EPISODE_EXPORT_MAX_INPUT_PIXELS,
      1,
      EPISODE_EXPORT_MAX_INPUT_PIXELS,
      'Episode export pixel configuration is invalid',
    );
    this.imageDecodeTimeoutSeconds = boundedInteger(
      options.imageDecodeTimeoutSeconds
        ?? EPISODE_EXPORT_IMAGE_DECODE_TIMEOUT_SECONDS,
      1,
      60,
      'Episode export image timeout configuration is invalid',
    );
  }

  public async build(
    input: BuildEpisodeExportArtifactInput,
  ): Promise<BuiltEpisodeExportArtifact> {
    if (
      input.pages.length < 1
      || input.pages.length > EPISODE_EXPORT_MAX_PAGE_COUNT
      || Number.isNaN(input.createdAt.getTime())
    ) {
      throw new EpisodeExportProcessingError(
        'EXPORT_SOURCE_INVALID',
        'One or more page images are unavailable for export',
        false,
      );
    }

    const artifactData = input.format === 'pdf'
      ? await this.buildPdf(input)
      : await this.buildZip(input);
    if (
      artifactData.length < 1
      || artifactData.length > this.maxArtifactBytes
    ) {
      throw new EpisodeExportProcessingError(
        'EXPORT_ARTIFACT_TOO_LARGE',
        'The episode export artifact exceeds the allowed size',
        false,
      );
    }
    return {
      artifactData,
      mimeType: episodeExportArtifactMimeType(input.format),
    };
  }

  private async buildPdf(
    input: BuildEpisodeExportArtifactInput,
  ): Promise<Buffer> {
    const document = await PDFDocument.create({ updateMetadata: false });
    document.setCreator('Lyra');
    document.setProducer('Lyra');
    document.setCreationDate(input.createdAt);
    document.setModificationDate(input.createdAt);

    for (let index = 0; index < input.pages.length; index += 1) {
      const source = input.pages[index];
      if (source === undefined) {
        throw new EpisodeExportProcessingError(
          'EXPORT_SOURCE_INVALID',
          'One or more page images are unavailable for export',
          false,
        );
      }
      assertEpisodeExportSourceImage(
        sourceKeyForValidation(source),
        source.mimeType,
        source.imageData,
      );

      try {
        const converted = await sharp(source.imageData, {
          failOn: 'error',
          limitInputPixels: this.maxInputPixels,
        })
          .rotate()
          .timeout({ seconds: this.imageDecodeTimeoutSeconds })
          .jpeg({
            quality: 90,
            progressive: false,
            mozjpeg: false,
          })
          .toBuffer({ resolveWithObject: true });
        const embedded = await document.embedJpg(converted.data);
        const portrait = converted.info.height >= converted.info.width;
        const [a4Width, a4Height] = PageSizes.A4;
        const pageWidth = portrait ? a4Width : a4Height;
        const pageHeight = portrait ? a4Height : a4Width;
        const page = document.addPage([pageWidth, pageHeight]);
        const fitted = embedded.scaleToFit(pageWidth, pageHeight);
        page.drawImage(embedded, {
          x: (pageWidth - fitted.width) / 2,
          y: (pageHeight - fitted.height) / 2,
          width: fitted.width,
          height: fitted.height,
        });
      } catch (error) {
        if (isEpisodeExportProcessingError(error)) {
          throw error;
        }
        throw new EpisodeExportProcessingError(
          'EXPORT_SOURCE_INVALID',
          'One or more page images are unavailable for export',
          false,
        );
      }
      await input.onPageProcessed?.(index + 1, input.pages.length);
    }

    try {
      return Buffer.from(await document.save({
        addDefaultPage: false,
        useObjectStreams: false,
        updateFieldAppearances: false,
      }));
    } catch {
      throw new EpisodeExportProcessingError(
        'EXPORT_BUILD_FAILED',
        'The episode export artifact could not be created',
        false,
      );
    }
  }

  private async buildZip(
    input: BuildEpisodeExportArtifactInput,
  ): Promise<Buffer> {
    const entries: Record<string, Uint8Array> = {};
    for (let index = 0; index < input.pages.length; index += 1) {
      const source = input.pages[index];
      if (source === undefined) {
        throw new EpisodeExportProcessingError(
          'EXPORT_SOURCE_INVALID',
          'One or more page images are unavailable for export',
          false,
        );
      }
      assertEpisodeExportSourceImage(
        sourceKeyForValidation(source),
        source.mimeType,
        source.imageData,
      );
      const filename =
        `page-${String(source.pageNumber).padStart(4, '0')}.${extensionForMimeType(source.mimeType)}`;
      if (entries[filename] !== undefined) {
        throw new EpisodeExportProcessingError(
          'EXPORT_SOURCE_INVALID',
          'One or more page images are unavailable for export',
          false,
        );
      }
      entries[filename] = source.imageData;
      await input.onPageProcessed?.(index + 1, input.pages.length);
    }

    try {
      return Buffer.from(zipSync(entries, {
        level: 0,
        mtime: ZIP_ENTRY_TIME,
      }));
    } catch {
      throw new EpisodeExportProcessingError(
        'EXPORT_BUILD_FAILED',
        'The episode export artifact could not be created',
        false,
      );
    }
  }
}

function sourceKeyForValidation(page: EpisodeExportArtifactPage): string {
  return `page/${page.pageId}.${extensionForMimeType(page.mimeType)}`;
}

function extensionForMimeType(
  mimeType: EpisodeExportImageMimeType,
): 'png' | 'jpeg' | 'webp' {
  if (mimeType === 'image/jpeg') {
    return 'jpeg';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  return 'png';
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  message: string,
): number {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(message);
  }
  return value;
}
