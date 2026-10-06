import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEpisodeBeatPlanCompiler } from '../../../../src/infrastructure/openai/OpenAIEpisodeBeatPlanCompiler.js';
import { OpenAIPageEpisodePlanCompiler } from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';
import { prepareEpisodeSourceRequirementExtraction } from '../../../../src/services/page/EpisodeSourceRequirements.js';

const PAGE = '11111111-1111-4111-8111-111111111111';
// r51 exposed a false temporal edge from a later source sentence that actually
// constrains the whole page. Extraction order must not manufacture a dependency;
// an explicit dependency still uses the unchanged placement chronology gate.
async function compileScope(constraintAfterDialogue: boolean): Promise<unknown> {
  const extraction = prepareEpisodeSourceRequirementExtraction({
    storyFullDraft: '1ページ目：足を止めて息を整える。「ちゃんと、ここまで来られた」。階段の登りと休憩の位置関係を保ち、まだ灯りの装置には触れない。',
    pages: [{ pageId: PAGE, pageNumber: 1 }],
  })!;
  const nonblank = extraction.units.map((unit, index) => ({ unit, ordinal: index + 1 })).filter(({unit}) => unit.text.trim());
  const dialogue = nonblank.find(({unit}) => unit.text.includes('ちゃんと、ここまで来られた'))!;
  const constraint = nonblank.find(({unit}) => unit.text.includes('装置には触れない'))!;
  const event = nonblank[0]!;
  const requirementId = (ordinal: number): string => extraction.units[ordinal - 1]!.unitId + '-r' + ordinal;
  const sourceClient = {
    postJson: async () => ({
      body: { output_text: JSON.stringify({requirements: nonblank.map(({unit, ordinal}) => ({
        k: 'e', i: ordinal, u: ordinal,
        e: [unit.fragmentCatalog[0]!.id], r: [null],
        c: [ordinal === constraint.ordinal ? unit.fragmentCatalog[0]!.id : null], z: [true],
        a: ordinal === dialogue.ordinal ? [event.ordinal] : ordinal === constraint.ordinal && constraintAfterDialogue ? [dialogue.ordinal] : [],
        x: [], q: [],
      }))}) }, requestId: 'scope-source',
    }),
  } as unknown as OpenAIClient;
  const extracted = await new OpenAIEpisodeBeatPlanCompiler(sourceClient).compileSourceRequirements({extraction, language: 'ja'});
  expect(extracted.requirements.requirements.find(value => value.requirementId === requirementId(constraint.ordinal))?.afterRequirementIds)
    .toEqual(constraintAfterDialogue ? [requirementId(dialogue.ordinal)] : []);
  expect(extracted.requirements.requirements.find(value => value.requirementId === requirementId(dialogue.ordinal))?.afterRequirementIds)
    .toEqual([requirementId(event.ordinal)]);
  const detailClient = {
    postJson: async () => ({body: {output_text: JSON.stringify({
      source_requirement_placements: nonblank.map(({ordinal}) => ({
        requirement_id: requirementId(ordinal), page_id: PAGE,
        panel_orders: ordinal === constraint.ordinal ? [2,3,4] : ordinal === dialogue.ordinal ? [4] : [3],
      })),
      pages: [{page_id: PAGE, page_number: 1, panels: [1,2,3,4].map(order => ({order, entities: []}))}],
    })}, requestId: 'scope-detail'}),
  } as unknown as OpenAIClient;
  return new OpenAIPageEpisodePlanCompiler(detailClient).compilePlan({
    compilerBrief: extraction.compilerBrief, language: 'ja', sourceOwnedPageContext: true,
    sourceRequirements: extracted.requirements, sourceRequirementPlacementPageIds: [PAGE],
  });
}

describe('原文の継続条件と出来事順序を別々に扱う', () => {
  it('後の文にある継続条件にafter関係がない場合は前後のコマへの適用を許可する', async () => {
    await expect(compileScope(false)).resolves.toMatchObject({compilerProvider: 'openai'});
  });
  it('同じ条件に明示after関係がある場合は前提より早いコマ配置を引き続き拒否する', async () => {
    await expect(compileScope(true)).rejects.toThrow('relation contradicts panel order');
  });
});
