import { z } from 'zod';
import {
  PAGE_SCENE_AUDIT_MAX_TOKENS,
  PAGE_SCENE_AUDIT_MODEL,
  PAGE_SCENE_AUDIT_VERSION,
  PAGE_GENERATION_INTERNAL_PLAN_MAX_CHARS,
  PAGE_IMAGE_PROMPT_MAX_CHARACTERS,
  PAGE_SCENE_AUDIT_MAX_BRIEF_CHARACTERS,
  PAGE_SCENE_AUDIT_MAX_INPUT_IMAGES,
} from '../../domain/constants/generation.js';
import { PAGE_VISUAL_INTEGRITY_POLICY } from '../../services/page/PageVisualPolicy.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import {
  validatePagePreRenderSceneAudit,
  type PagePreRenderSceneAuditInput,
  type PagePreRenderSceneAuditResult,
  type PagePreRenderSceneAuditorPort,
} from '../../services/page/PagePreRenderSceneAudit.js';
import { OpenAIClient } from './OpenAIClient.js';
import { requestStructuredOpenAIResponse } from './StructuredOpenAIResponse.js';

const wireSchema = z.object({
  verdict: z.enum(['pass', 'guidance', 'uncertain']),
  directives: z.array(z.object({
    panel_order: z.number().int().min(1),
    kind: z.enum(['appearance', 'anatomy_motion', 'interaction', 'object_integrity', 'scale']),
    entity_ids: z.array(z.string().min(1).max(128)).min(1).max(2),
  }).strict()).max(12),
}).strict();

export class OpenAIPagePreRenderSceneAuditor implements PagePreRenderSceneAuditorPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model: string = PAGE_SCENE_AUDIT_MODEL,
    private readonly maxTokens: number = PAGE_SCENE_AUDIT_MAX_TOKENS,
  ) {}

  public async audit(input: PagePreRenderSceneAuditInput): Promise<PagePreRenderSceneAuditResult> {
    validateInput(input);
    const response = await requestStructuredOpenAIResponse({
      client: this.client,
      model: this.model,
      maxOutputTokens: this.maxTokens,
      schemaName: PAGE_SCENE_AUDIT_VERSION,
      jsonSchema: buildJsonSchema(),
      responseSchema: wireSchema,
      errorLabel: 'OpenAI page pre-render scene auditor',
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemInstructions() }] },
        { role: 'user', content: buildUserContent(input) },
      ],
    });
    return validatePagePreRenderSceneAudit(input, {
      verdict: response.verdict,
      directives: response.directives.map((directive) => ({
        panelOrder: directive.panel_order,
        kind: directive.kind,
        entityIds: directive.entity_ids,
      })),
    });
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

function buildUserContent(input: PagePreRenderSceneAuditInput): Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> {
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

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function systemInstructions(): string {
  return [
    PAGE_VISUAL_INTEGRITY_POLICY,
    'Audit the authored scene before rendering. Assess the whole scene first, then only appearance/state, anatomy or motion, interaction, object integrity, and scale risks.',
    'Return pass only when the whole scene is coherently drawable. Return guidance only for grounded risks. Return uncertain when there is no grounded risk or no confident judgment. Omit an individual speculative risk without suppressing other grounded risks.',
    'Runtime output contract: guidance requires one or more directives; pass and uncertain require an empty directives array. Every directive must target an existing panel and only entity IDs assigned to that panel. interaction requires exactly two distinct assigned entity IDs; every other kind requires exactly one. Do not emit duplicate directives; interaction entity ID order is unordered for duplicate detection.',
    'The original prompt, dialogue, supplied reference/state assignment, and layout are authoritative over the internal plan. The layout reference controls borders only. For objects, authored holder, use, and contact are authoritative over independent coordinates.',
    'Preserve the original panel subjects, supplied reference images, selected states, dialogue, and authored plot. Intentional fantasy species, anatomy, and scale are authoritative.',
    'Never rewrite prose, choose reference/state numbers, invent coordinates, or describe a completed image.',
  ].join(' ');
}

function buildJsonSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      verdict: { type: 'string', enum: ['pass', 'guidance', 'uncertain'] },
      directives: { type: 'array', maxItems: 12, items: {
        type: 'object', additionalProperties: false,
        properties: {
          panel_order: { type: 'integer', minimum: 1 },
          kind: { type: 'string', enum: ['appearance', 'anatomy_motion', 'interaction', 'object_integrity', 'scale'] },
          entity_ids: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', minLength: 1, maxLength: 128 } },
        }, required: ['panel_order', 'kind', 'entity_ids'],
      } },
    }, required: ['verdict', 'directives'],
  };
}
