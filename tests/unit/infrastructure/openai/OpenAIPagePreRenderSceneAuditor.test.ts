import { describe, expect, it, vi } from 'vitest';
import { PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS } from '../../../../src/domain/constants/generation.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { resolvePageGenerationLayoutControl } from '../../../../src/services/page/PageGenerationLayoutControl.js';
import { OpenAIPagePreRenderSceneAuditor } from '../../../../src/infrastructure/openai/OpenAIPagePreRenderSceneAuditor.js';

describe('OpenAIPagePreRenderSceneAuditor', () => {
  it('同じ順序のdata URL画像をlabel付きで構造化監査へ送る', async () => {
    const postJson = vi.fn().mockResolvedValue({ requestId: 'request-1', body: {
      status: 'completed', output_text: JSON.stringify({ verdict: 'guidance', directives: [
        { panel_order: 1, kind: 'appearance', entity_ids: ['67b758f1-b11d-456c-8025-d6c18dc33c9e'] },
      ] }),
    } });
    const auditor = new OpenAIPagePreRenderSceneAuditor({ postJson } as unknown as OpenAIClient);
    const result = await auditor.audit({
      prompt: 'original prompt', compilerBrief: 'brief', internalPlan: null, inputSnapshot: {
        pageId: 'page', requestKind: 'initial', generationMode: 'standard', panelCount: 1,
        panels: [{ panelId: 'panel', order: 1, entityIds: ['67b758f1-b11d-456c-8025-d6c18dc33c9e'], entityNames: ['Ishii'], dialogue: [] }],
      },
      inputImages: [{
        role: 'entity_reference', label: 'Ishii / awakened', dataUrl: 'data:image/png;base64,cG5n',
        reference: {
          entityId: '67b758f1-b11d-456c-8025-d6c18dc33c9e', stateId: '2685f36d-9d44-45ef-a7f3-401d6815106c',
          refId: 'ref', s3Key: 'not-forwarded', imageModel: null, subjectLabel: 'Ishii / awakened',
        },
      }],
      layoutControl: resolvePageGenerationLayoutControl({ type: 'template', template_id: 'splash_1' }, 1),
    });

    expect(result).toEqual({ verdict: 'guidance', directives: [{ panelOrder: 1, kind: 'appearance', entityIds: ['67b758f1-b11d-456c-8025-d6c18dc33c9e'] }] });
    const request = postJson.mock.calls[0]?.[1] as { input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }> };
    expect(request.input[1]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'input_text', text: expect.stringContaining('Ishii / awakened') }),
      { type: 'input_image', image_url: 'data:image/png;base64,cG5n' },
    ]));
    const userText = request.input[1]?.content.filter((entry) => entry.type === 'input_text').map((entry) => entry.text).join('\n');
    expect(userText).toContain('"entityNames":["Ishii"]');
    expect(userText).toContain('"modelInputOrder":1');
    expect(userText).toContain('"stateId":"2685f36d-9d44-45ef-a7f3-401d6815106c"');
    expect(userText).not.toContain('not-forwarded');
    expect(userText).toContain('"version":"page_layout_v1"');
  });

  it('画像以外のdata URLはprovider呼出し前に拒否する', async () => {
    const postJson = vi.fn();
    const auditor = new OpenAIPagePreRenderSceneAuditor({ postJson } as unknown as OpenAIClient);
    await expect(auditor.audit({
      prompt: 'prompt', compilerBrief: 'brief', internalPlan: null, inputSnapshot: {
        pageId: 'page', requestKind: 'initial', generationMode: 'standard', panelCount: 1,
        panels: [{ panelId: 'panel', order: 1, entityIds: [], entityNames: [], dialogue: [] }],
      }, inputImages: [{ role: 'layout_reference', label: 'layout', dataUrl: 'data:text/plain;base64,eA==' }],
    })).rejects.toThrow();
    expect(postJson).not.toHaveBeenCalled();
  });

  it('internal planのUnicode code point上限を超える場合はprovider呼出し前に拒否する', async () => {
    const postJson = vi.fn();
    const auditor = new OpenAIPagePreRenderSceneAuditor({ postJson } as unknown as OpenAIClient);
    await expect(auditor.audit({
      prompt: 'prompt', compilerBrief: 'brief', internalPlan: '😀'.repeat(PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS + 1),
      inputSnapshot: { pageId: 'page', requestKind: 'initial', generationMode: 'standard', panelCount: 1, panels: [] },
      inputImages: [],
    })).rejects.toThrow();
    expect(postJson).not.toHaveBeenCalled();
  });

  it('2人物のbase/state参照を元の順序と対応表のまま送る', async () => {
    const postJson = vi.fn().mockResolvedValue({ requestId: 'request-2', body: {
      status: 'completed', output_text: JSON.stringify({ verdict: 'pass', directives: [] }),
    } });
    const auditor = new OpenAIPagePreRenderSceneAuditor({ postJson } as unknown as OpenAIClient);
    await auditor.audit({
      prompt: 'scene', compilerBrief: 'brief', internalPlan: null,
      inputSnapshot: {
        pageId: 'page', requestKind: 'initial', generationMode: 'standard', panelCount: 1,
        panels: [{ panelId: 'panel', order: 1, entityIds: ['a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222'], entityNames: ['Ishii', 'Kuro'], dialogue: [] }],
      },
      inputImages: [
        { role: 'entity_reference', label: 'Ishii / default', dataUrl: 'data:image/png;base64,YQ==', reference: { entityId: 'a1111111-1111-4111-8111-111111111111', stateId: null, refId: 'base', s3Key: 'hidden', imageModel: null, subjectLabel: 'Ishii / default' } },
        { role: 'entity_reference', label: 'Kuro / awakened', dataUrl: 'data:image/jpeg;base64,Yg==', reference: { entityId: 'b2222222-2222-4222-8222-222222222222', stateId: 'c3333333-3333-4333-8333-333333333333', refId: 'state', s3Key: 'hidden', imageModel: null, subjectLabel: 'Kuro / awakened' } },
        { role: 'layout_reference', label: 'layout', dataUrl: 'data:image/webp;base64,Yw==' },
      ],
    });
    const content = (postJson.mock.calls[0]?.[1] as { input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }> }).input[1]!.content;
    expect(content.filter((item) => item.type === 'input_image').map((item) => item.image_url)).toEqual([
      'data:image/png;base64,YQ==', 'data:image/jpeg;base64,Yg==', 'data:image/webp;base64,Yw==',
    ]);
    const text = content.filter((item) => item.type === 'input_text').map((item) => item.text).join('\n');
    expect(text).toContain('"modelInputOrder":1,"role":"entity_reference","label":"Ishii / default","entityId":"a1111111-1111-4111-8111-111111111111","stateId":null');
    expect(text).toContain('"modelInputOrder":2,"role":"entity_reference","label":"Kuro / awakened","entityId":"b2222222-2222-4222-8222-222222222222","stateId":"c3333333-3333-4333-8333-333333333333"');
    expect(text).toContain('"modelInputOrder":3,"role":"layout_reference","label":"layout","entityId":null,"stateId":null');
  });

  it.each([
    ['malformed JSON', { status: 'completed', output_text: '{nope' }],
    ['refusal', { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }],
  ])('%s の構造化応答は生成前に拒否する', async (_label, body) => {
    const postJson = vi.fn().mockResolvedValue({ requestId: 'request-fail', body });
    const auditor = new OpenAIPagePreRenderSceneAuditor({ postJson } as unknown as OpenAIClient);
    await expect(auditor.audit({
      prompt: 'scene', compilerBrief: 'brief', internalPlan: null,
      inputSnapshot: { pageId: 'page', requestKind: 'initial', generationMode: 'standard', panelCount: 1, panels: [] }, inputImages: [],
    })).rejects.toThrow();
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('schema上は合法でもruntime契約違反のdirectiveを拒否する', async () => {
    const postJson = vi.fn().mockResolvedValue({ requestId: 'request-contract', body: {
      status: 'completed', output_text: JSON.stringify({ verdict: 'guidance', directives: [
        { panel_order: 1, kind: 'appearance', entity_ids: ['a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222'] },
      ] }),
    } });
    const auditor = new OpenAIPagePreRenderSceneAuditor({ postJson } as unknown as OpenAIClient);
    await expect(auditor.audit({
      prompt: 'scene', compilerBrief: 'brief', internalPlan: null,
      inputSnapshot: {
        pageId: 'page', requestKind: 'initial', generationMode: 'standard', panelCount: 1,
        panels: [{ panelId: 'panel', order: 1, entityIds: ['a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222'], entityNames: ['A', 'B'], dialogue: [] }],
      }, inputImages: [],
    })).rejects.toThrow();
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('transport失敗は監査を失敗させて後続生成へ進めない', async () => {
    const postJson = vi.fn().mockRejectedValue(new Error('transport unavailable'));
    const auditor = new OpenAIPagePreRenderSceneAuditor({ postJson } as unknown as OpenAIClient);
    await expect(auditor.audit({
      prompt: 'scene', compilerBrief: 'brief', internalPlan: null,
      inputSnapshot: { pageId: 'page', requestKind: 'initial', generationMode: 'standard', panelCount: 1, panels: [] }, inputImages: [],
    })).rejects.toThrow('transport unavailable');
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('Unicode astral文字のpromptが32k code point以内なら送信する', async () => {
    const postJson = vi.fn().mockResolvedValue({ requestId: 'request-unicode', body: {
      status: 'completed', output_text: JSON.stringify({ verdict: 'pass', directives: [] }),
    } });
    const auditor = new OpenAIPagePreRenderSceneAuditor({ postJson } as unknown as OpenAIClient);
    await expect(auditor.audit({
      prompt: '😀'.repeat(32_000), compilerBrief: 'brief', internalPlan: null,
      inputSnapshot: { pageId: 'page', requestKind: 'initial', generationMode: 'standard', panelCount: 1, panels: [] }, inputImages: [],
    })).resolves.toEqual({ verdict: 'pass', directives: [] });
    expect(postJson).toHaveBeenCalledTimes(1);
  });
});
