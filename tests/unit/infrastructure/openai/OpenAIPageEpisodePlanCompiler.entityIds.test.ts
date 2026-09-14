import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageEpisodePlanCompiler } from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';

const entityId = '11111111-1111-4111-8111-111111111111';
const foreignId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';

function plan(assignmentId: string | null, speakerId: string | null = assignmentId): unknown {
  return { pages: [{ page_id: pageId, page_number: 1, panels: [{
    order: 1,
    dialogue: [{ entity_id: speakerId, text: 'そのまま残す台詞', type: speakerId === null ? 'narration' : 'speech', position: 'top' }],
    entities: assignmentId === null ? [] : [{ entity_id: assignmentId, role: 'primary', expression: 'calm', action: 'standing_firm', position: 'center' }],
  }] }] };
}

function setup(outputs: unknown[]): { compiler: OpenAIPageEpisodePlanCompiler; postJson: ReturnType<typeof vi.fn> } {
  let index = 0;
  const postJson = vi.fn(async () => {
    const output = outputs[Math.min(index++, outputs.length - 1)];
    if (output instanceof Error) throw output;
    return { body: { output_text: JSON.stringify(output) }, requestId: 'req-private' };
  });
  return { compiler: new OpenAIPageEpisodePlanCompiler({ postJson } as unknown as OpenAIClient), postJson };
}

const input = { compilerBrief: '[AVAILABLE ENTITIES]\nSaved characters', language: 'ja' as const, allowedEntityIds: [entityId] };

describe('episode plan の信頼済みキャラID境界', () => {
  it.each(['not-a-uuid', foreignId])('不正なassignment ID %s の後は一度だけ再試行し台詞と登場人物を保持する', async (badId) => {
    const { compiler, postJson } = setup([plan(badId), plan(entityId)]);
    const beforeRetry = vi.fn(async () => undefined);
    const result = await compiler.compilePlan({ ...input, beforeRetry });
    expect(postJson).toHaveBeenCalledTimes(2);
    expect(beforeRetry).toHaveBeenCalledTimes(1);
    expect(postJson.mock.calls[0]).toEqual(postJson.mock.calls[1]);
    expect(result.suggestion.pages[0].panels[0]).toMatchObject({
      entities: [{ entityId }], dialogue: [{ entityId, text: 'そのまま残す台詞' }],
    });
  });

  it('assignmentが正しくても未知の話者IDが続く場合は不正候補を返さない', async () => {
    const { compiler, postJson } = setup([plan(entityId, foreignId)]);
    await expect(compiler.compilePlan(input)).rejects.toMatchObject({ reason: 'invalid_payload', retryable: true });
    expect(postJson).toHaveBeenCalledTimes(2);
  });

  it('再試行直前に取り消された場合は2回目の外部要求を送らない', async () => {
    const { compiler, postJson } = setup([plan('not-a-uuid')]);
    const cancelled = new Error('cancelled');
    await expect(compiler.compilePlan({ ...input, beforeRetry: async () => { throw cancelled; } })).rejects.toBe(cancelled);
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('HTTP失敗には構造不正用の追加再試行を適用しない', async () => {
    const unavailable = new ConfigurationError('OpenAI timeout');
    const { compiler, postJson } = setup([unavailable]);
    await expect(compiler.compilePlan(input)).rejects.toBe(unavailable);
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    { output: [{ content: [{ type: 'refusal', refusal: 'Refused' }] }] },
  ])('拒否または出力打ち切りの場合は追加再試行しない', async (body) => {
    const postJson = vi.fn(async () => ({ body, requestId: 'req-private' }));
    const compiler = new OpenAIPageEpisodePlanCompiler({ postJson } as unknown as OpenAIClient);
    await expect(compiler.compilePlan(input)).rejects.toBeInstanceOf(ConfigurationError);
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('信頼済みcontext自体が不正な場合は外部要求を送らない', async () => {
    const { compiler, postJson } = setup([plan(entityId)]);
    await expect(compiler.compilePlan({ ...input, allowedEntityIds: ['broken-id'] })).rejects.toBeInstanceOf(ConfigurationError);
    expect(postJson).not.toHaveBeenCalled();
  });

  it.each([1, 200, 201, 1200])('キャラが%i件の場合も一覧を切り捨てず最終キャラを受理する', async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `${(index + 1).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`);
    const { compiler, postJson } = setup([plan(ids[count - 1], ids[0])]);
    const result = await compiler.compilePlan({ ...input, allowedEntityIds: ids });
    expect(result.suggestion.pages[0].panels[0].entities?.[0].entityId).toBe(ids[count - 1]);
    expect(postJson).toHaveBeenCalledTimes(1);
    const request = postJson.mock.calls[0] as unknown as [string, { text: { format: { schema: Record<string, unknown> } } }];
    const schema = request[1].text.format.schema;
    const definitions = schema.$defs as { entity_id: Record<string, unknown> };
    if (count <= 200) {
      expect(definitions.entity_id).toEqual({ type: 'string', enum: ids });
      expect(JSON.stringify(schema).split(ids[0])).toHaveLength(2);
    } else {
      expect(definitions.entity_id).toEqual({ type: 'string', format: 'uuid' });
      const rejected = setup([plan(foreignId)]);
      await expect(rejected.compiler.compilePlan({ ...input, allowedEntityIds: ids })).rejects.toMatchObject({ reason: 'invalid_payload' });
    }
  });

  it('キャラなしではナレーションを保持し架空キャラを拒否する', async () => {
    const { compiler, postJson } = setup([plan(null)]);
    const result = await compiler.compilePlan({ ...input, allowedEntityIds: [] });
    expect(result.suggestion.pages[0].panels[0]).toMatchObject({ entities: [], dialogue: [{ entityId: null }] });
    expect(postJson).toHaveBeenCalledTimes(1);
    const rejected = setup([plan(entityId)]);
    await expect(rejected.compiler.compilePlan({ ...input, allowedEntityIds: [] })).rejects.toMatchObject({ reason: 'invalid_payload' });
  });
});
