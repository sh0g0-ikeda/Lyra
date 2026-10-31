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
import type { EntityReferenceAssignment, EntityRepository, EntityResolvedReferenceImage } from '../../repositories/EntityRepository.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { PanelRepository } from '../../repositories/PanelRepository.js';
import { PAGE_VISUAL_INTEGRITY_POLICY } from './PageVisualPolicy.js';

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
  stateId: string | null;
  imageLabel: string;
  role: 'character_reference' | 'nonhuman_reference' | 'object_reference' | 'layout_reference';
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
  subjectDefinitions: string[];
  layoutInstruction: string;
  panelInstructions: NormalizedPanelInstruction[];
  qualityConstraints: string[];
  negativeConstraints: string[];
  styleLock: string;
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
    const references = await resolveReferences(
      this.entityRepository, collectOrderedAssignments(panels), page.workId, input.userId, organizationId,
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
      references,
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

// Define designs once globally; panel locks carry identities and interactions, not
// repeated biographies. Object placement follows authored use/contact rather than
// legacy person-position fields. Never infer a holder from a name or text pattern.
function normalizePagePrompt(
  page: PagePromptContext,
  panels: Panel[],
  entityMap: Map<string, Entity>,
  compositionMap: Map<string, CompositionGalleryItem>,
  references: EntityResolvedReferenceImage[],
  input: BuildPagePromptInput,
): NormalizedPagePrompt {
  const orderedPanels = [...panels].sort((left, right) => left.order - right.order);
  assertContiguousPanelOrder(orderedPanels);
  const referenceRoles = buildReferenceRoles(page, orderedPanels, entityMap, references);
  const referenceLabelByEntityId = buildReferenceLabelMap(referenceRoles);

  return {
    pageSummary: buildPageSummary(page, input, orderedPanels.length),
    pageSetting: buildPageSetting(page),
    referenceRoles,
    subjectDefinitions: Array.from(new Set(orderedPanels.flatMap((panel) => panel.entities.map((assignment) => assignment.entityId))))
      .map((id) => entityMap.get(id))
      .filter((entity): entity is Entity => entity !== undefined)
      .map((entity) => `${entity.name} (${entity.entityType}): ${summarizeEntityAnchor(entity)}`),
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
    styleLock: buildStyleLock(page),
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
  return `Create page ${page.pageNumber} of the episode, covering ${purpose}. This is a fresh ${input.generationMode} generation request based only on the current saved page inputs. Render one complete ${panelCount}-panel manga page in authored order. Do not treat this as an edit, continuation, or restoration of any previously generated page image.`;
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
  references: EntityResolvedReferenceImage[],
): NormalizedReferenceRole[] {
  const orderedAssignments = new Map<string, PanelEntityAssignment>();
  const panelOrdersByAssignment = new Map<string, number[]>();
  for (const panel of panels) {
    for (const assignment of panel.entities) {
      const key = referenceKey(assignment.entityId, assignment.stateId);
      if (!orderedAssignments.has(key)) {
        orderedAssignments.set(key, assignment);
      }

      const panelOrders = panelOrdersByAssignment.get(key) ?? [];
      if (!panelOrders.includes(panel.order)) {
        panelOrders.push(panel.order);
      }
      panelOrdersByAssignment.set(key, panelOrders);
    }
  }

  const referenceByAssignment = new Map(references.filter(hasResolvedImage).map((reference) => [referenceKey(reference.entityId, reference.stateId), reference]));
  const roles: NormalizedReferenceRole[] = [];
  for (const [key, assignment] of orderedAssignments) {
      const reference = referenceByAssignment.get(key);
      if (reference === undefined) {
        continue;
      }
      const entity = entityMap.get(assignment.entityId);
      const canonicalName = entity?.name ?? `Unknown entity ${assignment.entityId}`;
      const entityName = buildSubjectLabel(
        canonicalName,
        reference.stateName,
        Array.from(orderedAssignments.values()).some((candidate) => candidate.entityId === assignment.entityId && candidate.stateId !== null),
      );
      const panelScope = formatPanelOrderList(panelOrdersByAssignment.get(key) ?? []);
      const entityType = entity?.entityType ?? 'character';
      const role = entityType === 'object' ? 'object_reference' : entityType === 'nonhuman' ? 'nonhuman_reference' : 'character_reference';
      const preservation = entityType === 'object'
        ? 'Preserve its silhouette, component proportions, connections, and distinctive design from this image while changing view and perspective for the authored use. Do not copy the reference display pose or background.'
        : entityType === 'nonhuman'
          ? 'Preserve its species-specific anatomy, silhouette, markings, and authored size; do not replace them with human anatomy.'
          : `Keep ${entityName}'s face, hair shape, clothing silhouette, and color blocking stable when ${entityName} appears.`;
      roles.push({
        entityId: assignment.entityId,
        stateId: assignment.stateId,
        imageLabel: `Image ${roles.length + 1} (${entityName})`,
        role,
        subject: entityName,
        instruction: `${entityName} ${entityType} reference. Use this image only for ${entityName}; never use it as another ${entityType === 'character' ? 'character' : 'subject'}. ${entityName} is allowed only in ${panelScope} where listed in the subject lock. ${preservation}${reference.stateId === null ? '' : ' This selected state reference controls state-specific changes to the base design.'}`,
      });
  }

  if (page.layoutConfig.type === 'custom') {
    roles.push({
      entityId: null,
      stateId: null,
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
      role.role !== 'layout_reference' && role.entityId !== null
        ? [[referenceKey(role.entityId, role.stateId), role.imageLabel] as const]
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
    situation: normalizeAuthoredField(panel.situationText ?? 'No explicit situation text.', 2000),
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
    const referenceLabel = findReferenceLabel(referenceLabelByEntityId, assignment.entityId, assignment.stateId);
    const isObject = entity?.entityType === 'object';
    const position = isObject ? null : `${humanizeToken(assignment.position)} zone`;
    const facing = isObject || assignment.facingDirection === null
      ? null
      : `facing ${humanizeToken(assignment.facingDirection)}`;
    return [
      entityName,
      referenceLabel === undefined ? null : `reference ${referenceLabel}`,
      `role ${assignment.role}`,
      isObject ? 'object; placement follows authored interaction' : null,
      position,
      facing,
    ]
      .filter((value): value is string => value !== null)
      .join(', ');
  });

  return `Panel ${panel.order} subject lock: required visible subjects are ${details.join('; ')}.`;
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
      const referenceLabel = findReferenceLabel(referenceLabelByEntityId, assignment.entityId, assignment.stateId);
      const expression = assignment.expression === 'custom' ? assignment.customExpression : assignment.expression;
      const action = assignment.action === 'custom' ? assignment.customAction : assignment.action;
      if (entity?.entityType === 'object') {
        return [
          `${entityName}${referenceLabel === undefined ? '' : `, reference ${referenceLabel}`}: object`,
          assignment.action === 'custom' && assignment.customAction !== null ? `authored interaction/use: ${normalizeSentence(assignment.customAction, false)}` : null,
          assignment.expression === 'custom' && assignment.customExpression !== null ? `appearance/effect: ${normalizeSentence(assignment.customExpression, false)}` : null,
          assignment.effectNote === null ? null : `visual detail: ${normalizeSentence(assignment.effectNote, false)}`,
        ].filter((part): part is string => part !== null).join('; ') + '.';
      }
      const parts = [
        [
          entityName,
          referenceLabel === undefined ? null : `reference ${referenceLabel}`,
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
    parts.push(normalizeAuthoredField(panel.composition.compositionPrompt, 1000));
  }

  if (panel.composition.shotType !== null) {
    parts.push(`Shot scale should read as ${humanizeToken(panel.composition.shotType)}.`);
  }

  if (panel.composition.angle !== null) {
    parts.push(`Camera angle should read as ${humanizeToken(panel.composition.angle)}.`);
  }

  if (panel.composition.customNote !== null) {
    parts.push(normalizeAuthoredField(panel.composition.customNote, 1000));
  }

  if (panel.backgroundNote !== null) {
    if (panel.backgroundNote.trim().length > 0) {
      parts.push(`Background: ${normalizeAuthoredField(panel.backgroundNote, 2000)}`);
    }
  }

  if (panel.panelNotes !== null) {
    const panelSpecificNote = sanitizePanelSpecificNote(
      panel.panelNotes,
      panel.situationText,
      panel.composition.compositionPrompt,
      panel.backgroundNote,
      panel.composition.customNote,
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
    formatDialogueLine(panel.order, dialogue, entityMap, referenceLabelByEntityId, findSpeakerStateId(panel, dialogue.entityId)),
  );
}

function findSpeakerStateId(panel: Panel, entityId: string | null): string | null {
  return dedupeAssignmentsByEntity(panel.entities).find((assignment) => assignment.entityId === entityId)?.stateId ?? null;
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
    if (dialogue.entityId === null) {
      return `line ${ordinal} is narration text and must remain narration, not character speech: "${dialogue.text}"`;
    }

    const speaker = formatEntityReferenceIdentity(dialogue.entityId, entityMap, referenceLabelByEntityId, findSpeakerStateId(panel, dialogue.entityId));
    return `line ${ordinal} must stay assigned to ${speaker} exactly as written: "${dialogue.text}". Do not assign this line to any other subject or reference image`;
  });

  return `Dialogue lock for panel ${panel.order}: ${lines.join('; ')}. Do not omit, paraphrase, merge, split, or reassign these lines.`;
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
    .map((assignment) => formatEntityVisualLockSubject(assignment.entityId, assignment.stateId, entityMap, referenceLabelByEntityId))
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
      return `Use the ${template.id} template with ${template.panelCount} panels. Preserve its panel proportions, reading rhythm, and clear gutters for this ${panelCount}-panel page. Do not add, merge, or omit panels.`;
    }
  }

  if (layoutType === 'custom') {
    const frameDefinitions = toFrameDefinitions(page.layoutConfig.frame_definitions);
    const instructionLines = [
      'Follow the uploaded layout reference image exactly for panel borders, gutter spacing, and reading order.',
    ];

    if (frameDefinitions.length > 0) {
      instructionLines.push(
        `Frame map: ${frameDefinitions
          .map(
            (frame) =>
              `panel ${frame.readingOrder} uses vertices ${frame.vertices
                .map((vertex) => `(${vertex.x.toFixed(2)}, ${vertex.y.toFixed(2)})`)
                .join(' -> ')}`,
          )
          .join('; ')}.`,
      );
    }

    instructionLines.push(`Do not add, merge, or omit panels. The finished page must retain exactly ${panelCount} panels.`);
    return instructionLines.join(' ');
  }

  if (layoutType === 'ai_generated' || layoutType === 'ai_auto') {
    return `Use the stored AI-generated panel arrangement for this page and preserve the intended manga reading order. Do not add, merge, or omit panels. Keep exactly ${panelCount} panels.`;
  }

  return `Preserve the intended manga page reading flow and clear panel separation. Do not add, merge, or omit panels. Keep exactly ${panelCount} panels with clear gutters and borders.`;
}

function buildQualityConstraints(
  page: PagePromptContext,
  panelCount: number,
  referenceRoles: NormalizedReferenceRole[],
): string[] {
  const constraints = [
    `Maintain exactly ${panelCount} readable panels in right-to-left manga reading order.`,
    'Follow authored action, composition, and background cues. Each panel subject lock is authoritative: every listed subject must be visible and recognizable, and unlisted named subjects must not appear.',
    'Do not substitute, merge, swap, or replace these subjects with any other character or reference image.',
    PAGE_VISUAL_INTEGRITY_POLICY,
  ];

  if (referenceRoles.length > 0) {
    constraints.push('Treat uploaded images only as the declared character, nonhuman, object, or layout references, never as a previous page image or an edit target.');
  }

  if (referenceRoles.some((role) => role.role === 'layout_reference')) {
    constraints.push('Respect the layout reference image as the border template for the whole page.');
  }

  if (page.pageDialogueToggle && page.dialogueMode !== 'balloon_only') {
    constraints.push('Render required dialogue and SFX legibly and exactly with the locked speaker or narration role.');
  }

  return constraints;
}

function buildNegativeConstraints(page: PagePromptContext): string[] {
  const constraints = [
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
    `Subject definitions (apply throughout the page): ${normalized.subjectDefinitions.join(' ')}`,
    `Reference image roles: ${buildReferenceRoleParagraph(normalized.referenceRoles)}`,
    buildPanelInstructionParagraph(normalized.panelInstructions),
    buildQualityConstraintParagraph(normalized.qualityConstraints, normalized.negativeConstraints),
  ];

  return parts.filter((part) => part.length > 0).join('\n\n');
}

function buildCompilerBrief(normalized: NormalizedPagePrompt): string {
  const sections: Array<[string, string[]]> = [
    ['[TASK]', [normalized.pageSummary]],
    ['[GLOBAL STYLE]', [normalized.styleLock]],
    ['[SUBJECT DEFINITIONS]', normalized.subjectDefinitions],
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
          `- Subject beat: ${panel.characterBeat}`,
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
        `Panel ${panel.order} subject direction: ${panel.characterBeat}`,
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
  stateId: string | null,
): string {
  const speaker = dialogue.entityId === null
    ? null
    : formatEntityReferenceIdentity(dialogue.entityId, entityMap, referenceLabelByEntityId, stateId);
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

// Keep complete authored relationship/scale sentences within the persisted field
// limits. First-sentence summaries are only appropriate for diagnostic lock cues.
function normalizeAuthoredField(value: string, maxLength: number): string {
  return normalizeSentence(normalizeWhitespace(value).slice(0, maxLength));
}

function normalizePromptField(value: string, maxLength: number): string {
  return normalizeSentence(sanitizePromptField(value, maxLength) ?? value);
}

function sanitizePanelSpecificNote(
  note: string,
  situation: string | null,
  compositionPrompt: string | null,
  backgroundNote: string | null,
  customNote: string | null,
): string | null {
  // Only discard a note when its entire content is already present elsewhere.
  // Boilerplate-like wording may still contain authored grip/scale information.
  const sanitized = normalizeWhitespace(note).slice(0, 2000);
  if (sanitized.length === 0) {
    return null;
  }

  const comparisons = [situation, compositionPrompt, backgroundNote, customNote]
    .map((value) => value === null ? null : normalizeWhitespace(value))
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
  const normalizedLeft = normalizeWhitespace(left);
  const normalizedRight = normalizeWhitespace(right);
  if (normalizedLeft.length < 12 || normalizedRight.length < 12) {
    return normalizedLeft === normalizedRight;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedRight.includes(normalizedLeft)
  );
}

function summarizeEntityAnchor(entity: Entity | undefined): string {
  const visualIdentity = summarizeEntityVisualIdentity(entity);
  const sources = entity?.entityType === 'character'
    ? [entity.promptSupplement ?? entity.freeDescription ?? '']
    : [entity?.freeDescription ?? '', entity?.promptSupplement ?? ''];
  const normalized = Array.from(new Set(sources.map(normalizeWhitespace).filter((value) => value.length > 0))).join(' ');
  const parts: string[] = [];

  if (visualIdentity !== null) {
    parts.push(`${entity?.name ?? 'Character'} visual identity: ${visualIdentity}.`);
  }

  if (normalized.length > 0) {
    const limit = entity?.entityType === 'character' ? 160 : 4000;
    const trimmed = normalized.length > limit ? `${normalized.slice(0, limit - 3).trimEnd()}...` : normalized;
    parts.push(`Keep these anchor traits stable: ${trimmed}`);
  }

  return parts.join(' ');
}

function formatEntityReferenceIdentity(
  entityId: string,
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
  stateId: string | null,
): string {
  const entity = entityMap.get(entityId);
  const entityName = entity?.name ?? `Unknown entity ${entityId}`;
  const referenceLabel = findReferenceLabel(referenceLabelByEntityId, entityId, stateId);
  return [
    entityName,
    referenceLabel === undefined ? null : `reference ${referenceLabel}`,
  ]
    .filter((value): value is string => value !== null)
    .join(', ');
}

function formatEntityVisualLockSubject(
  entityId: string,
  stateId: string | null,
  entityMap: Map<string, Entity>,
  referenceLabelByEntityId: Map<string, string>,
): string {
  const entity = entityMap.get(entityId);
  const entityName = entity?.name ?? entityId;
  const referenceLabel = findReferenceLabel(referenceLabelByEntityId, entityId, stateId);
  const details = [
    referenceLabel,
  ].filter((value): value is string => value !== undefined && value !== null);
  return details.length === 0 ? entityName : `${entityName} [${details.join(', ')}]`;
}

function summarizeEntityVisualIdentity(entity: Entity | undefined): string | null {
  if (entity === undefined) {
    return null;
  }

  const fields = entity.structuredFields;
  if (entity.entityType !== 'character') {
    const keys = entity.entityType === 'object'
      ? ['category', 'material', 'size', 'distinctive_features']
      : ['base_form', 'size', 'movement', 'distinctive_features'];
    const details = keys.flatMap((key) => {
      const value = readFieldString(fields, key);
      return value === null ? [] : [`${key.replace(/_/gu, ' ')}: ${value}`];
    });
    return details.length === 0 ? null : details.join(', ');
  }
  const parts = [
    readFieldString(fields, 'gender_expression'),
    summarizeHair(fields),
    summarizeEyes(fields),
    summarizeClothing(fields),
    summarizeExpression(fields),
  ].filter((value): value is string => value !== null);

  const body = summarizeBody(fields);
  if (parts.length === 0 && body === null) {
    return null;
  }

  const summary = parts.join(', ');
  const appearance = summary.length > 320 ? `${summary.slice(0, 317).trimEnd()}...` : summary;
  // Scale is independent of the compact appearance summary: long hair/outfit
  // descriptions must never hide the authored height or body proportions.
  return [body, appearance].filter((value) => value !== null && value.length > 0).join(', ');
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
  const proportions = readRecord(fields.proportions);
  const values = [
    readFieldString(fields, 'build') === null ? null : `${readFieldString(fields, 'build')} build`,
    readFieldString(fields, 'height') === null ? null : `${readFieldString(fields, 'height')} height`,
    readFieldString(fields, 'age_range') === null ? null : `${readFieldString(fields, 'age_range')} age`,
    ...['head_to_body_ratio', 'shoulder_width', 'leg_length', 'posture_axis'].flatMap((key) => {
      const value = readFieldString(proportions, key);
      return value === null ? [] : [`${key.replace(/_/gu, ' ')}: ${value}`];
    }),
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

function collectOrderedAssignments(panels: Panel[]): EntityReferenceAssignment[] {
  const assignments = new Map<string, EntityReferenceAssignment>();
  for (const panel of panels) {
    for (const assignment of panel.entities) {
      assignments.set(referenceKey(assignment.entityId, assignment.stateId), {
        entityId: assignment.entityId,
        stateId: assignment.stateId,
      });
    }
  }

  return Array.from(assignments.values());
}

async function resolveReferences(
  repository: EntityRepository,
  assignments: EntityReferenceAssignment[],
  workId: string,
  userId: string,
  organizationId: string | null,
): Promise<EntityResolvedReferenceImage[]> {
  if (repository.findResolvedReferenceImagesByAssignmentsAndUserId !== undefined) {
    return repository.findResolvedReferenceImagesByAssignmentsAndUserId(assignments, workId, userId, organizationId);
  }
  const references = await repository.findPrimaryReferenceImagesByEntityIdsAndUserId(
    Array.from(new Set(assignments.map((assignment) => assignment.entityId))), workId, userId, organizationId,
  );
  return assignments.map((assignment) => {
    const reference = references.find((candidate) => candidate.entityId === assignment.entityId);
    return {
      entityId: assignment.entityId, stateId: assignment.stateId, stateName: null, stateDescription: null,
      stateExists: assignment.stateId === null, ownerUserId: reference?.ownerUserId ?? userId,
      refId: reference?.refId ?? null, s3Key: reference?.s3Key ?? null, cdnUrl: reference?.cdnUrl ?? null, imageModel: null,
    };
  });
}

function hasResolvedImage(reference: EntityResolvedReferenceImage): reference is EntityResolvedReferenceImage & { refId: string; s3Key: string } {
  return reference.refId !== null && reference.s3Key !== null;
}

function referenceKey(entityId: string, stateId: string | null): string {
  return `${entityId}:${stateId ?? 'default'}`;
}

function findReferenceLabel(labels: Map<string, string>, entityId: string, stateId: string | null): string | undefined {
  return labels.get(referenceKey(entityId, stateId));
}

function buildSubjectLabel(canonicalName: string, stateName: string | null, includeDefault: boolean): string {
  if (stateName === null && !includeDefault) {
    return canonicalName;
  }
  return `${canonicalName} / ${stateName ?? 'default'}`;
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

function buildStyleLock(page: PagePromptContext): string {
  if (page.styleReference === null) {
    return STYLE_LOCK_TEXT;
  }

  const anchorLines = buildRenderingStyleAnchorLines(page.styleReference.anchors).map((line) =>
    compactStylePromptText(line, STYLE_PROMPT_TEXT_LIMITS.anchorLine),
  );
  const anchorConstraint =
    anchorLines.length === 0
      ? null
      : `Apply these style anchors to line treatment, shading, finish, background treatment, motion accents, and page atmosphere: ${anchorLines.join('; ')}.`;
  const notes =
    page.styleReference.notes === null || page.styleReference.notes.trim().length === 0
      ? null
      : `User notes: ${ensureTerminalPunctuation(
          compactStylePromptText(page.styleReference.notes, STYLE_PROMPT_TEXT_LIMITS.notes),
        )}`;

  return [
    STYLE_LOCK_TEXT,
    `Named style reference constraint: "${page.styleReference.title}".`,
    `Generalized style interpretation: ${compactStylePromptText(
      page.styleReference.compiledBrief,
      STYLE_PROMPT_TEXT_LIMITS.compiledBrief,
    )}`,
    'Style changes rendering, never subject identity or geometry.',
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
