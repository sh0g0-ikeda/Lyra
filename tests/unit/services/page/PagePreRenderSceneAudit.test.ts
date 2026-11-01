import { describe, expect, it } from 'vitest';
import type { PageGenerationInputSnapshot } from '../../../../src/domain/types/pageGeneration.js';
import {
  buildPageSceneGuidance,
  NoopPagePreRenderSceneAuditor,
  validatePagePreRenderSceneAudit,
  type PagePreRenderSceneAuditInput,
} from '../../../../src/services/page/PagePreRenderSceneAudit.js';

const snapshot: PageGenerationInputSnapshot = {
  pageId: 'page-1', requestKind: 'initial', generationMode: 'standard', panelCount: 2,
  panels: [
    { panelId: 'panel-1', order: 1, entityIds: ['ishii'], entityNames: ['Ishii'], dialogue: [] },
    { panelId: 'panel-2', order: 2, entityIds: ['ishii', 'sword'], entityNames: ['Ishii', 'Sword'], dialogue: [] },
  ],
};

const input: PagePreRenderSceneAuditInput = {
  prompt: 'Keep the authored scene.', compilerBrief: 'Panel 1 Ishii awakens.', inputSnapshot: snapshot,
  inputImages: [], internalPlan: null,
};

describe('PagePreRenderSceneAudit', () => {
  it('guidance は実在する割当だけを安全な定型補強へ変換する', () => {
    const result = validatePagePreRenderSceneAudit(input, {
      verdict: 'guidance',
      directives: [{ panelOrder: 1, kind: 'anatomy_motion', entityIds: ['ishii'] }],
    });

    expect(buildPageSceneGuidance(input, result)).toContain('Panel 1');
    expect(buildPageSceneGuidance(input, result)).toContain('original reference/state assignment');
    expect(buildPageSceneGuidance(input, result)).toContain('selected reference anatomy');
  });

  it('存在しないpanel又は未割当entityへのdirectiveを拒否する', () => {
    expect(() => validatePagePreRenderSceneAudit(input, {
      verdict: 'guidance', directives: [{ panelOrder: 3, kind: 'appearance', entityIds: ['ishii'] }],
    })).toThrow();
    expect(() => validatePagePreRenderSceneAudit(input, {
      verdict: 'guidance', directives: [{ panelOrder: 1, kind: 'appearance', entityIds: ['sword'] }],
    })).toThrow();
  });

  it('interactionは異なる2名だけを許可しpassとuncertainは空directiveを要求する', () => {
    expect(() => validatePagePreRenderSceneAudit(input, {
      verdict: 'guidance', directives: [{ panelOrder: 2, kind: 'interaction', entityIds: ['ishii'] }],
    })).toThrow();
    expect(() => validatePagePreRenderSceneAudit(input, {
      verdict: 'pass', directives: [{ panelOrder: 1, kind: 'appearance', entityIds: ['ishii'] }],
    })).toThrow();
    expect(validatePagePreRenderSceneAudit(input, { verdict: 'uncertain', directives: [] })).toEqual({
      verdict: 'uncertain', directives: [],
    });
  });

  it('Noopはlocal configuration時にuncertainを返す', async () => {
    await expect(new NoopPagePreRenderSceneAuditor().audit(input)).resolves.toEqual({ verdict: 'uncertain', directives: [] });
  });
});
