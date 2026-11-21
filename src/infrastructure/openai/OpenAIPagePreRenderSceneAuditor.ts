import { z } from 'zod';
import {
  PAGE_SCENE_AUDIT_MAX_TOKENS,
  PAGE_SCENE_AUDIT_MODEL,
  PAGE_SCENE_AUDIT_VERSION,
  PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS,
  PAGE_IMAGE_PROMPT_MAX_CHARACTERS,
  PAGE_SCENE_AUDIT_MAX_BRIEF_CHARACTERS,
  PAGE_SCENE_AUDIT_MAX_DIRECTIVES,
  PAGE_SCENE_AUDIT_MAX_INPUT_IMAGES,
} from '../../domain/constants/generation.js';
import { PAGE_VISUAL_INTEGRITY_POLICY } from '../../services/page/PageVisualPolicy.js';
import { ConfigurationError, ValidationError } from '../../domain/errors/index.js';
import {
  validatePagePreRenderSceneAudit,
  type PagePreRenderSceneAuditDirective,
  type PagePreRenderSceneAuditInput,
  type PagePreRenderSceneAuditResult,
  type PagePreRenderSceneAuditorPort,
} from '../../services/page/PagePreRenderSceneAudit.js';
import { OpenAIClient } from './OpenAIClient.js';
import { requestStructuredOpenAIResponse } from './StructuredOpenAIResponse.js';

const wireSchema = z.object({
  assessment: z.enum(['clear', 'uncertain']),
  directive_ids: z.array(z.string().min(1).max(16)).max(PAGE_SCENE_AUDIT_MAX_DIRECTIVES),
}).strict();

const SOLO_DIRECTIVE_KINDS = ['appearance', 'anatomy_motion', 'object_integrity', 'scale'] as const;

interface DirectiveCandidate {
  id: string;
  directive: PagePreRenderSceneAuditDirective;
  entityNames: string[];
}

export class OpenAIPagePreRenderSceneAuditor implements PagePreRenderSceneAuditorPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model: string = PAGE_SCENE_AUDIT_MODEL,
    private readonly maxTokens: number = PAGE_SCENE_AUDIT_MAX_TOKENS,
  ) {}

  public async audit(input: PagePreRenderSceneAuditInput): Promise<PagePreRenderSceneAuditResult> {
    validateInput(input);
    const candidates = buildDirectiveCandidates(input);
    const response = await requestStructuredOpenAIResponse({
      client: this.client,
      model: this.model,
      maxOutputTokens: this.maxTokens,
      schemaName: PAGE_SCENE_AUDIT_VERSION,
      jsonSchema: buildJsonSchema(candidates),
      responseSchema: wireSchema,
      errorLabel: 'OpenAI page pre-render scene auditor',
      reasoningEffort: 'low',
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemInstructions() }] },
        { role: 'user', content: buildUserContent(input, candidates) },
      ],
    });
    return resolveDirectiveSelection(input, candidates, response);
  }
}

function validateInput(input: PagePreRenderSceneAuditInput): void {
  if (
    countCodePoints(input.prompt) > PAGE_IMAGE_PROMPT_MAX_CHARACTERS
    || countCodePoints(input.compilerBrief) > PAGE_SCENE_AUDIT_MAX_BRIEF_CHARACTERS
    || (input.internalPlan !== null && countCodePoints(input.internalPlan) > PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS)
  ) {
    throw new ConfigurationError('Page pre-render scene audit input exceeds its limit');
  }
  if (input.inputImages.length > PAGE_SCENE_AUDIT_MAX_INPUT_IMAGES) throw new ConfigurationError('Page pre-render scene audit has too many input images');
  for (const image of input.inputImages) {
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(image.dataUrl)) {
      throw new ConfigurationError('Page pre-render scene audit received an unsupported input image');
    }
  }
}

function buildUserContent(
  input: PagePreRenderSceneAuditInput,
  candidates: DirectiveCandidate[],
): Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> {
  const text = [
    `Audit version: ${PAGE_SCENE_AUDIT_VERSION}.`,
    `Original prompt:\n${input.prompt}`,
    `Compiler brief:\n${input.compilerBrief}`,
    `Panels: ${JSON.stringify(input.inputSnapshot.panels.map((panel) => ({
      order: panel.order,
      entityIds: panel.entityIds,
      entityNames: panel.entityNames,
    })))}.`,
    `Supplied input image map: ${JSON.stringify(input.inputImages.map((image, index) => ({
      modelInputOrder: index + 1,
      role: image.role,
      label: image.label,
      entityId: image.reference?.entityId ?? null,
      stateId: image.reference?.stateId ?? null,
    })))}.`,
    `Supplied layout control: ${JSON.stringify(input.layoutControl ?? null)}.`,
    `Internal plan: ${input.internalPlan ?? 'none'}`,
    `Allowed directive option catalog: ${JSON.stringify(candidates.map((candidate) => ({
      id: candidate.id,
      panelOrder: candidate.directive.panelOrder,
      kind: candidate.directive.kind,
      entityNames: candidate.entityNames,
    })))}.`,
  ];
  const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> = [{
    type: 'input_text', text: text.join('\n\n'),
  }];
  for (const image of input.inputImages) {
    content.push({ type: 'input_text', text: `Reference image label: ${image.label}.` });
    content.push({ type: 'input_image', image_url: image.dataUrl });
  }
  return content;
}

function buildDirectiveCandidates(input: PagePreRenderSceneAuditInput): DirectiveCandidate[] {
  const candidates: DirectiveCandidate[] = [];
  const append = (
    directive: PagePreRenderSceneAuditDirective,
    entityNames: string[],
  ): void => {
    candidates.push({
      id: `d${candidates.length.toString(36)}`,
      directive,
      entityNames,
    });
  };

  for (const panel of input.inputSnapshot.panels) {
    const seenEntityIds = new Set<string>();
    const subjects = panel.entityIds.flatMap((entityId, index) => {
      if (seenEntityIds.has(entityId)) return [];
      seenEntityIds.add(entityId);
      return [{ entityId, entityName: panel.entityNames[index] ?? entityId }];
    });

    for (const subject of subjects) {
      for (const kind of SOLO_DIRECTIVE_KINDS) {
        append({ panelOrder: panel.order, kind, entityIds: [subject.entityId] }, [subject.entityName]);
      }
    }
    for (let left = 0; left < subjects.length; left += 1) {
      for (let right = left + 1; right < subjects.length; right += 1) {
        const leftSubject = subjects[left]!;
        const rightSubject = subjects[right]!;
        append(
          { panelOrder: panel.order, kind: 'interaction', entityIds: [leftSubject.entityId, rightSubject.entityId] },
          [leftSubject.entityName, rightSubject.entityName],
        );
      }
    }
  }
  return candidates;
}

function resolveDirectiveSelection(
  input: PagePreRenderSceneAuditInput,
  candidates: DirectiveCandidate[],
  response: z.infer<typeof wireSchema>,
): PagePreRenderSceneAuditResult {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const directives = [...new Set(response.directive_ids)].map((id) => {
    const candidate = candidateById.get(id);
    if (candidate === undefined) {
      throw new ValidationError('Page pre-render scene audit returned an unknown directive option');
    }
    return candidate.directive;
  });
  return validatePagePreRenderSceneAudit(input, {
    verdict: directives.length > 0 ? 'guidance' : response.assessment === 'clear' ? 'pass' : 'uncertain',
    directives,
  });
}

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function systemInstructions(): string {
  return [
    PAGE_VISUAL_INTEGRITY_POLICY,
    'Audit the authored scene before rendering. Assess the whole scene first, then only appearance/state, anatomy or motion, interaction, object integrity, and scale risks.',
    'Set assessment to clear only when the whole scene is coherently drawable. Set it to uncertain when there is no grounded risk or no confident judgment. Omit an individual speculative risk without suppressing other grounded risks.',
    'Select only opaque IDs from the allowed directive option catalog. Use directive_ids for grounded risks and otherwise return an empty array. Never invent, rewrite, or combine option IDs. The server derives guidance from a nonempty selection and ignores assessment in that case.',
    'The original prompt, dialogue, supplied reference/state assignment, and layout are authoritative over the internal plan. The layout reference controls borders only. For objects, authored holder, use, and contact are authoritative over independent coordinates.',
    'Preserve the original panel subjects, supplied reference images, selected states, dialogue, and authored plot. Intentional fantasy species, anatomy, and scale are authoritative.',
    'Never rewrite prose, choose reference/state numbers, invent coordinates, or describe a completed image.',
  ].join(' ');
}

function buildJsonSchema(candidates: DirectiveCandidate[]): Record<string, unknown> {
  const candidateIds = candidates.map((candidate) => candidate.id);
  return {
    type: 'object', additionalProperties: false,
    properties: {
      assessment: { type: 'string', enum: ['clear', 'uncertain'] },
      directive_ids: {
        type: 'array',
        maxItems: Math.min(PAGE_SCENE_AUDIT_MAX_DIRECTIVES, candidateIds.length),
        items: candidateIds.length === 0
          ? { type: 'string' }
          : { type: 'string', enum: candidateIds },
      },
    }, required: ['assessment', 'directive_ids'],
  };
}
