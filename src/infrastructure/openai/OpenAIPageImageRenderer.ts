import type {
  PageImageRendererPort,
  RenderPageImageInput,
  RenderPageImageResult,
} from '../../services/page/PageGenerationWorkerService.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { OpenAIClient } from './OpenAIClient.js';

interface OpenAIImageGenerationResponse {
  output?: Array<{
    type?: unknown;
    result?: unknown;
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

    const response = await this.client.postJson<OpenAIImageGenerationResponse>('/responses', {
      model: this.model,
      input: [
        {
          role: 'user',
          content: [
            ...input.inputImages.map((image) => ({
              type: 'input_image',
              image_url: image.dataUrl,
            })),
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        },
      ],
      tools: [
        {
          type: 'image_generation',
          quality: input.quality,
          size: '1024x1536',
        },
      ],
    });

    const base64Image = response.body.output?.find(
      (entry) => entry.type === 'image_generation_call',
    )?.result;
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
