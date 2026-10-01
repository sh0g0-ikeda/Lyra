import { assemblePageRenderPrompt } from '../../services/page/PageGenerationLayoutControl.js';
import type {
  PageImageRendererPort,
  RenderPageImageInput,
  RenderPageImageResult,
} from '../../services/page/PageGenerationWorkerService.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../domain/constants/imageInput.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { OpenAIClient } from './OpenAIClient.js';

interface OpenAIImageGenerationResponse {
  data?: Array<{
    b64_json?: unknown;
  }>;
}

export class OpenAIPageImageRenderer implements PageImageRendererPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model: string = 'gpt-image-2',
  ) {}

  public async render(input: RenderPageImageInput): Promise<RenderPageImageResult> {
    if (input.layoutControl != null && input.inputImages.at(-1)?.role !== 'layout_reference') {
      throw new ConfigurationError('Resolved layout requires its guide as the last image input');
    }
    const plannedPrompt = input.internalPlan === null
      ? input.prompt
      : `${input.prompt}\n\nInternal generation plan:\n${input.internalPlan}`;
    const styledPrompt = input.renderStyle === 'monochrome'
      ? `${plannedPrompt}\n\nFinal rendering constraint: black-and-white manga ink with grayscale screentones only; no colored fills.`
      : plannedPrompt;
    const prompt = input.panelCount === undefined ? styledPrompt
      : assemblePageRenderPrompt(styledPrompt, null, input.layoutControl ?? null, input.panelCount);

    const response = input.inputImages.length === 0
      ? await this.client.postJson<OpenAIImageGenerationResponse>('/images/generations', {
          model: this.model,
          prompt,
          size: '1024x1536',
          quality: input.quality,
        })
      : await this.client.postFormData<OpenAIImageGenerationResponse>('/images/edits', () =>
          buildImageEditFormData({
            model: this.model,
            prompt,
            size: '1024x1536',
            quality: input.quality,
            inputImages: input.inputImages,
          }),
        );

    const base64Image = response.body.data?.[0]?.b64_json;
    if (typeof base64Image !== 'string' || base64Image.length === 0) {
      throw new ConfigurationError('OpenAI image renderer returned no image data');
    }

    const imageData = Buffer.from(base64Image, 'base64');
    if (imageData.length === 0) {
      throw new ConfigurationError('OpenAI image renderer returned invalid image data');
    }

    return {
      imageData,
      mimeType: 'image/png',
      openaiRequestId: response.requestId,
      costUsd: null,
      imageModel: this.model,
      providerModelId: this.model,
      provider: 'openai',
    };
  }
}

function buildImageEditFormData(input: {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  inputImages: RenderPageImageInput['inputImages'];
}): FormData {
  const formData = new FormData();
  formData.append('model', input.model);
  formData.append('prompt', input.prompt);
  formData.append('size', input.size);
  formData.append('quality', input.quality);

  for (const image of input.inputImages) {
    formData.append('image[]', dataUrlToBlob(image.dataUrl), `${sanitizeFilename(image.label)}.png`);
  }

  return formData;
}

// Stable filenames are not required by the API, but giving each reference image
// a subject-derived name makes prompt/debug traces easier to inspect.
function sanitizeFilename(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');

  return normalized.length === 0 ? 'reference-image' : normalized;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(?<mimeType>[-\w.+/]+);base64,(?<base64>[A-Za-z0-9+/=]+)$/u.exec(dataUrl);
  if (match?.groups?.mimeType === undefined || match.groups.base64 === undefined) {
    throw new ConfigurationError('OpenAI image renderer received an invalid image input');
  }

  if (!isSupportedInputImageMimeType(match.groups.mimeType)) {
    throw new ConfigurationError('OpenAI image renderer received an unsupported image input type');
  }

  const imageData = Buffer.from(match.groups.base64, 'base64');
  if (imageData.length === 0) {
    throw new ConfigurationError('OpenAI image renderer received an empty image input');
  }
  if (imageData.length > OPENAI_INPUT_IMAGE_MAX_BYTES) {
    throw new ConfigurationError('OpenAI image renderer received an input image that is too large');
  }

  return new Blob([imageData], {
    type: match.groups.mimeType,
  });
}

function isSupportedInputImageMimeType(value: string): value is 'image/png' | 'image/jpeg' | 'image/webp' {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}
