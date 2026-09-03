import {
  PANEL_FRAME_TEMPLATES,
  getPanelFrameTemplate,
} from '../../domain/constants/panelFrameTemplates.js';
import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { CompositionGalleryItem } from '../../domain/types/composition.js';
import type { Entity } from '../../domain/types/entity.js';
import type { Panel, PanelDialogueLine } from '../../domain/types/panel.js';
import type { PageDialogueMode, PagePromptContext } from '../../domain/types/page.js';
import type {
  PageGenerationInputSnapshot,
  PageGenerationMode,
  PageGenerationRequestKind,
} from '../../domain/types/pageGeneration.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';
import { buildRenderingStyleAnchorLines } from '../../domain/types/styleReference.js';
import type { CompositionGalleryRepository } from '../../repositories/CompositionGalleryRepository.js';
import type { EntityRepository } from '../../repositories/EntityRepository.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { PanelRepository } from '../../repositories/PanelRepository.js';

export interface BuildPagePromptInput {
  userId: string;
  organizationId?: string | null;
  pageId: string;
  generationMode: PageGenerationMode;
  requestKind: PageGenerationRequestKind;
}

export interface BuiltPagePrompt {
  workId: string;
  draftPrompt: string;
  compilerBrief: string;
  inputSnapshot: PageGenerationInputSnapshot;
}

export interface PromptBuilderPort {
  buildPagePrompt(input: BuildPagePromptInput): Promise<BuiltPagePrompt>;
}

interface NormalizedReferenceRole {
  entityId: string | null;
  imageLabel: string;
  role: 'character_reference' | 'layout_reference';
  subject: string;
  instruction: string;
}

interface NormalizedPanelInstruction {
  order: number;
  role: string;
  size: string;
  situation: string;
  subjectLock: string | null;
  characterBeat: string;
  compositionBeat: string;
  dialogueBeats: string[];
  dialogueLock: string | null;
  visualLock: string | null;
}

interface NormalizedPagePrompt {
  pageSummary: string;
  pageSetting: string;
  referenceRoles: NormalizedReferenceRole[];
  layoutInstruction: string;
  panelInstructions: NormalizedPanelInstruction[];
  qualityConstraints: string[];
  negativeConstraints: string[];
  styleLock: string;
  compilerStyleLock: string;
  dialogueMode: PageDialogueMode;
}

export class PromptBuilder implements PromptBuilderPort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly panelRepository: PanelRepository,
    private readonly entityRepository: EntityRepository,
    private readonly compositionGalleryRepository: CompositionGalleryRepository,
  ) {}

  public async buildPagePrompt(input: BuildPagePromptInput): Promise<BuiltPagePrompt> {
    const page = await this.pageRepository.findPromptContextByIdAndUserId(
      input.pageId,
      input.userId,
      input.organizationId ?? null,
    );
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    const panels = await this.panelRepository.findPanelsByPageIdAndUserId(
      input.pageId,
      input.userId,
      input.organizationId ?? null,
    );
    if (panels.length === 0) {
      throw new ValidationError('Page must have at least one panel before generation');
    }

    const organizationId = page.organizationId ?? input.organizationId ?? null;
    const entities = await this.entityRepository.findByWorkIdAndUserId(page.workId, input.userId, organizationId);
    const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
    // Fetch the exact reference set used by the renderer so "Image 1 / Image 2 ..."
    // in the compiled prompt always matches the actual uploaded image order.
    const referencedEntityIds = new Set(
      (
        await this.entityRepository.findPrimaryReferenceImagesByEntityIdsAndUserId(
          collectOrderedEntityIds(panels),
          page.workId,
          input.userId,
          organizationId,
        )
      ).map((reference) => reference.entityId),
    );
    const compositionGalleryItems = await this.compositionGalleryRepository.findByIds(
      panels
        .map((panel) => panel.composition.galleryItemId)
        .filter((value): value is string => typeof value === 'string'),
    );
    const compositionMap = new Map(compositionGalleryItems.map((item) => [item.id, item]));

    const normalized = normalizePagePrompt(
      page,
      panels,
      entityMap,
      compositionMap,
      referencedEntityIds,
      input,
    );

    return {
      workId: page.workId,
      draftPrompt: buildDraftPrompt(normalized),
      compilerBrief: buildCompilerBrief(normalized),
      inputSnapshot: buildPageGenerationInputSnapshot(input.pageId, input, panels, entityMap),
    };
  }
}

function buildPageGenerationInputSnapshot(
  pageId: string,
  input: BuildPagePromptInput,
  panels: Panel[],
  entityMap: Map<string, Entity>,
): PageGenerationInputSnapshot {
  const orderedPanels = [...panels].sort((left, right) => left.order - right.order);
  return {
    pageId,
    requestKind: input.requestKind,
    generationMode: input.generationMode,
    panelCount: orderedPanels.length,
    panels: orderedPanels.map((panel) => {
      const entityIds = panel.entities
        .slice()
        .sort((left, right) => assignmentRoleWeight(left.role) - assignmentRoleWeight(right.role))
        .map((assignment) => assignment.entityId)
        .filter((value, index, values) => values.indexOf(value) === index);

      return {
        panelId: panel.id,
        order: panel.order,
        entityIds,
        entityNames: entityIds.map((entityId) => entityMap.get(entityId)?.name ?? entityId),
        dialogue: panel.dialogue.map((dialogue) => ({
          entityId: dialogue.entityId,
          speakerName: dialogue.entityId === null ? null : entityMap.get(dialogue.entityId)?.name ?? dialogue.entityId,
          type: dialogue.type,
          position: dialogue.position,
          text: dialogue.text,
        })),
      };
    }),
  };
}

// The deterministic layer keeps panel order, dialogue, reference roles, and layout fidelity explicit
// so the LLM compiler only has to rewrite the brief into model-friendly prose instead of inferring structure.
function normalizePagePrompt(
  page: PagePromptContext,
  panels: Panel[],
  entityMap: Map<string, Entity>,
  compositionMap: Map<string, CompositionGalleryItem>,
  referencedEntityIds: Set<string>,
  input: BuildPagePromptInput,
): NormalizedPagePrompt {
  const orderedPanels = [...panels].sort((left, right) => left.order - right.order);
  assertContiguousPanelOrder(orderedPanels);
  const referenceRoles = buildReferenceRoles(page, orderedPanels, entityMap, referencedEntityIds);
  const referenceLabelByEntityId = buildReferenceLabelMap(referenceRoles);

  return {
    pageSummary: buildPageSummary(page, input, orderedPanels.length),
    pageSetting: buildPageSetting(page),
    referenceRoles,
    layoutInstruction: buildLayoutInstruction(page, orderedPanels.length),
    panelInstructions: orderedPanels.map((panel, index) =>
      buildNormalizedPanelInstruction(
        panel,
        orderedPanels[index - 1] ?? null,
        entityMap,
        compositionMap,
        referenceLabelByEntityId,
        shouldBakeDialogueForPanel(page, panel),
      ),
    ),
    qualityConstraints: buildQualityConstraints(page, orderedPanels.length, referenceRoles),
    negativeConstraints: buildNegativeConstraints(page),
    styleLock: buildStyleLock(page, STYLE_PROMPT_TEXT_LIMITS),
    compilerStyleLock: buildStyleLock(page, COMPILER_STYLE_PROMPT_TEXT_LIMITS),
    dialogueMode: page.dialogueMode,
  };
}

function assertContiguousPanelOrder(panels: Panel[]): void {
  if (panels.length === 0) {
    return;
  }

  if (panels[0]?.order !== 1) {
    throw new ValidationError('Panels must start at order 1 before generation');
  }

  for (let index = 1; index < panels.length; index += 1) {
    const previousOrder = panels[index - 1]?.order;
    const currentOrder = panels[index]?.order;
    if (previousOrder === undefined || currentOrder === undefined) {
      continue;
    }

    if (currentOrder === previousOrder) {
      throw new ValidationError(`Duplicate panel order ${currentOrder} is not allowed before generation`);
    }

    if (currentOrder !== previousOrder + 1) {
      throw new ValidationError('Panels must use contiguous order values before generation');
    }
  }
}

function buildPageSummary(
  page: PagePromptContext,
  input: BuildPagePromptInput,
  panelCount: number,
): string {
  const purpose = page.episodePurpose === null ? 'the current episode beat' : page.episodePurpose;
  return `Create page ${page.pageNumber} of the episode, covering ${purpose}. This is a ${panelCount}-panel manga page for a fresh ${input.generationMode} generation request based only on the current saved page inputs. Render one new finished manga page image, not separated panel assets, and preserve the authored panel order from panel ${1} through panel ${panelCount}. Do not treat this as an edit, continuation, or restoration of any previously generated page image.`;
}

function buildPageSetting(page: PagePromptContext): string {
  const parts: string[] = [];

  if (page.sceneSummaries.length === 0) {
    parts.push(
      'No explicit scene summary is stored, so infer the immediate setting and atmosphere from the panel instructions alone.',
    );
  } else {
    parts.push(`Page setting continuity: ${page.sceneSummaries.map((scene) => normalizeSentence(scene)).join(' ')}`);
  }

  if (page.storyPagePurpose !== null) {
    parts.push(`Page purpose: ${normalizeSentence(page.storyPagePurpose)}`);
  }

  if (page.storyContinuityNote !== null) {
    parts.push(`Continuity note: ${normalizeSentence(page.storyContinuityNote)}`);
  }

  return parts.join(' ');
}

function buildReferenceRoles(
  page: PagePromptContext,
  panels: Panel[],
  entityMap: Map<string, Entity>,
  referencedEntityIds: Set<string>,
): NormalizedReferenceRole[] {
  const orderedAssignments = new Map<string, PanelEntityAssignment>();
  const panelOrdersByEntityId = new Map<string, number[]>();
  for (const panel of panels) {
    for (const assignment of panel.entities) {
      if (!orderedAssignments.has(assignment.entityId)) {
        orderedAssignments.set(assignment.entityId, assignment);
      }

      const panelOrders = panelOrdersByEntityId.get(assignment.entityId) ?? [];
      if (!panelOrders.includes(panel.order)) {
        panelOrders.push(panel.order);
      }
      panelOrdersByEntityId.set(assignment.entityId, panelOrders);
    }
  }

  const roles: NormalizedReferenceRole[] = Array.from(orderedAssignments.keys())
    .filter((entityId) => referencedEntityIds.has(entityId))
    .map((entityId, index) => {
      const entity = entityMap.get(entityId);
      const entityName = entity?.name ?? `Unknown entity ${entityId}`;
      const anchor = summarizeEntityAnchor(entity);
      const panelScope = formatPanelOrderList(panelOrdersByEntityId.get(entityId) ?? []);
      return {
        entityId,
        imageLabel: `Image ${index + 1} (${entityName})`,
        role: 'character_reference' as const,
        subject: entityName,
        instruction: `${entityName} character reference. Use this image only for ${entityName}; never use it as another character. ${entityName} is allowed only in ${panelScope} where listed in the subject lock. Keep ${entityName}'s face, hair shape, clothing silhouette, and color blocking stable when ${entityName} appears. ${anchor}`.trim(),
      };
    });

  if (page.layoutConfig.type === 'custom') {
    roles.push({
      entityId: null,
      imageLabel: `Image ${roles.length + 1} (layout)`,
      role: 'layout_reference',
      subject: 'page layout',
      instruction:
        'Layout reference. Follow the panel borders, gutter rhythm, page balance, and reading order exactly. Use it only for layout, not for art style or scene content.',
    });
  }

  return roles;
}

function buildReferenceLabelMap(referenceRoles: NormalizedReferenceRole[]): Map<string, string> {
  return new Map(
    referenceRoles.flatMap((role) =>
      role.role === 'character_reference' && role.entityId !== null
        ? [[role.entityId, role.imageLabel] as const]
        : [],
    ),
  );
}

function buildNormalizedPanelInstruction(
  panel: Panel,
  _previousPanel: Panel | null,
  entityMap: Map<string, Entity>,
  compositionMap: Map<string, CompositionGalleryItem>,
  referenceLabelByEntityId: Map<string, string>,
  includeDialogue: boolean,
): NormalizedPanelInstruction {
  return {
    order: panel.order,
    role: panel.panelRole,
    size: panel.panelSize,
    situation: normalizePanelSituation(panel.situationText),
    subjectLock: buildSubjectLock(panel, entityMap, referenceLabelByEntityId),
    characterBeat: buildCharacterBeat(panel.entities, entityMap, referenceLabelByEntityId),
    compositionBeat: buildCompositionBeat(panel, compositionMap),
    dialogueBeats: includeDialogue ? buildDialogueBeats(panel, entityMap, referenceLabelByEntityId) : [],
    dialogueLock: includeDialogue ? buildDialogueLock(panel, entityMap, referenceLabelByEntityId) : null,
    visualLock: buildVisualLock(panel, entityMap, compositionMap, referenceLabelByEntityId),
  };
}

function buildSubjectLock(
  panel: Panel,
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
): string {
  const assignments = dedupeAssignmentsByEntity(panel.entities);
  if (assignments.length === 0) {
    return `Panel ${panel.order} subject lock: no named character is assigned to this panel; do not draw any named or referenced character in this panel. Background crowds must remain generic only.`;
  }

  const details = assignments.map((assignment) => {
    const entity = entityMap.get(assignment.entityId);
    const entityName = entity?.name ?? `Unknown entity ${assignment.entityId}`;
    const referenceLabel = referenceLabelByEntityId.get(assignment.entityId);
    const visualAnchor = summarizeEntityVisualIdentity(entity);
    const position = `${humanizeToken(assignment.position)} zone`;
    const facing = assignment.facingDirection === null
      ? null
      : `facing ${humanizeToken(assignment.facingDirection)}`;
    return [
      entityName,
      referenceLabel === undefined ? null : `reference ${referenceLabel}`,
      visualAnchor === null ? null : `visual identity ${visualAnchor}`,
      `role ${assignment.role}`,
      position,
      facing,
    ]
      .filter((value): value is string => value !== null)
      .join(', ');
  });

  return `Panel ${panel.order} subject lock: required visible subjects are ${details.join('; ')}. Every listed subject must be visibly present and recognizable in this panel. Do not substitute, merge, swap, or replace these subjects with any other character or reference image. Do not draw unassigned named or referenced characters in this panel.`;
}

function dedupeAssignmentsByEntity(assignments: PanelEntityAssignment[]): PanelEntityAssignment[] {
  const orderedAssignments = assignments
    .slice()
    .sort((left, right) => assignmentRoleWeight(left.role) - assignmentRoleWeight(right.role));
  const seen = new Set<string>();
  return orderedAssignments.filter((assignment) => {
    if (seen.has(assignment.entityId)) {
      return false;
    }

    seen.add(assignment.entityId);
    return true;
  });
}

function buildCharacterBeat(
  assignments: PanelEntityAssignment[],
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
): string {
  if (assignments.length === 0) {
    return 'No character is explicitly assigned to this panel.';
  }

  return assignments
    .map((assignment) => {
      const entity = entityMap.get(assignment.entityId);
      const entityName = entity?.name ?? `Unknown entity ${assignment.entityId}`;
      const referenceLabel = referenceLabelByEntityId.get(assignment.entityId);
      const visualAnchor = summarizeEntityVisualIdentity(entity);
      const expression = assignment.expression === 'custom' ? assignment.customExpression : assignment.expression;
      const action = assignment.action === 'custom' ? assignment.customAction : assignment.action;
      const parts = [
        [
          entityName,
          referenceLabel === undefined ? null : `reference ${referenceLabel}`,
          visualAnchor === null ? null : `visual identity ${visualAnchor}`,
        ].filter((value): value is string => value !== null).join(', '),
        `is ${assignment.role} in the ${assignment.position} zone`,
        assignment.facingDirection === null ? null : `facing ${humanizeToken(assignment.facingDirection)}`,
        expression === null ? null : `showing ${humanizeToken(expression)}`,
        action === null ? null : `with ${humanizeToken(action)} body language`,
        assignment.effectNote === null ? null : `accented by ${normalizeSentence(assignment.effectNote, false)}`,
      ].filter((value): value is string => value !== null);

      return `${parts.join(', ')}.`;
    })
    .join(' ');
}

function buildCompositionBeat(
  panel: Panel,
  compositionMap: Map<string, CompositionGalleryItem>,
): string {
  const parts: string[] = [];

  if (panel.composition.source === 'gallery' && panel.composition.galleryItemId !== null) {
    const galleryItem = compositionMap.get(panel.composition.galleryItemId);
    if (galleryItem !== undefined) {
      parts.push(normalizeSentence(galleryItem.compositionPrompt));
      parts.push(`Use a ${humanizeToken(galleryItem.shotType)} shot from a ${humanizeToken(galleryItem.angle)} angle.`);
    }
  }

  if (panel.composition.compositionPrompt !== null) {
    parts.push(normalizePromptField(panel.composition.compositionPrompt, 180));
  }

  if (panel.composition.shotType !== null) {
    parts.push(`Shot scale should read as ${humanizeToken(panel.composition.shotType)}.`);
  }

  if (panel.composition.angle !== null) {
    parts.push(`Camera angle should read as ${humanizeToken(panel.composition.angle)}.`);
  }

  if (panel.composition.customNote !== null) {
    parts.push(normalizePromptField(panel.composition.customNote, 140));
  }

  if (panel.backgroundNote !== null) {
    const background = sanitizePromptField(panel.backgroundNote, 100);
    if (background !== null) {
      parts.push(`Background: ${normalizeSentence(background, false)}.`);
    }
  }

  if (panel.panelNotes !== null && panel.composition.customNote === null) {
    const panelSpecificNote = sanitizePanelSpecificNote(
      panel.panelNotes,
      panel.situationText,
      panel.composition.compositionPrompt,
      panel.backgroundNote,
    );
    if (panelSpecificNote !== null) {
      parts.push(`Panel-specific note: ${normalizeSentence(panelSpecificNote, false)}`);
    }
  }

  if (panel.sfxText !== null) {
    parts.push(`Sound effect text in the artwork: "${panel.sfxText}".`);
  }

  return parts.length === 0 ? 'No additional composition note is provided.' : parts.join(' ');
}

function buildDialogueBeats(
  panel: Panel,
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
): string[] {
  return panel.dialogue.map((dialogue) =>
    formatDialogueLine(panel.order, dialogue, entityMap, referenceLabelByEntityId),
  );
}

function buildDialogueLock(
  panel: Panel,
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
): string | null {
  if (panel.dialogue.length === 0) {
    return null;
  }

  const lines = panel.dialogue.map((dialogue, index) => {
    const ordinal = index + 1;
    const authoredPosition = humanizeToken(dialogue.position);
    if (dialogue.entityId === null) {
      return `line ${ordinal} is narration text and must remain narration, not character speech: "${dialogue.text}" at its authored ${authoredPosition} position`;
    }

    const speaker = formatEntityReferenceIdentity(dialogue.entityId, entityMap, referenceLabelByEntityId);
    return `line ${ordinal} must stay assigned to ${speaker} exactly as written: "${dialogue.text}" at its authored ${authoredPosition} position. Do not assign this line to any other subject or reference image`;
  });

  return `Dialogue lock for panel ${panel.order}: ${lines.join('; ')}. Do not omit, paraphrase, merge, split, reassign, or move these lines from their authored positions.`;
}

function buildVisualLock(
  panel: Panel,
  entityMap: Map<string, Entity>,
  compositionMap: Map<string, CompositionGalleryItem>,
  referenceLabelByEntityId: Map<string, string>,
): string | null {
  const subjectNames = panel.entities
    .slice()
    .sort((left, right) => assignmentRoleWeight(left.role) - assignmentRoleWeight(right.role))
    .map((assignment) => formatEntityVisualLockSubject(assignment.entityId, entityMap, referenceLabelByEntityId))
    .filter((value, index, values) => values.indexOf(value) === index);
  const situationCue = normalizePanelSituation(panel.situationText);
  const backgroundCue = sanitizePromptField(panel.backgroundNote, 100) ?? '';
  const galleryItem =
    panel.composition.source === 'gallery' && panel.composition.galleryItemId !== null
      ? compositionMap.get(panel.composition.galleryItemId) ?? null
      : null;
  const shotType = panel.composition.shotType ?? galleryItem?.shotType ?? 'unspecified';
  const angle = panel.composition.angle ?? galleryItem?.angle ?? 'unspecified';

  return [
    `Visual lock for panel ${panel.order}:`,
    `subjects=${subjectNames.length === 0 ? '(none)' : subjectNames.join('|')};`,
    `situation cue="${situationCue}";`,
    `shot=${shotType};`,
    `angle=${angle};`,
    `background cue="${backgroundCue.length === 0 ? '(none)' : backgroundCue}".`,
  ].join(' ');
}

function assignmentRoleWeight(role: PanelEntityAssignment['role']): number {
  switch (role) {
    case 'primary':
      return 0;
    case 'secondary':
      return 1;
    case 'background':
      return 2;
    default:
      return 3;
  }
}

function shouldBakeDialogueForPanel(page: PagePromptContext, panel: Panel): boolean {
  if (!page.pageDialogueToggle || page.dialogueMode === 'balloon_only') {
    return false;
  }

  if (page.dialogueMode === 'mixed') {
    return panel.dialogueInPanel;
  }

  return true;
}

function buildLayoutInstruction(page: PagePromptContext, panelCount: number): string {
  const layoutType = readString(page.layoutConfig.type);
  if (layoutType === 'template') {
    const templateId = readString(page.layoutConfig.template_id);
    if (templateId !== null && isKnownTemplateId(templateId)) {
      const template = getPanelFrameTemplate(templateId);
      return [
        `Use the ${template.id} template with ${template.panelCount} panels. Preserve its panel proportions, reading rhythm, and clear gutters for this ${panelCount}-panel page.`,
        JAPANESE_MANGA_READING_ORDER_LOCK,
        formatFrameMap(template.frames),
        'Do not add, merge, omit, mirror, or reorder panels.',
      ].join(' ');
    }
  }

  if (layoutType === 'custom') {
    const frameDefinitions = toFrameDefinitions(page.layoutConfig.frame_definitions);
    const instructionLines = [
      'Follow the uploaded layout reference image exactly for panel borders, gutter spacing, and reading order.',
      JAPANESE_MANGA_READING_ORDER_LOCK,
    ];

    if (frameDefinitions.length > 0) {
      instructionLines.push(formatFrameMap(frameDefinitions));
    }

    instructionLines.push(`Do not add, merge, or omit panels. The finished page must retain exactly ${panelCount} panels.`);
    return instructionLines.join(' ');
  }

  if (layoutType === 'ai_generated' || layoutType === 'ai_auto') {
    const frameDefinitions = toFrameDefinitions(page.layoutConfig.frame_definitions);
    return [
      'Use the stored AI-generated panel arrangement for this page.',
      JAPANESE_MANGA_READING_ORDER_LOCK,
      frameDefinitions.length === 0
        ? JAPANESE_MANGA_UNMAPPED_LAYOUT_FALLBACK
        : formatFrameMap(frameDefinitions),
      `Do not add, merge, omit, mirror, or reorder panels. Keep exactly ${panelCount} panels.`,
    ].join(' ');
  }

  return `${JAPANESE_MANGA_READING_ORDER_LOCK} ${JAPANESE_MANGA_UNMAPPED_LAYOUT_FALLBACK} Do not add, merge, omit, mirror, or reorder panels. Keep exactly ${panelCount} panels with clear gutters and borders.`;
}

function buildQualityConstraints(
  page: PagePromptContext,
  panelCount: number,
  referenceRoles: NormalizedReferenceRole[],
): string[] {
  const constraints = [
    'Create a fresh page from the current saved page inputs only; do not preserve, restore, or edit any previous generated page image.',
    `Maintain exactly ${panelCount} readable panels in the locked Japanese manga order.`,
    'Preserve every stored dialogue position. When those positions allow, use Japanese eye flow with earlier text higher/right and later text left/down; never override an authored position to force placement.',
    'Keep panel borders and gutters clean and unambiguous.',
    'Preserve the authored action progression from one panel to the next without skipping intermediate beats.',
    'Do not let any foreground character drift off-model relative to their reference image.',
    'For every panel, the listed panel subjects are authoritative; do not replace them with a different referenced character and do not move a character into a panel where they are not listed.',
    'Panel subject lock lines are hard constraints: every listed required subject must be visible in that panel, and unlisted named or referenced characters must not appear there.',
    'Panel situation cues and background cues are mandatory visual content for their panels, not optional mood notes.',
  ];

  if (referenceRoles.length > 0) {
    constraints.push('Treat uploaded images only as character or layout references, never as a previous page image or an edit target.');
  }

  if (referenceRoles.some((role) => role.role === 'layout_reference')) {
    constraints.push('Respect the layout reference image as the border template for the whole page.');
  }

  if (page.pageDialogueToggle && page.dialogueMode !== 'balloon_only') {
    constraints.push('Keep required dialogue and SFX legible in the artwork without changing the authored wording.');
    constraints.push('Preserve each baked dialogue line exactly with its authored speaker or narration role. Do not swap speakers, paraphrase lines, or move narration into character speech.');
    constraints.push('Baked Japanese dialogue and narration must use vertical tategaki: glyphs top-to-bottom, columns right-to-left, never horizontal.');
    constraints.push('Keep text clear of required faces and actions. Do not change authored action, composition, or camera direction merely to fit text.');
  }

  return constraints;
}

function buildNegativeConstraints(page: PagePromptContext): string[] {
  const constraints = [
    'No extra panels.',
    'No missing panels.',
    'No extra characters beyond the authored cast for each panel.',
    'No photorealistic rendering.',
    'No western comic page styling.',
    'No watermark.',
  ];

  if (!page.pageDialogueToggle || page.dialogueMode === 'balloon_only') {
    constraints.push('Do not add baked-in dialogue text unless the panel instructions explicitly require it.');
  }

  return constraints;
}

function buildDraftPrompt(normalized: NormalizedPagePrompt): string {
  const parts = [
    normalized.pageSummary,
    normalized.styleLock,
    normalized.pageSetting,
    normalized.layoutInstruction,
    `Reference image roles: ${buildReferenceRoleParagraph(normalized.referenceRoles)}`,
    buildPanelInstructionParagraph(normalized.panelInstructions),
    buildQualityConstraintParagraph(normalized.qualityConstraints, normalized.negativeConstraints),
  ];

  return parts.filter((part) => part.length > 0).join('\n\n');
}

function buildCompilerBrief(normalized: NormalizedPagePrompt): string {
  const sections: Array<[string, string[]]> = [
    ['[TASK]', [normalized.pageSummary]],
    ['[GLOBAL STYLE]', [normalized.compilerStyleLock]],
    [
      '[REFERENCE IMAGE ROLES]',
      normalized.referenceRoles.length === 0
        ? ['No image reference is attached to this page. Rely on the authored panel instructions only.']
        : normalized.referenceRoles.map((role) => `${role.imageLabel}: ${role.instruction}`),
    ],
    ['[SETTING]', [normalized.pageSetting]],
    ['[LAYOUT]', [normalized.layoutInstruction]],
    [
      '[PANEL INSTRUCTIONS]',
      normalized.panelInstructions.flatMap((panel) => {
        const lines = [
          `Panel ${panel.order} (${panel.role}, ${panel.size})`,
          `- Situation: ${panel.situation}`,
          panel.subjectLock === null ? null : `- Subject lock: ${panel.subjectLock}`,
          `- Character beat: ${panel.characterBeat}`,
          `- Composition beat: ${panel.compositionBeat}`,
        ].filter((value): value is string => value !== null);

        if (panel.dialogueBeats.length > 0) {
          lines.push(...panel.dialogueBeats.map((dialogue) => `- Dialogue/SFX: ${dialogue}`));
        }

        if (panel.dialogueLock !== null) {
          lines.push(`- Dialogue lock: ${panel.dialogueLock}`);
        }

        if (panel.visualLock !== null) {
          lines.push(`- Visual lock: ${panel.visualLock}`);
        }

        return lines;
      }),
    ],
    ['[QUALITY CONSTRAINTS]', normalized.qualityConstraints],
    ['[NEGATIVE CONSTRAINTS]', normalized.negativeConstraints],
  ];

  return sections
    .map(([title, lines]) => `${title}\n${lines.join('\n')}`)
    .join('\n\n');
}

function buildReferenceRoleParagraph(referenceRoles: NormalizedReferenceRole[]): string {
  if (referenceRoles.length === 0) {
    return 'No reference images are attached.';
  }

  return referenceRoles.map((role) => `${role.imageLabel}: ${role.instruction}`).join(' ');
}

function buildPanelInstructionParagraph(panelInstructions: NormalizedPanelInstruction[]): string {
  return panelInstructions
    .map((panel) => {
      const parts = [
        `Panel ${panel.order}: This is a ${panel.role} ${panel.size} beat.`,
        `Panel ${panel.order} situation: ${panel.situation}`,
        panel.subjectLock,
        `Panel ${panel.order} character direction: ${panel.characterBeat}`,
        `Panel ${panel.order} composition and action: ${panel.compositionBeat}`,
        panel.dialogueBeats.length === 0 ? null : `Panel ${panel.order} dialogue and SFX: ${panel.dialogueBeats.join(' ')}`,
        panel.dialogueLock,
        panel.visualLock,
      ].filter((value): value is string => value !== null);

      return parts.join(' ');
    })
    .join('\n');
}

function buildQualityConstraintParagraph(
  qualityConstraints: string[],
  negativeConstraints: string[],
): string {
  return [
    `Quality constraints: ${qualityConstraints.join(' ')}`,
    `Negative constraints: ${negativeConstraints.join(' ')}`,
  ].join('\n');
}

function formatDialogueLine(
  panelOrder: number,
  dialogue: PanelDialogueLine,
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
): string {
  const speaker = dialogue.entityId === null
    ? null
    : formatEntityReferenceIdentity(dialogue.entityId, entityMap, referenceLabelByEntityId);
  const prefix =
    speaker === null
      ? `Panel ${panelOrder} dialogue`
      : `Panel ${panelOrder} dialogue by ${speaker}`;

  return `${prefix}: "${dialogue.text}" as ${humanizeToken(dialogue.type)} at ${humanizeToken(dialogue.position)}.`;
}

function formatPanelOrderList(panelOrders: number[]): string {
  const uniqueOrders = panelOrders
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left - right);

  if (uniqueOrders.length === 0) {
    return 'panels where explicitly listed';
  }

  if (uniqueOrders.length === 1) {
    return `panel ${uniqueOrders[0]}`;
  }

  return `panels ${uniqueOrders.join(', ')}`;
}

function normalizePanelSituation(value: string | null): string {
  return normalizePromptField(value ?? 'No explicit situation text.', 140);
}

function normalizePromptField(value: string, maxLength: number): string {
  return normalizeSentence(sanitizePromptField(value, maxLength) ?? value);
}

function sanitizePanelSpecificNote(
  note: string,
  situation: string | null,
  compositionPrompt: string | null,
  backgroundNote: string | null,
): string | null {
  const sanitized = sanitizePromptField(note, 120);
  if (sanitized === null) {
    return null;
  }

  const comparisons = [situation, compositionPrompt, backgroundNote]
    .map((value) => sanitizePromptField(value, 120))
    .filter((value): value is string => value !== null);
  if (comparisons.some((comparison) => promptFieldsLookEquivalent(sanitized, comparison))) {
    return null;
  }

  return sanitized;
}

function sanitizePromptField(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  if (normalized.length === 0) {
    return null;
  }

  const lowered = normalized.toLowerCase();
  if (
    lowered.includes('focus this page on') ||
    lowered.includes('maintain the scene mood') ||
    lowered.includes('should read naturally into the next page') ||
    lowered.includes('establish the location and tension clearly') ||
    lowered.includes('show the first concrete change or realization') ||
    lowered.includes('emphasize the emotional reaction or danger') ||
    lowered.includes('set up the transition into the next beat')
  ) {
    return null;
  }

  const firstSentence = normalized.split(/(?<=[。.!?])\s+/u)[0] ?? normalized;
  const trimmed = firstSentence.length > maxLength
    ? `${firstSentence.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`
    : firstSentence;
  return trimmed.trim();
}

function promptFieldsLookEquivalent(left: string, right: string): boolean {
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[.!?。！？、,／/・:;()[\]{}"'`]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft.length < 12 || normalizedRight.length < 12) {
    return normalizedLeft === normalizedRight;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function summarizeEntityAnchor(entity: Entity | undefined): string {
  const visualIdentity = summarizeEntityVisualIdentity(entity);
  const source = entity?.promptSupplement ?? entity?.freeDescription ?? '';
  const normalized = normalizeWhitespace(source);
  const parts: string[] = [];

  if (visualIdentity !== null) {
    parts.push(`${entity?.name ?? 'Character'} visual identity: ${visualIdentity}.`);
  }

  if (normalized.length > 0) {
    const trimmed = normalized.length > 160 ? `${normalized.slice(0, 157).trimEnd()}...` : normalized;
    parts.push(`Keep these anchor traits stable: ${trimmed}`);
  }

  return parts.join(' ');
}

function formatEntityReferenceIdentity(
  entityId: string,
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
): string {
  const entity = entityMap.get(entityId);
  const entityName = entity?.name ?? `Unknown entity ${entityId}`;
  const referenceLabel = referenceLabelByEntityId.get(entityId);
  const visualIdentity = summarizeEntityVisualIdentity(entity);
  return [
    entityName,
    referenceLabel === undefined ? null : `reference ${referenceLabel}`,
    visualIdentity === null ? null : `visual identity ${visualIdentity}`,
  ]
    .filter((value): value is string => value !== null)
    .join(', ');
}

function formatEntityVisualLockSubject(
  entityId: string,
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
): string {
  const entity = entityMap.get(entityId);
  const entityName = entity?.name ?? entityId;
  const referenceLabel = referenceLabelByEntityId.get(entityId);
  const visualIdentity = summarizeEntityVisualIdentity(entity);
  const details = [
    referenceLabel,
    visualIdentity,
  ].filter((value): value is string => value !== undefined && value !== null);
  return details.length === 0 ? entityName : `${entityName} [${details.join(', ')}]`;
}

function summarizeEntityVisualIdentity(entity: Entity | undefined): string | null {
  if (entity === undefined) {
    return null;
  }

  const fields = entity.structuredFields;
  const parts = [
    readFieldString(fields, 'gender_expression'),
    summarizeHair(fields),
    summarizeEyes(fields),
    summarizeClothing(fields),
    summarizeBody(fields),
    summarizeExpression(fields),
  ].filter((value): value is string => value !== null);

  if (parts.length === 0) {
    return null;
  }

  const summary = parts.join(', ');
  return summary.length > 320 ? `${summary.slice(0, 317).trimEnd()}...` : summary;
}

function summarizeHair(fields: Record<string, unknown>): string | null {
  const hair = readRecord(fields.hair);
  const hairDetail = readRecord(fields.hair_detail);
  const values = [
    readFieldString(hair, 'color'),
    readFieldString(hair, 'length'),
    readFieldString(hair, 'style'),
  ].filter((value): value is string => value !== null);
  const detailValues = [
    readFieldString(hair, 'bangs') === null ? null : `${readFieldString(hair, 'bangs')} bangs`,
    readFieldString(hair, 'arrangement'),
    readFieldString(hairDetail, 'front_shape'),
    readFieldString(hairDetail, 'back_shape'),
    readFieldString(hairDetail, 'side_hair'),
  ].filter((value): value is string => value !== null);
  const base = values.length === 0 ? null : `${values.join(' ')} hair`;
  const allValues = [base, ...detailValues].filter((value): value is string => value !== null);
  return allValues.length === 0 ? null : allValues.join(', ');
}

function summarizeEyes(fields: Record<string, unknown>): string | null {
  const eyes = readRecord(fields.eyes);
  const values = [
    readFieldString(eyes, 'color'),
    readFieldString(eyes, 'shape'),
  ].filter((value): value is string => value !== null);
  return values.length === 0 ? null : `${values.join(' ')} eyes`;
}

function summarizeClothing(fields: Record<string, unknown>): string | null {
  const clothing = readRecord(fields.clothing);
  const outfit = readRecord(fields.outfit_detail);
  const values = [
    readFieldString(clothing, 'main_color'),
    readFieldString(clothing, 'category'),
  ].filter((value): value is string => value !== null);
  const detailValues = [
    readFieldString(clothing, 'description'),
    readFieldString(outfit, 'collar_shape'),
    readFieldString(outfit, 'sleeve_length'),
    readFieldString(outfit, 'skirt_or_pants_shape'),
    readFieldString(outfit, 'shoes'),
  ].filter((value): value is string => value !== null);
  const base = values.length === 0 ? null : `${values.join(' ')} outfit`;
  const allValues = [base, ...detailValues].filter((value): value is string => value !== null);
  return allValues.length === 0 ? null : allValues.join(', ');
}

function summarizeBody(fields: Record<string, unknown>): string | null {
  const values = [
    readFieldString(fields, 'build') === null ? null : `${readFieldString(fields, 'build')} build`,
    readFieldString(fields, 'height') === null ? null : `${readFieldString(fields, 'height')} height`,
    readFieldString(fields, 'age_range') === null ? null : `${readFieldString(fields, 'age_range')} age`,
  ].filter((value): value is string => value !== null);
  return values.length === 0 ? null : values.join(', ');
}

function summarizeExpression(fields: Record<string, unknown>): string | null {
  const expression = readFieldString(fields, 'default_expression');
  const impression = readFieldString(fields, 'first_impression');
  const values = [
    expression === null ? null : `${expression} expression`,
    impression,
  ].filter((value): value is string => value !== null);
  return values.length === 0 ? null : values.join(', ');
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readFieldString(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeWhitespace(humanizeToken(value)).replace(/[;|]/gu, ',');
  return normalized.length === 0 ? null : normalized;
}

function collectOrderedEntityIds(panels: Panel[]): string[] {
  const orderedEntityIds = new Set<string>();
  for (const panel of panels) {
    for (const assignment of panel.entities) {
      orderedEntityIds.add(assignment.entityId);
    }
  }

  return Array.from(orderedEntityIds);
}

function normalizeSentence(value: string, includeTrailingPeriod = true): string {
  const trimmed = normalizeWhitespace(value).replace(/[.。]+$/u, '');
  if (trimmed.length === 0) {
    return '';
  }

  return includeTrailingPeriod ? `${trimmed}.` : trimmed;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function humanizeToken(value: string): string {
  return value.replace(/_/gu, ' ');
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isKnownTemplateId(value: string): value is Parameters<typeof getPanelFrameTemplate>[0] {
  return value in PANEL_FRAME_TEMPLATES;
}

interface LayoutFrameVertex {
  x: number;
  y: number;
}

interface LayoutFrameDefinition {
  readingOrder: number;
  vertices: LayoutFrameVertex[];
}

const JAPANESE_MANGA_READING_ORDER_LOCK =
  'Japanese manga physical reading order is mandatory: panel 1 is the upper-right or rightmost top entry; follow numbered panels generally right-to-left and downward toward the lower-left, never western left-to-right.';
const JAPANESE_MANGA_UNMAPPED_LAYOUT_FALLBACK =
  'Without a frame map, use right-to-left within each regular tier, then top-to-bottom.';

function formatFrameMap(frameDefinitions: readonly LayoutFrameDefinition[]): string {
  return `Authoritative frame map (follow P numbers and coordinates exactly for asymmetric or custom layouts): ${[...frameDefinitions]
    .sort((left, right) => left.readingOrder - right.readingOrder)
    .map(
      (frame) =>
        `P${frame.readingOrder}=[${frame.vertices
          .map((vertex) => `(${vertex.x.toFixed(2)},${vertex.y.toFixed(2)})`)
          .join(',')}]`,
    )
    .join('; ')}.`;
}

function toFrameDefinitions(value: unknown): LayoutFrameDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.reading_order !== 'number' || !Array.isArray(entry.vertices)) {
      return [];
    }

    const vertices = entry.vertices.flatMap((vertex) => {
      if (!isRecord(vertex) || typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
        return [];
      }

      return [{ x: vertex.x, y: vertex.y }];
    });

    if (vertices.length === 0) {
      return [];
    }

    return [{ readingOrder: entry.reading_order, vertices }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const STYLE_LOCK_TEXT =
  'Style lock: anime manga illustration, clean black line art, flat colors with manga-style shading, crisp panel borders with visible gutters, right-to-left reading flow, no photorealism, no western comic styling.';
const STYLE_PROMPT_TEXT_LIMITS = {
  compiledBrief: 820,
  anchorLine: 180,
  notes: 300,
} as const;
const COMPILER_STYLE_PROMPT_TEXT_LIMITS = {
  compiledBrief: 450,
  anchorLine: 80,
  notes: 100,
} as const;

function buildStyleLock(
  page: PagePromptContext,
  limits: {
    compiledBrief: number;
    anchorLine: number;
    notes: number;
  },
): string {
  if (page.styleReference === null) {
    return STYLE_LOCK_TEXT;
  }

  const anchorLines = buildRenderingStyleAnchorLines(page.styleReference.anchors).map((line) =>
    compactStylePromptText(line, limits.anchorLine),
  );
  const anchorConstraint =
    anchorLines.length === 0
      ? null
      : `Apply these style anchors to line treatment, shading, finish, background treatment, motion accents, and page atmosphere: ${anchorLines.join('; ')}.`;
  const notes =
    page.styleReference.notes === null || page.styleReference.notes.trim().length === 0
      ? null
      : `User notes: ${ensureTerminalPunctuation(
          compactStylePromptText(page.styleReference.notes, limits.notes),
        )}`;

  return [
    STYLE_LOCK_TEXT,
    `Named style reference constraint: "${page.styleReference.title}". Treat it as a hard page-wide rendering constraint.`,
    `Generalized style interpretation: ${compactStylePromptText(
      page.styleReference.compiledBrief,
      limits.compiledBrief,
    )}`,
    'Keep each character face, eye shape, hair silhouette, body proportions, and outfit silhouette anchored to the character reference images. Apply the style reference to rendering treatment, not to character identity.',
    anchorConstraint,
    notes,
  ]
    .filter((value): value is string => value !== null)
    .join(' ');
}

function compactStylePromptText(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function ensureTerminalPunctuation(value: string): string {
  return /[.!?。！？…]$/u.test(value) ? value : `${value}.`;
}
