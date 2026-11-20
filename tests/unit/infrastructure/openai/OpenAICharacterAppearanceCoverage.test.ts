import { describe, expect, it } from 'vitest';
import {
  CHARACTER_AUTOFILL_OPENAI_MODEL,
  CHARACTER_AUTOFILL_REASONING_EFFORT,
} from '../../../../src/domain/constants/storyAi.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIStoryAiClient } from '../../../../src/infrastructure/openai/OpenAIStoryAiClient.js';

describe('OpenAI character appearance coverage', () => {
  it('抽出と独立照合だけを gpt-6-luna low の strict Responses に送る', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (path: string, payload: Record<string, unknown>) => {
        expect(path).toBe('/responses');
        requests.push(payload);
        return {
          body: { output_text: requests.length === 1
            ? JSON.stringify({ characters: [] })
            : JSON.stringify({ additions: [], unresolved: [] }) },
          requestId: `req-${requests.length}`,
        };
      },
    } as unknown as OpenAIClient;
    const story = new OpenAIStoryAiClient(client);

    await story.extractCharacterAutofill?.({ systemPrompt: 'extract', userPrompt: 'source' });
    await story.reconcileCharacterAutofillCoverage?.({ systemPrompt: 'audit', userPrompt: 'source' });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request).toMatchObject({
        model: CHARACTER_AUTOFILL_OPENAI_MODEL,
        reasoning: { effort: CHARACTER_AUTOFILL_REASONING_EFFORT },
        text: { format: { type: 'json_schema', strict: true } },
      });
    }
  });

  it('照合の選択肢IDが対象フィールドのカタログ外なら拒否する', async () => {
    const client = {
      postJson: async () => ({
        body: { output_text: JSON.stringify({
          additions: [{
            name: 'アキ', name_quote: 'アキは黒髪。', entity_type: 'character',
            appearance: [{ field: 'hair.color', option_id: 'gold', value: '黒髪', quote: 'アキは黒髪。' }], changes: [],
          }],
          unresolved: [],
        }) },
        requestId: 'req-invalid-option',
      }),
    } as unknown as OpenAIClient;

    await expect(new OpenAIStoryAiClient(client).reconcileCharacterAutofillCoverage?.({
      systemPrompt: 'audit', userPrompt: 'source',
    })).rejects.toThrow('invalid payload');
  });
});
