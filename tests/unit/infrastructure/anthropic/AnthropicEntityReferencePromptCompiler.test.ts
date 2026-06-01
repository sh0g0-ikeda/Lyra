import { describe, expect, it } from 'vitest';
import { AnthropicClient } from '../../../../src/infrastructure/anthropic/AnthropicClient.js';
import { AnthropicEntityReferencePromptCompiler } from '../../../../src/infrastructure/anthropic/AnthropicEntityReferencePromptCompiler.js';
import type { EntityReferenceContext } from '../../../../src/domain/types/entityReference.js';

const context: EntityReferenceContext = {
  entityId: 'entity-1',
  workId: 'work-1',
  userId: 'user-1',
  entityType: 'character',
  name: 'Yuki',
  freeDescription: 'Quiet student with a hidden violent streak',
  structuredFields: { hair: { color: 'black' } },
  promptSupplement: 'Use a neat school uniform',
  status: 'draft',
  referenceSet: {
    entityId: 'entity-1',
    images: [],
    primaryRefId: null,
    status: 'empty',
    updatedAt: new Date('2026-05-25T00:00:00.000Z'),
  },
};

describe('AnthropicEntityReferencePromptCompiler', () => {
  it('Anthropic fallback compiler も metadata 付きで prompt を返す', async () => {
    const client = {
      createMessageText: async () => ({
        text: '```text\nPolished manga prompt here.\n```',
        requestId: 'req-1',
      }),
    } as unknown as AnthropicClient;
    const compiler = new AnthropicEntityReferencePromptCompiler(client);

    const result = await compiler.compilePrompt({
      context,
      draftPrompt: 'draft prompt',
      compilerBrief: 'Character visual anchor: compact bob',
    });

    expect(result).toEqual({
      prompt: 'Polished manga prompt here.',
      compilerProvider: 'anthropic',
      compilerModel: 'claude-sonnet-4-20250514',
      compilerPromptVersion: 'entity_ref_v2',
    });
  });
});
