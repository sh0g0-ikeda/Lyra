import { describe, expect, it } from 'vitest';
import { AnthropicStoryAiClient } from '../../../../src/infrastructure/anthropic/AnthropicStoryAiClient.js';
import type { AnthropicClient } from '../../../../src/infrastructure/anthropic/AnthropicClient.js';

class FakeAnthropicClient {
  public readonly requests: Record<string, unknown>[] = [];

  public constructor(private readonly responses: Array<{ text: string; requestId: string | null }>) {}

  public async createMessageText(body: Record<string, unknown>): Promise<{ text: string; requestId: string | null }> {
    this.requests.push(body);
    const next = this.responses.shift();
    if (next === undefined) {
      throw new Error('No fake Anthropic response configured');
    }
    return next;
  }
}

describe('AnthropicStoryAiClient', () => {
  it('page skeleton の trailing comma を repair 呼び出しなしで吸収する', async () => {
    const client = new FakeAnthropicClient([
      {
        requestId: 'req-1',
        text: `\`\`\`json
{
  "pages": [
    {
      "page_number": 1,
      "purpose": "導入",
      "suggested_panel_count": 1,
      "suggested_layout": "top_wide_3",
      "panels": [
        {
          "order": 1,
          "panel_role": "establish",
          "suggested_size": "large",
          "situation_hint": "澪が朝の窓辺に立つ。",
          "suggested_entities": ["11111111-1111-4111-8111-111111111111"],
          "suggested_dialogue_hint": null,
        }
      ],
    }
  ],
}
\`\`\``,
      },
    ]);
    const storyAiClient = new AnthropicStoryAiClient(client as unknown as AnthropicClient);

    const result = await storyAiClient.generatePageSkeleton({
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.panels).toHaveLength(1);
    expect(client.requests).toHaveLength(1);
  });

  it('page skeleton の malformed JSON は repair 再問い合わせを 1 回だけ行う', async () => {
    const client = new FakeAnthropicClient([
      {
        requestId: 'req-1',
        text: `{
  "pages": [
    {
      page_number: 1,
      "purpose": "導入",
      "suggested_panel_count": 1,
      "suggested_layout": "top_wide_3",
      "panels": [
        {
          "order": 1,
          "panel_role": "establish",
          "suggested_size": "large",
          "situation_hint": "澪が朝の窓辺に立つ。",
          "suggested_entities": ["11111111-1111-4111-8111-111111111111"],
          "suggested_dialogue_hint": null
        }
      ]
    }
  ]
}`,
      },
      {
        requestId: 'req-2',
        text: `{
  "pages": [
    {
      "page_number": 1,
      "purpose": "導入",
      "suggested_panel_count": 1,
      "suggested_layout": "top_wide_3",
      "panels": [
        {
          "order": 1,
          "panel_role": "establish",
          "suggested_size": "large",
          "situation_hint": "澪が朝の窓辺に立つ。",
          "suggested_entities": ["11111111-1111-4111-8111-111111111111"],
          "suggested_dialogue_hint": null
        }
      ]
    }
  ]
}`,
      },
    ]);
    const storyAiClient = new AnthropicStoryAiClient(client as unknown as AnthropicClient);

    const result = await storyAiClient.generatePageSkeleton({
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result).toHaveLength(1);
    expect(client.requests).toHaveLength(2);
    expect(String(client.requests[1]?.system)).toContain('You repair malformed JSON emitted by another model.');
  });

  it('episode draft 改善の malformed JSON も repair 再問い合わせで復旧する', async () => {
    const client = new FakeAnthropicClient([
      {
        requestId: 'req-1',
        text: `{
  title: "改善後タイトル",
  "purpose": "目的",
  "introduction": "導入",
  "middle": "中盤",
  "climax": "山場",
  "ending_hook": "引き"
}`,
      },
      {
        requestId: 'req-2',
        text: `{
  "title": "改善後タイトル",
  "purpose": "目的",
  "introduction": "導入",
  "middle": "中盤",
  "climax": "山場",
  "ending_hook": "引き"
}`,
      },
    ]);
    const storyAiClient = new AnthropicStoryAiClient(client as unknown as AnthropicClient);

    const result = await storyAiClient.improveEpisodeDraft({
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result).toEqual({
      title: '改善後タイトル',
      purpose: '目的',
      introduction: '導入',
      middle: '中盤',
      climax: '山場',
      endingHook: '引き',
    });
    expect(client.requests).toHaveLength(2);
  });
});
