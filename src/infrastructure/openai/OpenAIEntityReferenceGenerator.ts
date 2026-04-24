import {
  ENTITY_REFERENCE_GENERATION,
} from '../../domain/constants/entityReference.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { OpenAIClient } from './OpenAIClient.js';

export interface GenerateEntityReferenceCandidatesInput {
  prompt: string;
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
  output?: Array<{
    type?: unknown;
    result?: unknown;
  }>;
}

export class OpenAIEntityReferenceGenerator implements EntityReferenceGeneratorPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = ENTITY_REFERENCE_GENERATION.MODEL,
  ) {}

  public async generateCandidates(input: GenerateEntityReferenceCandidatesInput): Promise<{
    candidates: GeneratedEntityReferenceCandidate[];
    openaiRequestId: string | null;
    costUsd: number | null;
  }> {
    const candidates: GeneratedEntityReferenceCandidate[] = [];
    let firstRequestId: string | null = null;

    for (let index = 0; index < ENTITY_REFERENCE_GENERATION.CANDIDATE_COUNT; index += 1) {
      const response = await this.client.postJson<OpenAIImageGenerationResponse>('/responses', {
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `${input.prompt}\n\nVariant ${index + 1} of ${ENTITY_REFERENCE_GENERATION.CANDIDATE_COUNT}.`,
              },
            ],
          },
        ],
        tools: [
          {
            type: 'image_generation',
            quality: ENTITY_REFERENCE_GENERATION.QUALITY,
            size: ENTITY_REFERENCE_GENERATION.SIZE,
          },
        ],
      });

      if (firstRequestId === null) {
        firstRequestId = response.requestId;
      }

      const base64Image = response.body.output?.find(
        (entry) => entry.type === 'image_generation_call',
      )?.result;
      if (typeof base64Image !== 'string' || base64Image.length === 0) {
        throw new ConfigurationError('Entity reference generator returned no image data');
      }

      candidates.push({
        imageData: Buffer.from(base64Image, 'base64'),
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
