import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import type { EpisodePagePlanSuggestion } from '../../../../src/domain/types/page.js';
import type { EpisodePlanAudit } from '../../../../src/services/page/EpisodePlanAuditCompiler.js';
import {
  applyEpisodePlanAuditRepairs,
  hasBlockingEpisodePlanAuditIssues,
} from '../../../../src/services/page/EpisodePlanReviewRepair.js';

function buildSuggestion(): EpisodePagePlanSuggestion {
  return {
    pages: [
      {
        pageId: '11111111-1111-4111-8111-111111111111',
        pageNumber: 1,
        sourceSceneIds: [],
        pagePurpose: 'Keep the page purpose.',
        continuityNote: 'Keep the continuity note.',
        page: {
          dialogueMode: 'image_baked',
          pageDialogueToggle: true,
        },
        panels: [
          {
            order: 1,
            panelRole: 'establish',
            panelSize: 'large',
            situationText: 'Old situation.',
            composition: {
              source: 'ai_auto',
              galleryItemId: null,
              compositionPrompt: 'Keep this composition.',
              shotType: 'wide',
              angle: 'front',
              customNote: null,
            },
            dialogueInPanel: true,
            dialogue: [],
            sfxText: null,
            backgroundNote: 'Keep this background.',
            panelNotes: 'Keep these notes.',
            entities: [],
          },
        ],
      },
    ],
  };
}

function buildAudit(overrides: Partial<EpisodePlanAudit> = {}): EpisodePlanAudit {
  return {
    accepted: false,
    issues: [
      {
        code: 'timeline_discontinuity',
        severity: 'error',
        pageIds: ['11111111-1111-4111-8111-111111111111'],
        message: 'The situation rewinds the story.',
        repairInstruction: 'Advance the situation.',
      },
    ],
    pageRepairs: [],
    panelRepairs: [],
    ...overrides,
  };
}

describe('EpisodePlanReviewRepair', () => {
  it('warningだけの場合に生成結果を拒否しない', () => {
    const audit = buildAudit({
      accepted: false,
      issues: [
        {
          code: 'duplicate_visual_beat',
          severity: 'warning',
          pageIds: ['11111111-1111-4111-8111-111111111111'],
          message: 'The visual rhythm is similar.',
          repairInstruction: 'Vary it when practical.',
        },
      ],
    });

    expect(hasBlockingEpisodePlanAuditIssues(audit.issues)).toBe(false);
  });

  it('errorが1件でもある場合に生成結果を拒否する', () => {
    expect(hasBlockingEpisodePlanAuditIssues(buildAudit().issues)).toBe(true);
  });

  it('指定されたpanel fieldだけを変更し他の内容を保持する', () => {
    const suggestion = buildSuggestion();
    const repaired = applyEpisodePlanAuditRepairs({
      suggestion,
      knownPanelOrdersByPageId: new Map([
        ['11111111-1111-4111-8111-111111111111', new Set([1])],
      ]),
      audit: buildAudit({
        panelRepairs: [
          {
            pageId: '11111111-1111-4111-8111-111111111111',
            panelOrder: 1,
            changedFields: ['situationText'],
            patch: { situationText: 'New situation that advances the story.' },
          },
        ],
      }),
    });

    expect(repaired.pages[0]?.panels[0]?.situationText).toBe(
      'New situation that advances the story.',
    );
    expect(repaired.pages[0]?.panels[0]?.backgroundNote).toBe('Keep this background.');
    expect(repaired.pages[0]?.panels[0]?.composition?.compositionPrompt).toBe(
      'Keep this composition.',
    );
    expect(repaired.pages[0]?.pagePurpose).toBe('Keep the page purpose.');
    expect(suggestion.pages[0]?.panels[0]?.situationText).toBe('Old situation.');
  });

  it('error対象でないページへの修復を拒否する', () => {
    const suggestion = buildSuggestion();

    expect(() =>
      applyEpisodePlanAuditRepairs({
        suggestion,
        knownPanelOrdersByPageId: new Map([
          ['11111111-1111-4111-8111-111111111111', new Set([1])],
        ]),
        audit: buildAudit({
          issues: [
            {
              code: 'timeline_discontinuity',
              severity: 'error',
              pageIds: ['22222222-2222-4222-8222-222222222222'],
              message: 'Another page has the error.',
              repairInstruction: 'Repair that page only.',
            },
          ],
          panelRepairs: [
            {
              pageId: '11111111-1111-4111-8111-111111111111',
              panelOrder: 1,
              changedFields: ['situationText'],
              patch: { situationText: 'Unauthorized repair.' },
            },
          ],
        }),
      }),
    ).toThrow(ConfigurationError);
  });

  it('存在しないpanel orderへの修復を拒否する', () => {
    expect(() =>
      applyEpisodePlanAuditRepairs({
        suggestion: buildSuggestion(),
        knownPanelOrdersByPageId: new Map([
          ['11111111-1111-4111-8111-111111111111', new Set([1])],
        ]),
        audit: buildAudit({
          panelRepairs: [
            {
              pageId: '11111111-1111-4111-8111-111111111111',
              panelOrder: 2,
              changedFields: ['situationText'],
              patch: { situationText: 'Unknown panel.' },
            },
          ],
        }),
      }),
    ).toThrow(ConfigurationError);
  });

  it('複数のerrorの一部にしかfield-level repairがない場合は拒否する', () => {
    const suggestion = buildSuggestion();
    const firstPage = suggestion.pages[0]!;
    suggestion.pages.push({
      ...firstPage,
      pageId: '22222222-2222-4222-8222-222222222222',
      pageNumber: 2,
      panels: firstPage.panels.map((panel) => ({ ...panel })),
    });

    expect(() =>
      applyEpisodePlanAuditRepairs({
        suggestion,
        knownPanelOrdersByPageId: new Map([
          ['11111111-1111-4111-8111-111111111111', new Set([1])],
          ['22222222-2222-4222-8222-222222222222', new Set([1])],
        ]),
        audit: buildAudit({
          issues: [
            {
              code: 'timeline_discontinuity',
              severity: 'error',
              pageIds: ['11111111-1111-4111-8111-111111111111'],
              message: 'Page 1 rewinds the story.',
              repairInstruction: 'Advance page 1.',
            },
            {
              code: 'dialogue_misplacement',
              severity: 'error',
              pageIds: ['22222222-2222-4222-8222-222222222222'],
              message: 'Page 2 places dialogue too early.',
              repairInstruction: 'Move the dialogue on page 2.',
            },
          ],
          panelRepairs: [
            {
              pageId: '11111111-1111-4111-8111-111111111111',
              panelOrder: 1,
              changedFields: ['situationText'],
              patch: { situationText: 'Page 1 now advances the story.' },
            },
          ],
        }),
      }),
    ).toThrow('without a field-level repair');
  });
});
