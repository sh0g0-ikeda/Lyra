import {
  ENTITY_REFERENCE_GENERATION,
} from '../../domain/constants/entityReference.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../domain/constants/imageInput.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { OpenAIClient } from './OpenAIClient.js';

export interface GenerateEntityReferenceCandidatesInput {
  prompt: string;
  inputImages: Array<{
    dataUrl: string;
  }>;
}

export interface GeneratedEntityReferenceCandidate {
  imageData: Buffer;
  mimeType: string;
}

export interface EntityReferenceGeneratorPort {
  generateCandidates(input: GenerateEntityReferenceCandidatesInput): Promise<{
    candidates: GeneratedEntityReferenceCandidate[];
    openaiRequestId: string | null;
    costUsd: number | null;
  }>;
}

interface OpenAIImageGenerationResponse {
  data?: Array<{
    b64_json?: unknown;
  }>;
}

export class OpenAIEntityReferenceGenerator implements EntityReferenceGeneratorPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model: string = ENTITY_REFERENCE_GENERATION.MODEL,
  ) {}

  public async generateCandidates(input: GenerateEntityReferenceCandidatesInput): Promise<{
    candidates: GeneratedEntityReferenceCandidate[];
    openaiRequestId: string | null;
    costUsd: number | null;
  }> {
    const candidates: GeneratedEntityReferenceCandidate[] = [];
    let firstRequestId: string | null = null;
    const prompt = `${input.prompt}\n\nReturn a single PNG character reference image.`;

    for (let index = 0; index < ENTITY_REFERENCE_GENERATION.CANDIDATE_COUNT; index += 1) {
      const variantPrompt = ENTITY_REFERENCE_GENERATION.CANDIDATE_COUNT === 1
        ? prompt
        : `${prompt}\n\nVariant ${index + 1} of ${ENTITY_REFERENCE_GENERATION.CANDIDATE_COUNT}.`;
      const response = input.inputImages.length === 0
        ? await this.client.postJson<OpenAIImageGenerationResponse>('/images/generations', {
            model: this.model,
            prompt: variantPrompt,
            size: ENTITY_REFERENCE_GENERATION.SIZE,
            quality: ENTITY_REFERENCE_GENERATION.QUALITY,
          })
        : await this.client.postFormData<OpenAIImageGenerationResponse>('/images/edits', () =>
            buildImageEditFormData({
              model: this.model,
              prompt: variantPrompt,
              size: ENTITY_REFERENCE_GENERATION.SIZE,
              quality: ENTITY_REFERENCE_GENERATION.QUALITY,
              inputImages: input.inputImages,
            }),
          );

      if (firstRequestId === null) {
        firstRequestId = response.requestId;
      }

      const base64Image = response.body.data?.[0]?.b64_json;
      if (typeof base64Image !== 'string' || base64Image.length === 0) {
        throw new ConfigurationError('Entity reference generator returned no image data');
      }

      const imageData = Buffer.from(base64Image, 'base64');
      if (imageData.length === 0) {
        throw new ConfigurationError('Entity reference generator returned invalid image data');
      }

      candidates.push({
        imageData,
        mimeType: 'image/png',
      });
    }

    return {
      candidates,
      openaiRequestId: firstRequestId,
      costUsd: null,
    };
  }
}

function buildImageEditFormData(input: {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  inputImages: GenerateEntityReferenceCandidatesInput['inputImages'];
}): FormData {
  const formData = new FormData();
  formData.append('model', input.model);
  formData.append('prompt', input.prompt);
  formData.append('size', input.size);
  formData.append('quality', input.quality);

  for (const image of input.inputImages) {
    formData.append('image[]', dataUrlToBlob(image.dataUrl), 'reference.png');
  }

  return formData;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(?<mimeType>[-\w.+/]+);base64,(?<base64>[A-Za-z0-9+/=]+)$/u.exec(dataUrl);
  if (match?.groups?.mimeType === undefined || match.groups.base64 === undefined) {
    throw new ConfigurationError('Entity reference generator received an invalid image input');
  }

  if (!isSupportedInputImageMimeType(match.groups.mimeType)) {
    throw new ConfigurationError('Entity reference generator received an unsupported image input type');
  }

  const imageData = Buffer.from(match.groups.base64, 'base64');
  if (imageData.length === 0) {
    throw new ConfigurationError('Entity reference generator received an empty image input');
  }
  if (imageData.length > OPENAI_INPUT_IMAGE_MAX_BYTES) {
    throw new ConfigurationError('Entity reference generator received an input image that is too large');
  }

  return new Blob([imageData], {
    type: match.groups.mimeType,
  });
}

function isSupportedInputImageMimeType(value: string): value is 'image/png' | 'image/jpeg' | 'image/webp' {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}
