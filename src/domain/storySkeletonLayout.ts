import {
  PANEL_FRAME_TEMPLATE_IDS,
  PANEL_FRAME_TEMPLATES,
  getPanelFrameTemplateEditorialGuide,
  type PanelFrameTemplateEditorialGuide,
} from './constants/panelFrameTemplates.js';
import type { PanelFrameTemplateId } from './types/panelFrame.js';
import type { PageSkeletonPageDraft } from './types/storyAi.js';

/**
 * Chooses only when a skeleton has no compatible layout.  A valid model-selected
 * template is intentional editorial input and must survive normalization.
 */
export function selectStoryPurposeLayout(
  page: Pick<PageSkeletonPageDraft, 'purpose' | 'panels'>,
  pageIndex: number,
  totalPages: number,
): PanelFrameTemplateId {
  const panelCount = page.panels.length;
  const candidates = PANEL_FRAME_TEMPLATE_IDS.filter(
    (templateId) => PANEL_FRAME_TEMPLATES[templateId].panelCount === panelCount,
  );
  if (candidates.length === 0) {
    throw new Error(`No panel frame template supports ${panelCount} panels`);
  }

  const storyText = `${page.purpose} ${page.panels.map((panel) => panel.situationHint).join(' ')}`.toLowerCase();
  const hasImpact = page.panels.some((panel) => panel.panelRole === 'impact' || panel.panelRole === 'emphasis');
  const hasAction = page.panels.some((panel) => panel.panelRole === 'action');
  const dialoguePanels = page.panels.filter((panel) => panel.suggestedDialogueHint !== null).length;
  const opening = pageIndex === 0 || /(?:opening|introduc|establish|始まり|導入|登場|出会い)/u.test(storyText);
  const payoff =
    (pageIndex === totalPages - 1 && hasImpact) ||
    /(?:climax|payoff|reveal|decisive|impact|決着|正体|決定的|クライマックス)/u.test(storyText);
  const stagedAction = hasAction || /(?:action|fight|battle|chase|attack|戦闘|対決|追跡|攻撃)/u.test(storyText);

  return candidates.reduce((best, candidate) => {
    const bestScore = scoreLayout(getPanelFrameTemplateEditorialGuide(best), opening, payoff, stagedAction, dialoguePanels);
    const candidateScore = scoreLayout(
      getPanelFrameTemplateEditorialGuide(candidate),
      opening,
      payoff,
      stagedAction,
      dialoguePanels,
    );
    return candidateScore > bestScore ? candidate : best;
  });
}

function scoreLayout(
  guide: PanelFrameTemplateEditorialGuide,
  opening: boolean,
  payoff: boolean,
  stagedAction: boolean,
  dialoguePanels: number,
): number {
  let score = 0;
  if (opening && guide.focalPlacement === 'top') score += 8;
  if (payoff && (guide.focalPlacement === 'bottom' || guide.focalPlacement === 'tall' || guide.focalPlacement === 'full')) score += 8;
  if (stagedAction && guide.actionPacing === 'high') score += 5;
  if (dialoguePanels >= 2 && guide.dialogueRoom === 'high') score += 4;
  if (dialoguePanels === 0 && guide.dialogueRoom === 'low') score += 1;
  return score;
}
