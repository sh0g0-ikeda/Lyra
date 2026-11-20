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

  it('照合の選択肢IDが根拠と不一致でも原文証拠を応答単位で捨てない', async () => {
    const appearance = [
      { field: 'hair.color', option_id: 'gold', value: '黒い短髪', quote: 'ミオは黒い短髪である。' },
      { field: 'hair.length', option_id: null, value: '短髪', quote: 'ミオは黒い短髪である。' },
      { field: 'clothing.description', option_id: 'blue', value: '白と青のしましまの上着', quote: 'ミオは白と青のしましまの上着を着ている。' },
      { field: 'eyes.color', option_id: 'green', value: '緑色', quote: 'ミオの目は緑色である。' },
    ] as const;
    const client = {
      postJson: async () => ({
        body: { output_text: JSON.stringify({
          additions: [{
            name: 'ミオ', name_quote: 'ミオは黒い短髪である。', entity_type: 'character',
            appearance, changes: [],
          }],
          unresolved: [],
        }) },
        requestId: 'req-invalid-option',
      }),
    } as unknown as OpenAIClient;

    const result = await new OpenAIStoryAiClient(client).reconcileCharacterAutofillCoverage?.({
      systemPrompt: 'audit', userPrompt: 'source',
    });

    expect(result?.additions[0]?.appearance).toEqual(appearance);
  });
});
