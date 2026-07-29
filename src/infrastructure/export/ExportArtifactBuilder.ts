import sharp from 'sharp';
import {
  MAX_EXPORT_ARTIFACT_BYTES,
  MAX_EXPORT_SOURCE_IMAGE_BYTES,
  MAX_EXPORT_TOTAL_SOURCE_BYTES,
  type ExportFormat,
  type ExportImageMimeType,
} from '../../domain/exportJob.js';
import { PayloadTooLargeError, ValidationError } from '../../domain/errors/index.js';

export interface ExportArtifactSource {
  pageId: string;
  imageData: Buffer;
  mimeType: ExportImageMimeType;
}

export interface BuiltExportArtifact {
  data: Buffer;
  mimeType: 'application/pdf' | 'application/zip';
  extension: ExportFormat;
}

export interface ExportArtifactBuilderPort {
  build(sources: ExportArtifactSource[]): Promise<BuiltExportArtifact>;
}

export interface ExportArtifactBuilderLimits {
  maxArtifactBytes?: number;
  maxSourceImageBytes?: number;
  maxTotalSourceBytes?: number;
}

export interface PdfPageConversionResult {
  jpeg: Buffer;
  width: number;
  height: number;
}

export interface PdfExportArtifactBuilderOptions extends ExportArtifactBuilderLimits {
  convertPage?: (source: ExportArtifactSource) => Promise<PdfPageConversionResult>;
}

export class PdfExportArtifactBuilder implements ExportArtifactBuilderPort {
  private readonly convertPage: (source: ExportArtifactSource) => Promise<PdfPageConversionResult>;

  public constructor(private readonly options: PdfExportArtifactBuilderOptions = {}) {
    this.convertPage = options.convertPage ?? toPdfPage;
  }

  public async build(sources: ExportArtifactSource[]): Promise<BuiltExportArtifact> {
    if (sources.length === 0) {
      throw new ValidationError('An export requires at least one page');
    }
    assertSourceBatchSize(sources, this.options);
    const pages: PdfPageConversionResult[] = [];
    const maxArtifactBytes = this.options.maxArtifactBytes ?? MAX_EXPORT_ARTIFACT_BYTES;
    let convertedImageBytes = 0;
    for (const source of sources) {
      const page = await this.convertPage(source);
      convertedImageBytes += page.jpeg.length;
      if (convertedImageBytes > maxArtifactBytes) {
        throw new PayloadTooLargeError('Export artifact is too large');
      }
      pages.push(page);
    }
    const objectCount = 2 + pages.length * 3;
    const objects: Buffer[] = [];
    const pageObjectIds = pages.map((_page, index) => 3 + index * 3);
    objects.push(asPdfObject(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'ascii')));
    objects.push(asPdfObject(2, Buffer.from(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`, 'ascii')));
    pages.forEach((page, index) => {
      const pageObjectId = pageObjectIds[index] as number;
      const imageObjectId = pageObjectId + 1;
      const contentObjectId = pageObjectId + 2;
      const pageBody = Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
        'ascii',
      );
      const imageHeader = Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
        'ascii',
      );
      const imageBody = Buffer.concat([imageHeader, page.jpeg, Buffer.from('\nendstream', 'ascii')]);
      const content = Buffer.from(`q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im0 Do\nQ`, 'ascii');
      objects.push(asPdfObject(pageObjectId, pageBody));
      objects.push(asPdfObject(imageObjectId, imageBody));
      objects.push(asPdfObject(contentObjectId, Buffer.from(`<< /Length ${content.length} >>\nstream\n${content.toString('ascii')}\nendstream`, 'ascii')));
    });
    const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');
    const offsets: number[] = [0];
    let cursor = header.length;
    for (const object of objects) {
      offsets.push(cursor);
      cursor += object.length + 1;
    }
    const xrefOffset = cursor;
    const xref = Buffer.from(
      `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'ascii',
    );
    const data = Buffer.concat([header, ...objects.flatMap((object) => [object, Buffer.from('\n', 'ascii')]), xref]);
    assertArtifactSize(data, maxArtifactBytes);
    return { data, mimeType: 'application/pdf', extension: 'pdf' };
  }
}

export class ZipExportArtifactBuilder implements ExportArtifactBuilderPort {
  public constructor(private readonly options: ExportArtifactBuilderLimits = {}) {}

  public async build(sources: ExportArtifactSource[]): Promise<BuiltExportArtifact> {
    if (sources.length === 0) {
      throw new ValidationError('An export requires at least one page');
    }
    assertSourceBatchSize(sources, this.options);
    const localEntries: Buffer[] = [];
    const centralEntries: Buffer[] = [];
    let offset = 0;
    sources.forEach((source, index) => {
      const filename = Buffer.from(`page-${String(index + 1).padStart(3, '0')}.${extensionForMimeType(source.mimeType)}`, 'ascii');
      const crc = crc32(source.imageData);
      const local = Buffer.concat([
        uint32le(0x04034b50), uint16le(20), uint16le(0), uint16le(0), uint16le(0), uint16le(0),
        uint32le(crc), uint32le(source.imageData.length), uint32le(source.imageData.length),
        uint16le(filename.length), uint16le(0), filename, source.imageData,
      ]);
      localEntries.push(local);
      centralEntries.push(Buffer.concat([
        uint32le(0x02014b50), uint16le(20), uint16le(20), uint16le(0), uint16le(0), uint16le(0), uint16le(0),
        uint32le(crc), uint32le(source.imageData.length), uint32le(source.imageData.length),
        uint16le(filename.length), uint16le(0), uint16le(0), uint16le(0), uint16le(0), uint32le(0), uint32le(offset), filename,
      ]));
      offset += local.length;
    });
    const centralDirectory = Buffer.concat(centralEntries);
    const end = Buffer.concat([
      uint32le(0x06054b50), uint16le(0), uint16le(0), uint16le(sources.length), uint16le(sources.length),
      uint32le(centralDirectory.length), uint32le(offset), uint16le(0),
    ]);
    const data = Buffer.concat([...localEntries, centralDirectory, end]);
    assertArtifactSize(data, this.options.maxArtifactBytes);
    return { data, mimeType: 'application/zip', extension: 'zip' };
  }
}

export function createExportArtifactBuilder(format: ExportFormat): ExportArtifactBuilderPort {
  return format === 'pdf' ? new PdfExportArtifactBuilder() : new ZipExportArtifactBuilder();
}

async function toPdfPage(source: ExportArtifactSource): Promise<PdfPageConversionResult> {
  try {
    const converted = await sharp(source.imageData, { failOn: 'error', limitInputPixels: 40_000_000 })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const width = Math.max(1, Math.min(converted.info.width, 14_400));
    const height = Math.max(1, Math.min(converted.info.height, 14_400));
    return { jpeg: converted.data, width, height };
  } catch {
    throw new ValidationError('Export source image is invalid');
  }
}

function asPdfObject(id: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${id} 0 obj\n`, 'ascii'), body, Buffer.from('\nendobj', 'ascii')]);
}

function extensionForMimeType(mimeType: ExportImageMimeType): 'png' | 'jpg' | 'webp' {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  return 'webp';
}

function assertSourceBatchSize(sources: ExportArtifactSource[], limits: ExportArtifactBuilderLimits): void {
  const maxSourceImageBytes = limits.maxSourceImageBytes ?? MAX_EXPORT_SOURCE_IMAGE_BYTES;
  const maxTotalSourceBytes = limits.maxTotalSourceBytes ?? MAX_EXPORT_TOTAL_SOURCE_BYTES;
  let totalBytes = 0;
  for (const source of sources) {
    if (source.imageData.length > maxSourceImageBytes) {
      throw new PayloadTooLargeError('Export source image is too large');
    }
    totalBytes += source.imageData.length;
    if (totalBytes > maxTotalSourceBytes) {
      throw new PayloadTooLargeError('Export source images are too large');
    }
  }
}

function assertArtifactSize(data: Buffer, maxArtifactBytes = MAX_EXPORT_ARTIFACT_BYTES): void {
  if (data.length > maxArtifactBytes) {
    throw new PayloadTooLargeError('Export artifact is too large');
  }
}

function uint16le(value: number): Buffer { const result = Buffer.allocUnsafe(2); result.writeUInt16LE(value, 0); return result; }
function uint32le(value: number): Buffer { const result = Buffer.allocUnsafe(4); result.writeUInt32LE(value >>> 0, 0); return result; }

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
