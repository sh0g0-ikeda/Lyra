import sharp from 'sharp';
import type {
  PageImageRendererPort,
  RenderPageImageInput,
  RenderPageImageResult,
} from '../../services/page/PageGenerationWorkerService.js';

const PAGE_WIDTH = 1024;
const PAGE_HEIGHT = 1536;

export class LocalPreviewPageImageRenderer implements PageImageRendererPort {
  public async render(input: RenderPageImageInput): Promise<RenderPageImageResult> {
    const svg = buildPagePreviewSvg(input);
    const imageData = await sharp(Buffer.from(svg)).png().toBuffer();

    return {
      imageData,
      mimeType: 'image/png',
      openaiRequestId: null,
      costUsd: 0,
    };
  }
}

function buildPagePreviewSvg(input: RenderPageImageInput): string {
  const promptLines = wrapText(input.prompt, 64).slice(0, 16);
  const imageNote =
    input.inputImages.length === 0
      ? 'No reference images'
      : `${input.inputImages.length} reference image(s) attached`;

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">
    <rect width="100%" height="100%" fill="#f7f4eb"/>
    <rect x="32" y="32" width="${PAGE_WIDTH - 64}" height="${PAGE_HEIGHT - 64}" rx="18" fill="#ffffff" stroke="#111111" stroke-width="6"/>
    <rect x="72" y="72" width="${PAGE_WIDTH - 144}" height="180" rx="14" fill="#111111"/>
    <text x="100" y="136" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="700" fill="#f7f4eb">Lyra Local Preview</text>
    <text x="100" y="190" font-family="Inter, Arial, sans-serif" font-size="28" fill="#d4c28c">OpenAI image generation unavailable in local mode</text>
    <text x="100" y="232" font-family="Inter, Arial, sans-serif" font-size="22" fill="#d4c28c">Page ${escapeXml(input.pageId)} / ${escapeXml(input.generationMode)}</text>

    <rect x="72" y="292" width="${PAGE_WIDTH - 144}" height="980" rx="18" fill="#fafafa" stroke="#1f1f1f" stroke-width="3"/>
    <text x="100" y="340" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="700" fill="#111111">Prompt excerpt</text>
    ${promptLines
      .map(
        (line, index) =>
          `<text x="100" y="${390 + index * 42}" font-family="Inter, Arial, sans-serif" font-size="24" fill="#222222">${escapeXml(line)}</text>`,
      )
      .join('\n')}

    <rect x="72" y="1308" width="${PAGE_WIDTH - 144}" height="156" rx="14" fill="#111111"/>
    <text x="100" y="1368" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700" fill="#f7f4eb">Local render metadata</text>
    <text x="100" y="1414" font-family="Inter, Arial, sans-serif" font-size="24" fill="#d7d7d7">${escapeXml(imageNote)}</text>
    <text x="100" y="1452" font-family="Inter, Arial, sans-serif" font-size="22" fill="#d7d7d7">Quality: ${escapeXml(input.quality)} / Render: fresh from current inputs</text>
  </svg>
  `.trim();
}

function wrapText(value: string, maxLength: number): string[] {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    return ['No prompt content'];
  }

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > maxLength && current.length > 0) {
      lines.push(current);
      current = word;
      continue;
    }
    current = candidate;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
