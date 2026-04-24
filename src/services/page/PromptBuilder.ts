import { getPanelFrameTemplate } from '../../domain/constants/panelFrameTemplates.js';
import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { Entity } from '../../domain/types/entity.js';
import type { Panel } from '../../domain/types/panel.js';
import type { CompositionGalleryItem } from '../../domain/types/composition.js';
import type { PageDialogueMode, PagePromptContext } from '../../domain/types/page.js';
import type { PageGenerationMode, PageGenerationRequestKind } from '../../domain/types/pageGeneration.js';
import type { CompositionGalleryRepository } from '../../repositories/CompositionGalleryRepository.js';
import type { EntityRepository } from '../../repositories/EntityRepository.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { PanelRepository } from '../../repositories/PanelRepository.js';
import type { PanelDialogueLine } from '../../domain/types/panel.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';

export interface BuildPagePromptInput {
  userId: string;
  pageId: string;
  generationMode: PageGenerationMode;
  requestKind: PageGenerationRequestKind;
}

export interface BuiltPagePrompt {
  prompt: string;
}

export interface PromptBuilderPort {
  buildPagePrompt(input: BuildPagePromptInput): Promise<BuiltPagePrompt>;
}

export class PromptBuilder implements PromptBuilderPort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly panelRepository: PanelRepository,
    private readonly entityRepository: EntityRepository,
    private readonly compositionGalleryRepository: CompositionGalleryRepository,
  ) {}

  public async buildPagePrompt(input: BuildPagePromptInput): Promise<BuiltPagePrompt> {
    const page = await this.pageRepository.findPromptContextByIdAndUserId(input.pageId, input.userId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    const panels = await this.panelRepository.findPanelsByPageIdAndUserId(input.pageId, input.userId);
    if (panels.length === 0) {
      throw new ValidationError('Page must have at least one panel before generation');
    }

    const entities = await this.entityRepository.findByWorkIdAndUserId(page.workId, input.userId);
    const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
    const compositionGalleryItems = await this.compositionGalleryRepository.findByIds(
      panels
        .map((panel) => panel.composition.galleryItemId)
        .filter((value): value is string => typeof value === 'string'),
    );
    const compositionMap = new Map(compositionGalleryItems.map((item) => [item.id, item]));

    return {
      prompt: buildPromptText(page, panels, entityMap, compositionMap, input),
    };
  }
}

function buildPromptText(
  page: PagePromptContext,
  panels: Panel[],
  entityMap: Map<string, Entity>,
  compositionMap: Map<string, CompositionGalleryItem>,
  input: BuildPagePromptInput,
): string {
  const sections = [
    buildPageHeader(page, input),
    buildLayoutInstruction(page),
    ...panels.map((panel) => buildPanelInstruction(panel, entityMap, compositionMap)),
    buildDialogueInstruction(page.dialogueMode, page.pageDialogueToggle, panels, entityMap),
    STYLE_LOCK_TEXT,
  ];

  return sections.filter((section) => section.length > 0).join('\n\n');
}

function buildPageHeader(page: PagePromptContext, input: BuildPagePromptInput): string {
  const headerLines = [
    `This is page ${page.pageNumber} of the episode${page.episodePurpose === null ? '.' : `: ${page.episodePurpose}`}`,
    `Request kind: ${input.requestKind}.`,
    `Generation mode: ${input.generationMode}.`,
  ];

  return headerLines.join('\n');
}

function buildLayoutInstruction(page: PagePromptContext): string {
  const layoutType = readString(page.layoutConfig.type);
  if (layoutType === 'template') {
    const templateId = readString(page.layoutConfig.template_id);
    if (templateId !== null && isKnownTemplateId(templateId)) {
      const template = getPanelFrameTemplate(templateId);
      return `Use a ${template.id} layout with ${template.panelCount} panels.`;
    }
  }

  if (layoutType === 'custom') {
    return 'Follow the custom panel layout defined for this page exactly.';
  }

  if (layoutType === 'ai_generated' || layoutType === 'ai_auto') {
    return 'Use the AI-suggested panel arrangement stored for this page.';
  }

  return 'Preserve the intended manga page reading flow and panel separation.';
}

function buildPanelInstruction(
  panel: Panel,
  entityMap: Map<string, Entity>,
  compositionMap: Map<string, CompositionGalleryItem>,
): string {
  const lines = [
    `Panel ${panel.order} (${panel.panelRole}, ${panel.panelSize}): ${panel.situationText ?? 'No explicit situation text.'}`,
    `Characters: ${buildEntityInstruction(panel.entities, entityMap)}`,
    `Composition: ${buildCompositionInstruction(panel, compositionMap)}`,
  ];

  if (panel.backgroundNote !== null) {
    lines.push(`Background: ${panel.backgroundNote}`);
  }

  if (panel.panelNotes !== null) {
    lines.push(`Panel notes: ${panel.panelNotes}`);
  }

  return lines.join('\n');
}

function buildEntityInstruction(
  assignments: PanelEntityAssignment[],
  entityMap: Map<string, Entity>,
): string {
  if (assignments.length === 0) {
    return 'No assigned entities.';
  }

  return assignments
    .map((assignment, index) => {
      const entity = entityMap.get(assignment.entityId);
      const entityName = entity?.name ?? `Unknown entity ${assignment.entityId}`;
      const supplement = entity?.promptSupplement ?? entity?.freeDescription ?? 'No prompt supplement.';
      const expression = assignment.expression === 'custom' ? assignment.customExpression : assignment.expression;
      const action = assignment.action === 'custom' ? assignment.customAction : assignment.action;

      return [
        `Image ${index + 1} is the appearance reference for ${entityName}. Keep face, hair, and costume consistent throughout the page.`,
        `${entityName}: role=${assignment.role}, position=${assignment.position}, expression=${expression ?? 'unspecified'}, action=${action ?? 'unspecified'}. ${supplement}`,
      ].join(' ');
    })
    .join(' ');
}

function buildCompositionInstruction(
  panel: Panel,
  compositionMap: Map<string, CompositionGalleryItem>,
): string {
  const parts: string[] = [];
  if (panel.composition.source === 'gallery' && panel.composition.galleryItemId !== null) {
    const galleryItem = compositionMap.get(panel.composition.galleryItemId);
    if (galleryItem !== undefined) {
      parts.push(galleryItem.compositionPrompt);
      parts.push(`Shot type: ${galleryItem.shotType}.`);
      parts.push(`Angle: ${galleryItem.angle}.`);
    }
  }

  if (panel.composition.compositionPrompt !== null) {
    parts.push(panel.composition.compositionPrompt);
  }

  if (panel.composition.shotType !== null) {
    parts.push(`Shot type: ${panel.composition.shotType}.`);
  }

  if (panel.composition.angle !== null) {
    parts.push(`Angle: ${panel.composition.angle}.`);
  }

  if (panel.composition.customNote !== null) {
    parts.push(`Custom note: ${panel.composition.customNote}.`);
  }

  if (panel.sfxText !== null) {
    parts.push(`SFX: ${panel.sfxText}.`);
  }

  return parts.length === 0 ? 'No special composition notes.' : parts.join(' ');
}

function buildDialogueInstruction(
  dialogueMode: PageDialogueMode,
  pageDialogueToggle: boolean,
  panels: Panel[],
  entityMap: Map<string, Entity>,
): string {
  if (!pageDialogueToggle || dialogueMode === 'balloon_only') {
    return '';
  }

  const dialogueLines = panels.flatMap((panel) => {
    if (dialogueMode === 'mixed' && !panel.dialogueInPanel) {
      return [];
    }

    const panelDialogueLines = panel.dialogue.map((dialogue) => formatDialogueLine(panel.order, dialogue, entityMap));
    if (panel.sfxText !== null) {
      panelDialogueLines.push(`SFX in panel ${panel.order}: '${panel.sfxText}' in manga-style lettering.`);
    }
    return panelDialogueLines;
  });

  return dialogueLines.length === 0 ? '' : dialogueLines.join('\n');
}

function formatDialogueLine(
  panelOrder: number,
  dialogue: PanelDialogueLine,
  entityMap: Map<string, Entity>,
): string {
  const speaker = dialogue.entityId === null ? null : entityMap.get(dialogue.entityId)?.name ?? 'Unknown speaker';
  const prefix =
    speaker === null
      ? `Panel ${panelOrder} dialogue`
      : `Panel ${panelOrder} dialogue by ${speaker}`;

  return `${prefix}: '${dialogue.text}' as ${dialogue.type} at ${dialogue.position}.`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isKnownTemplateId(value: string): value is Parameters<typeof getPanelFrameTemplate>[0] {
  return (
    value === 'standard_4' ||
    value === 'top_wide_3' ||
    value === 'standard_6' ||
    value === 'dense_8' ||
    value === 'climax_2' ||
    value === 'splash_1' ||
    value === 'action_5' ||
    value === 'battle_7'
  );
}

const STYLE_LOCK_TEXT =
  'Style: anime manga illustration, clean black line art, flat colors with manga-style shading, panel borders with gutters, reading order right-to-left, no photorealistic rendering, no western comic style.';
