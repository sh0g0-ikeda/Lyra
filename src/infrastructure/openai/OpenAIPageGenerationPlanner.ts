import type {
  PageGenerationPlannerPort,
  PageGenerationPlanInput,
} from '../../services/page/PageGenerationWorkerService.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { PAGE_GENERATION_PLANNER_MAX_TOKENS } from '../../domain/constants/generation.js';
import { OpenAIClient } from './OpenAIClient.js';

interface OpenAIPlannerResponse {
  output_text?: unknown;
  output?: unknown;
}

export class OpenAIPageGenerationPlanner implements PageGenerationPlannerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = 'gpt-5.4-mini',
  ) {}

  public async buildPlan(input: PageGenerationPlanInput): Promise<string> {
    const response = await this.client.postJson<OpenAIPlannerResponse>('/responses', {
      model: this.model,
      max_output_tokens: PAGE_GENERATION_PLANNER_MAX_TOKENS,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'Create an internal manga page generation plan. Return only the plan text.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: input.prompt,
            },
          ],
        },
      ],
    });

    const outputText = extractOutputText(response.body);
    if (outputText === null) {
      throw new ConfigurationError('OpenAI planner returned no text output');
    }

    return outputText;
  }
}

function extractOutputText(response: OpenAIPlannerResponse): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return null;
  }

  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }

      const text = content.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
