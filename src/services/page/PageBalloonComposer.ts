import sharp from 'sharp';
import type { Balloon } from '../../domain/types/balloon.js';
import { ConfigurationError } from '../../domain/errors/index.js';

export interface ComposePageBalloonsInput {
  pageImage: Buffer;
  balloons: Balloon[];
}

export interface ComposedPageImage {
  imageData: Buffer;
  mimeType: 'image/png';
}

export interface PageBalloonComposerPort {
  compose(input: ComposePageBalloonsInput): Promise<ComposedPageImage>;
}

/**
 * Renders balloon overlays in SVG and composites them onto the generated page
 * image so confirm() can persist the actual final page asset.
 */
export class SharpPageBalloonComposer implements PageBalloonComposerPort {
  public async compose(input: ComposePageBalloonsInput): Promise<ComposedPageImage> {
    if (input.balloons.length === 0) {
      return {
        imageData: input.pageImage,
        mimeType: 'image/png',
      };
    }

    const pageImage = sharp(input.pageImage);
    const metadata = await pageImage.metadata();
    const width = metadata.width;
    const height = metadata.height;

    if (width === undefined || height === undefined) {
      throw new ConfigurationError('Generated page image dimensions are missing');
    }

    const overlay = Buffer.from(buildOverlaySvg(width, height, input.balloons), 'utf8');
    const imageData = await pageImage
      .composite([{ input: overlay, top: 0, left: 0 }])
      .png()
      .toBuffer();

    return {
      imageData,
      mimeType: 'image/png',
    };
  }
}

function buildOverlaySvg(width: number, height: number, balloons: Balloon[]): string {
  const content = balloons
    .slice()
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((balloon) => renderBalloon(balloon, width, height))
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    content,
    '</svg>',
  ].join('');
}

function renderBalloon(balloon: Balloon, width: number, height: number): string {
  const x = balloon.position.x * width;
  const y = balloon.position.y * height;
  const balloonWidth = balloon.position.width * width;
  const balloonHeight = balloon.position.height * height;
  const radius = Math.min(balloonWidth, balloonHeight) * 0.12;
  const fontSize = balloon.fontSize;
  const lines = wrapText(balloon.text, Math.max(8, Math.floor(balloonWidth / Math.max(fontSize * 0.55, 1))));
  const textX = x + balloonWidth / 2;
  const textY = y + Math.max(fontSize * 1.2, (balloonHeight - lines.length * fontSize * 1.15) / 2 + fontSize);
  const writingMode = balloon.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb';

  const tail = balloon.tail === null
    ? ''
    : `<polygon points="${balloon.tail.baseX * width},${balloon.tail.baseY * height} ${balloon.tail.tipX * width},${balloon.tail.tipY * height} ${(balloon.tail.baseX * width) + 18},${(balloon.tail.baseY * height) + 12}" fill="#ffffff" stroke="#111111" stroke-width="3" stroke-linejoin="round" />`;

  const tspans = lines
    .map((line, index) => `<tspan x="${textX}" dy="${index === 0 ? 0 : fontSize * 1.15}">${escapeXml(line)}</tspan>`)
    .join('');

  return [
    '<g>',
    tail,
    `<rect x="${x}" y="${y}" width="${balloonWidth}" height="${balloonHeight}" rx="${radius}" ry="${radius}" fill="#ffffff" stroke="#111111" stroke-width="3" />`,
    `<text x="${textX}" y="${textY}" text-anchor="middle" font-size="${fontSize}" font-family='${escapeXml(fontFamilyToCss(balloon.fontFamily))}' fill="#111111" writing-mode="${writingMode}" style="letter-spacing: 0;">${tspans}</text>`,
    '</g>',
  ].join('');
}

function wrapText(text: string, approxCharsPerLine: number): string[] {
  const collapsed = text.replace(/\s+/gu, ' ').trim();
  if (collapsed.length <= approxCharsPerLine) {
    return [collapsed];
  }

  const lines: string[] = [];
  let remaining = collapsed;

  while (remaining.length > approxCharsPerLine) {
    let breakIndex = remaining.lastIndexOf(' ', approxCharsPerLine);
    if (breakIndex <= 0) {
      breakIndex = approxCharsPerLine;
    }

    lines.push(remaining.slice(0, breakIndex).trim());
    remaining = remaining.slice(breakIndex).trim();
  }

  if (remaining.length > 0) {
    lines.push(remaining);
  }

  return lines;
}

function fontFamilyToCss(value: Balloon['fontFamily']): string {
  if (value === 'mincho') {
    return '"Yu Mincho", serif';
  }

  if (value === 'rounded') {
    return '"Hiragino Maru Gothic Pro", sans-serif';
  }

  if (value === 'bold') {
    return '"Arial Black", sans-serif';
  }

  return '"Hiragino Kaku Gothic Pro", sans-serif';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}
