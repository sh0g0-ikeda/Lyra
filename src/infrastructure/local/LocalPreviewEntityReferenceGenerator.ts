import sharp from 'sharp';
import { ENTITY_REFERENCE_GENERATION } from '../../domain/constants/entityReference.js';
import type {
  EntityReferenceGeneratorPort,
  GenerateEntityReferenceCandidatesInput,
  GeneratedEntityReferenceCandidate,
} from '../openai/OpenAIEntityReferenceGenerator.js';

const IMAGE_WIDTH = 1024;
const IMAGE_HEIGHT = 1536;

export class LocalPreviewEntityReferenceGenerator implements EntityReferenceGeneratorPort {
  public async generateCandidates(input: GenerateEntityReferenceCandidatesInput): Promise<{
    candidates: GeneratedEntityReferenceCandidate[];
    openaiRequestId: string | null;
    costUsd: number | null;
  }> {
    const candidates: GeneratedEntityReferenceCandidate[] = [];

    for (let index = 0; index < ENTITY_REFERENCE_GENERATION.CANDIDATE_COUNT; index += 1) {
      const svg = buildEntityPreviewSvg(input, index + 1);
      const imageData = await sharp(Buffer.from(svg)).png().toBuffer();
      candidates.push({
        imageData,
        mimeType: 'image/png',
      });
    }

    return {
      candidates,
      openaiRequestId: null,
      costUsd: 0,
    };
  }
}

function buildEntityPreviewSvg(input: GenerateEntityReferenceCandidatesInput, variant: number): string {
  const promptLines = wrapText(input.prompt, 54).slice(0, 12);
  const hasInput = input.inputImages.length > 0;

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">
    <rect width="100%" height="100%" fill="#f6f2e8"/>
    <rect x="36" y="36" width="${IMAGE_WIDTH - 72}" height="${IMAGE_HEIGHT - 72}" rx="18" fill="#ffffff" stroke="#111111" stroke-width="6"/>
    <text x="90" y="118" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="700" fill="#111111">Character Preview</text>
    <text x="90" y="166" font-family="Inter, Arial, sans-serif" font-size="24" fill="#7a6841">${
      ENTITY_REFERENCE_GENERATION.CANDIDATE_COUNT === 1
        ? 'Local fallback preview'
        : `Local fallback variant ${variant}`
    }</text>

    <g transform="translate(190 250)">
      <circle cx="322" cy="120" r="94" fill="#ded8ca" stroke="#111111" stroke-width="5"/>
      <rect x="250" y="220" width="144" height="360" rx="68" fill="#e8e1d3" stroke="#111111" stroke-width="5"/>
      <rect x="208" y="262" width="56" height="240" rx="28" fill="#e8e1d3" stroke="#111111" stroke-width="5"/>
      <rect x="380" y="262" width="56" height="240" rx="28" fill="#e8e1d3" stroke="#111111" stroke-width="5"/>
      <rect x="270" y="580" width="48" height="300" rx="24" fill="#e8e1d3" stroke="#111111" stroke-width="5"/>
      <rect x="326" y="580" width="48" height="300" rx="24" fill="#e8e1d3" stroke="#111111" stroke-width="5"/>
      <rect x="240" y="374" width="164" height="260" rx="28" fill="#1d1d1d" opacity="0.08"/>
    </g>

    <rect x="90" y="1110" width="${IMAGE_WIDTH - 180}" height="320" rx="14" fill="#111111"/>
    <text x="120" y="1162" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="700" fill="#f7f4eb">Prompt excerpt</text>
    ${promptLines
      .map(
        (line, index) =>
          `<text x="120" y="${1206 + index * 34}" font-family="Inter, Arial, sans-serif" font-size="22" fill="#e4e4e4">${escapeXml(line)}</text>`,
      )
      .join('\n')}
    <text x="120" y="1400" font-family="Inter, Arial, sans-serif" font-size="20" fill="#d4c28c">${escapeXml(
      hasInput ? 'Source image was provided for this local fallback preview.' : 'No source image was provided.',
    )}</text>
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
