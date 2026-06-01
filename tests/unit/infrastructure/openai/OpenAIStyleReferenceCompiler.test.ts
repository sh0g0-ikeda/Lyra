import { describe, expect, it } from 'vitest';
import { OpenAIStyleReferenceCompiler } from '../../../../src/infrastructure/openai/OpenAIStyleReferenceCompiler.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

describe('OpenAIStyleReferenceCompiler', () => {
  it('compiles a named style reference into brief and anchors', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);

        return {
          body: {
            output_text: JSON.stringify({
              compiled_brief:
                'Keep the title "AKIRA" explicit as a style constraint, with precise mechanical linework, heavy urban density, hard-edged shadows, and disciplined environment treatment.',
              anchors: {
                line_quality: 'precise mechanical linework with confident contour control',
                shape_language: 'hard-edged industrial forms with disciplined perspective',
                face_rendering: null,
                eye_rendering: null,
                hair_rendering: null,
                clothing_rendering: 'functional clothing folds with restrained stylization',
                background_rendering: 'dense urban structures with explicit depth and infrastructure detail',
                shading_rendering: 'hard-edged shadow blocks with restrained gradients',
                texture_finish: 'clean ink finish with selective grit in environments',
                motion_treatment: 'controlled action accents without abstract streak overload',
                dialogue_balloon_treatment: 'page remains readable when dialogue density rises',
                atmosphere: 'tense, heavy urban pressure',
              },
            }),
          },
          requestId: 'req-1',
        };
      },
    } as unknown as OpenAIClient;

    const compiler = new OpenAIStyleReferenceCompiler(client);
    const result = await compiler.compileStyleReference({
      target: 'manga_page',
      title: 'AKIRA',
      notes: '都市感を優先する',
    });

    expect(result.title).toBe('AKIRA');
    expect(result.compiledBrief).toContain('Keep the title "AKIRA" explicit');
    expect(result.anchors.lineQuality).toBe('precise mechanical linework with confident contour control');
    expect(result.compilerPromptVersion).toBe('style_ref_v3');

    const request = requests[0];
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const systemPrompt = input[0].content[0].text;
    const userPrompt = input[1].content[0].text;

    expect(systemPrompt).toContain('Return only valid JSON');
    expect(systemPrompt).toContain('hard style constraint');
    expect(userPrompt).toContain('Named style reference title: AKIRA');
    expect(userPrompt).toContain('"anchors"');
  });

  it('accepts JSON wrapped in extra text and camelCase anchor keys', async () => {
    const client = {
      postJson: async () => ({
        body: {
          output_text: [
            'Here is the result:',
            JSON.stringify({
              compiledBrief:
                'Keep the title "AKIRA" explicit as a style constraint, with hard industrial perspective and dense city structure.',
              anchors: {
                lineQuality: 'sharp mechanical lines',
                shapeLanguage: 'angular industrial masses',
                backgroundRendering: 'dense city blocks with clear infrastructure',
              },
            }),
          ].join('\n'),
        },
        requestId: 'req-2',
      }),
    } as unknown as OpenAIClient;

    const compiler = new OpenAIStyleReferenceCompiler(client);
    const result = await compiler.compileStyleReference({
      target: 'manga_page',
      title: 'AKIRA',
      notes: null,
    });

    expect(result.compiledBrief).toContain('Keep the title "AKIRA" explicit');
    expect(result.anchors.lineQuality).toBe('sharp mechanical lines');
    expect(result.anchors.shapeLanguage).toBe('angular industrial masses');
    expect(result.anchors.backgroundRendering).toBe(
      'dense city blocks with clear infrastructure',
    );
  });

  it('falls back to a deterministic brief when the model returns prose instead of JSON', async () => {
    const client = {
      postJson: async () => ({
        body: {
          output_text:
            'Keep the title "AKIRA" explicit as a style constraint. Use sharp mechanical linework, dense urban backgrounds, and hard shadow blocks.',
        },
        requestId: 'req-3',
      }),
    } as unknown as OpenAIClient;

    const compiler = new OpenAIStyleReferenceCompiler(client);
    const result = await compiler.compileStyleReference({
      target: 'manga_page',
      title: 'AKIRA',
      notes: '都市感を優先する',
    });

    expect(result.compiledBrief).toContain('Keep the title "AKIRA" explicit as a style constraint.');
    expect(result.anchors.lineQuality).toBeNull();
    expect(result.compilerPromptVersion).toBe('style_ref_v3');
  });
});
