import type {
  PageImageRendererPort,
  RenderPageImageInput,
  RenderPageImageResult,
} from '../../services/page/PageGenerationWorkerService.js';
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
    private readonly model = 'gpt-image-2',
  ) {}

  public async render(input: RenderPageImageInput): Promise<RenderPageImageResult> {
    const prompt = input.internalPlan === null
      ? input.prompt
      : `${input.prompt}\n\nInternal generation plan:\n${input.internalPlan}`;

    const response = await this.client.postJson<OpenAIImageGenerationResponse>('/images/generations', {
      model: this.model,
      prompt,
      quality: input.quality,
      size: '1024x1536',
      n: 1,
      response_format: 'b64_json',
    });

    const base64Image = response.body.data?.[0]?.b64_json;
    if (typeof base64Image !== 'string' || base64Image.length === 0) {
      throw new ConfigurationError('OpenAI image renderer returned no image data');
    }

    return {
      imageData: Buffer.from(base64Image, 'base64'),
      mimeType: 'image/png',
      openaiRequestId: response.requestId,
      costUsd: null,
    };
  }
}
