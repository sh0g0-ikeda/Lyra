import { EPISODE_PAGE_PLAN_MAX_DIALOGUE_LINES_PER_PANEL } from '../../domain/constants/generation.js';
import type { OpenAIReasoningEffort } from './StructuredOpenAIResponse.js';
import { STORY_SOURCE_POLICY, STORY_TEXT_POLICY, STORY_SPEAKER_POLICY, STORY_DIALOGUE_FLOW_POLICY, STORY_PANEL_POLICY } from './StoryEditorialPrompts.js';
import {
  EPISODE_PLAN_AUDIT_COMPILER_MAX_ATTEMPTS,
  EPISODE_PLAN_AUDIT_COMPILER_MAX_TOKENS,
  EPISODE_PLAN_AUDIT_COMPILER_OPENAI_MODEL,
  EPISODE_PLAN_AUDIT_COMPILER_VERSION,
} from '../../domain/constants/generation.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import { describeAppLanguage } from '../../domain/types/language.js';
import {
  episodePlanAuditIssueCodes,
  episodePlanAuditPageRepairFields,
  episodePlanAuditPanelRepairFields,
  episodePlanAuditSchema,
} from '../../lib/validators/episodePlanAudit.schema.js';
import {
  EPISODE_PLAN_AUDIT_COVERAGE_MAX_CHECKS_PER_PAGE,
  EPISODE_PLAN_AUDIT_COVERAGE_MAX_EVIDENCE_PER_CHECK,
  EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS,
  EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS,
  EpisodePlanAuditCoverageError,
  validateEpisodePlanAuditCoverage,
} from '../../services/page/EpisodePlanAuditCoverage.js';
import type {
  CompiledEpisodePlanAudit,
  CompileEpisodePlanAuditInput,
  EpisodePlanAudit,
  EpisodePlanAuditPageRepair,
  EpisodePlanAuditPageRepairField,
  EpisodePlanAuditPanelRepair,
  EpisodePlanAuditPanelRepairField,
  EpisodePlanAuditCompilerPort,
} from '../../services/page/EpisodePlanAuditCompiler.js';
import { OpenAIClient } from './OpenAIClient.js';
import {
  requestStructuredOpenAIResponse,
  StructuredOpenAIResponseError,
} from './StructuredOpenAIResponse.js';

export class OpenAIEpisodePlanAuditCompiler implements EpisodePlanAuditCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = EPISODE_PLAN_AUDIT_COMPILER_OPENAI_MODEL,
    private readonly reasoningEffort?: OpenAIReasoningEffort,
  ) {}

  public async auditPlan(
    input: CompileEpisodePlanAuditInput,
  ): Promise<CompiledEpisodePlanAudit> {
    const allowedPageIds = [...new Set(input.pageIds)];
    if (allowedPageIds.length === 0) {
      throw new ConfigurationError('Episode plan audit requires at least one page ID');
    }
    if (input.coverageCatalog === undefined) {
      throw new ConfigurationError('OpenAI episode plan audit requires a coverage catalog');
    }

    const baseRequestInput = [
      {
        role: 'system' as const,
        content: [{ type: 'input_text' as const, text: buildSystemPrompt(input.language) }],
      },
      {
        role: 'user' as const,
        content: [{ type: 'input_text' as const, text: input.compilerBrief }],
      },
    ];
    let requestInput = baseRequestInput;
    let validated: AuditPayload | null = null;
    for (let attempt = 1; attempt <= EPISODE_PLAN_AUDIT_COMPILER_MAX_ATTEMPTS; attempt += 1) {
      let coverageRetryInstruction: string | null = null;
      try {
        const candidate = await requestStructuredOpenAIResponse({
          client: this.client,
          model: this.model,
      reasoningEffort: this.reasoningEffort,
          maxOutputTokens: EPISODE_PLAN_AUDIT_COMPILER_MAX_TOKENS,
          schemaName: 'episode_plan_audit',
          jsonSchema: buildEpisodePlanAuditJsonSchema(allowedPageIds),
          responseSchema: episodePlanAuditSchema,
          errorLabel: 'OpenAI episode plan audit compiler',
          input: requestInput,
        });
        const candidateAudit = mapAuditPayload(candidate);
        try {
          validateEpisodePlanAuditCoverage(candidateAudit, input.coverageCatalog);
        } catch (error) {
          if (!(error instanceof ConfigurationError)) {
            throw error;
          }
          coverageRetryInstruction = error instanceof EpisodePlanAuditCoverageError
            ? error.retryInstruction
            : 'Coverage correction for the retry: rebuild source_coverage from exact named refs and contiguous displayed quotes only.';
          throw new StructuredOpenAIResponseError(
            'OpenAI episode plan audit compiler returned invalid source coverage',
            'invalid_payload',
            true,
            null,
          );
        }
        validated = candidate;
        break;
      } catch (error) {
        if (
          !(error instanceof StructuredOpenAIResponseError) ||
          !error.retryable ||
          attempt >= EPISODE_PLAN_AUDIT_COMPILER_MAX_ATTEMPTS
        ) {
          throw error;
        }

        await input.beforeRetry?.();
        if (coverageRetryInstruction !== null) {
          requestInput = [
            ...baseRequestInput,
            {
              role: 'user' as const,
              content: [{
                type: 'input_text' as const,
                text: coverageRetryInstruction,
              }],
            },
          ];
        }
        console.warn('episode_plan_audit_compiler_retry', {
          attempt,
          nextAttempt: attempt + 1,
          reason: error.reason,
          requestId: error.requestId,
        });
      }
    }

    if (validated === null) {
      throw new ConfigurationError('OpenAI episode plan audit compiler failed');
    }

    return {
      audit: mapAuditPayload(validated),
      compilerProvider: 'openai',
      compilerModel: this.model,
      compilerPromptVersion: EPISODE_PLAN_AUDIT_COMPILER_VERSION,
    };
  }
}

function buildSystemPrompt(language: CompileEpisodePlanAuditInput['language']): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'Check whether each line belongs at that exact moment, whether the named speaker can know and say it, and whether the next line is a coherent response.',
    'Treat scene character-state notes such as costume, injury, hair, and expression as continuity facts until the source explicitly changes them.',
    'Use severity=error for a concrete missing source fact, dropped ongoing action, or visible entity contradiction when a safe field-level repair can restore the source. These repairable facts must not be downgraded merely because the remaining draft can be saved.',
    'Use severity=warning only for optional improvements that do not correct a source fact, ongoing action, visible staging, continuity, or readability defect.',
    'Return field-level repairs for every repairable error. Change only fields named in changed_fields and never change page IDs, page numbers, panel orders, or panel counts.',
    'Every field named in changed_fields must have a corresponding patch value. Use an empty array, never null, to clear dialogue, entities, or source_scene_ids. Never use null for roles, sizes, composition, dialogue_in_panel, dialogue_mode, or page_dialogue_toggle.',
    'Do not return repairs for warnings or pages that are not named by an error.',
    STORY_PANEL_POLICY,
    'Audit the complete episode across page boundaries as a manga continuity and readability editor.',
    STORY_SOURCE_POLICY,
    'Compare the compiled draft against source story, ledger ownership including text_plan, and the untruncated counts in TEXT DISTRIBUTION.',
    'Check every explicitly authored source dialogue line against COMPLETE DIALOGUE for exact interior wording and the unambiguous speaker or thinker and dialogue type assigned by the source. Apply the same exact-wording check to explicitly assigned narration or caption/display text, which must keep type=narration and entity_id=null. Japanese brackets around a name, title, alias, or cited label are not dialogue unless the source assigns the text as an utterance, private thought, narration, or caption.',
    'If an authored line is missing, shortened, paraphrased, merged, split, or assigned to a different known speaker or type, return an error and an existing dialogue field repair that restores the exact line and assignment. Never invent a speaker where the source is ambiguous.',
    'For each source action chain, compare its prerequisite, action, immediate result, and stated order with actual panel fields. A ledger summary or metadata mention does not prove that a step happened on the page.',
    'Do not accept a required prerequisite, cause, or ongoing action merely because it appears in page purpose, continuity, entry/exit state, handoff, or ledger text. If the relevant panel fields do not stage it, report source_omission or ongoing_action_dropped with a field-level repair.',
    STORY_TEXT_POLICY,
    STORY_SPEAKER_POLICY,
    STORY_DIALOGUE_FLOW_POLICY,
    'Find accidental repeated beats, early revelations, broken responses, unsupported facts, and unmotivated changes of time, location, knowledge, costume, injury, or emotion. Source-supported callbacks and flashbacks are not automatic defects.',
    'Check page entry/exit/handoff and whether required information was left out early and dumped into late pages or final panels. Compare total text length, available frame area, silent-beat purpose, and neighboring pages; do not demand uniform density.',
    'Use dialogue_density with severity=error for every panel above the entry cap; this is deterministic, not optional. Within the cap, use error only for a concrete reading/story defect; use warning for a justified non-blocking improvement, not taste.',
    'Every DETERMINISTIC FINDING is binding and needs a repair. Inspect all over-limit panels in TEXT DISTRIBUTION, not only an example panel from a grouped finding.',
    'For cross-panel or cross-page redistribution, patch every affected source and destination dialogue array together, preserve true speakers and chronology, and preserve essential source information. Do not truncate excess lines or hide text via flags or visual fields.',
    'Return field-level repairs for each repairable error; change only named changed_fields. Do not alter page IDs, page numbers, panel orders, panel counts, or saved frame geometry.',
    'Keep unchanged fields null in patch payloads; every changed field must carry its intended value. Use [] rather than null to clear dialogue, entities, or source_scene_ids. Do not use null for roles, sizes, composition, dialogue_in_panel, dialogue_mode, or page_dialogue_toggle.',
    'Do not return repairs for warnings or pages not named by an error. Set accepted=true only when no error remains; if a defect cannot be repaired safely within existing pages and source facts, report it instead of claiming success.',
    `Write issue messages and repair instructions in natural ${outputLanguage}.`,
  ].join(' ');
}

type AuditPayload = ReturnType<typeof episodePlanAuditSchema.parse>;

function mapAuditPayload(payload: AuditPayload): EpisodePlanAudit {
  return {
    accepted: payload.accepted,
    issues: payload.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      pageIds: issue.page_ids,
      message: issue.message,
      repairInstruction: issue.repair_instruction,
    })),
    pageRepairs: payload.page_repairs.map(mapPageRepair),
    panelRepairs: payload.panel_repairs.map(mapPanelRepair),
    sourceCoverage: payload.source_coverage.map((page) => ({
      pageId: page.page_id,
      checks: page.checks.map((check) => ({
        sourceRef: check.source_ref,
        sourceQuote: check.source_quote,
        status: check.status,
        outputEvidence: check.output_evidence.map((evidence) => ({
          outputRef: evidence.output_ref,
          quote: evidence.quote,
        })),
        issueCode: check.issue_code,
        repairTarget: check.repair_target === null ? null : {
          scope: check.repair_target.scope,
          pageId: check.repair_target.page_id,
          panelOrder: check.repair_target.panel_order,
        },
      })),
    })),
  };
}

function mapPageRepair(
  repair: AuditPayload['page_repairs'][number],
): EpisodePlanAuditPageRepair {
  const changedFields = repair.changed_fields.map(mapPageRepairField);
  const patch: EpisodePlanAuditPageRepair['patch'] = {};
  for (const field of changedFields) {
    switch (field) {
      case 'sourceSceneIds':
        patch.sourceSceneIds = requireRepairValue(repair.patch.source_scene_ids, field);
        break;
      case 'pagePurpose':
        patch.pagePurpose = repair.patch.page_purpose;
        break;
      case 'continuityNote':
        patch.continuityNote = repair.patch.continuity_note;
        break;
      case 'dialogueMode':
        patch.dialogueMode = requireRepairValue(repair.patch.dialogue_mode, field);
        break;
      case 'pageDialogueToggle':
        patch.pageDialogueToggle = requireRepairValue(
          repair.patch.page_dialogue_toggle,
          field,
        );
        break;
    }
  }

  return {
    pageId: repair.page_id,
    changedFields,
    patch,
  };
}

function mapPanelRepair(
  repair: AuditPayload['panel_repairs'][number],
): EpisodePlanAuditPanelRepair {
  const changedFields = repair.changed_fields.map(mapPanelRepairField);
  const patch: EpisodePlanAuditPanelRepair['patch'] = {};
  for (const field of changedFields) {
    switch (field) {
      case 'panelRole':
        patch.panelRole = requireRepairValue(repair.patch.panel_role, field);
        break;
      case 'panelSize':
        patch.panelSize = requireRepairValue(repair.patch.panel_size, field);
        break;
      case 'situationText':
        patch.situationText = repair.patch.situation_text;
        break;
      case 'composition': {
        const composition = requireRepairValue(repair.patch.composition, field);
        patch.composition = {
          source: composition.source,
          galleryItemId: composition.gallery_item_id,
          compositionPrompt: composition.composition_prompt,
          shotType: composition.shot_type,
          angle: composition.angle,
          customNote: composition.custom_note,
        };
        break;
      }
      case 'dialogueInPanel':
        patch.dialogueInPanel = requireRepairValue(repair.patch.dialogue_in_panel, field);
        break;
      case 'dialogue':
        patch.dialogue = requireRepairValue(repair.patch.dialogue, field).map((line) => ({
          entityId: line.entity_id,
          text: line.text,
          type: line.type,
          position: line.position,
        }));
        break;
      case 'sfxText':
        patch.sfxText = repair.patch.sfx_text;
        break;
      case 'backgroundNote':
        patch.backgroundNote = repair.patch.background_note;
        break;
      case 'panelNotes':
        patch.panelNotes = repair.patch.panel_notes;
        break;
      case 'entities':
        patch.entities = requireRepairValue(repair.patch.entities, field).map((entity) => ({
          entityId: entity.entity_id,
          role: entity.role,
          expression: entity.expression,
          customExpression: entity.custom_expression,
          action: entity.action,
          customAction: entity.custom_action,
          position: entity.position,
          facingDirection: entity.facing_direction,
          effectNote: entity.effect_note,
          stateId: entity.state_id,
        }));
        break;
    }
  }

  return {
    pageId: repair.page_id,
    panelOrder: repair.panel_order,
    changedFields,
    patch,
  };
}

function mapPageRepairField(
  field: AuditPayload['page_repairs'][number]['changed_fields'][number],
): EpisodePlanAuditPageRepairField {
  const fields: Record<typeof field, EpisodePlanAuditPageRepairField> = {
    source_scene_ids: 'sourceSceneIds',
    page_purpose: 'pagePurpose',
    continuity_note: 'continuityNote',
    dialogue_mode: 'dialogueMode',
    page_dialogue_toggle: 'pageDialogueToggle',
  };
  return fields[field];
}

function mapPanelRepairField(
  field: AuditPayload['panel_repairs'][number]['changed_fields'][number],
): EpisodePlanAuditPanelRepairField {
  const fields: Record<typeof field, EpisodePlanAuditPanelRepairField> = {
    panel_role: 'panelRole',
    panel_size: 'panelSize',
    situation_text: 'situationText',
    composition: 'composition',
    dialogue_in_panel: 'dialogueInPanel',
    dialogue: 'dialogue',
    sfx_text: 'sfxText',
    background_note: 'backgroundNote',
    panel_notes: 'panelNotes',
    entities: 'entities',
  };
  return fields[field];
}

function requireRepairValue<TValue>(
  value: TValue | null,
  field: string,
): TValue {
  if (value === null) {
    throw new ConfigurationError(`Episode plan audit repair omitted ${field}`);
  }
  return value;
}

function nullableString(maxLength: number): Record<string, unknown> {
  return {
    anyOf: [{ type: 'string', minLength: 1, maxLength }, { type: 'null' }],
  };
}

const nullableBoolean = {
  anyOf: [{ type: 'boolean' }, { type: 'null' }],
} as const;

function nullableEnum(values: readonly string[]): Record<string, unknown> {
  return { anyOf: [{ type: 'string', enum: values }, { type: 'null' }] };
}

function nullableArray(
  items: Record<string, unknown>,
  maxItems: number,
): Record<string, unknown> {
  return { anyOf: [{ type: 'array', maxItems, items }, { type: 'null' }] };
}

const compositionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'source',
    'gallery_item_id',
    'composition_prompt',
    'shot_type',
    'angle',
    'custom_note',
  ],
  properties: {
    source: { type: 'string', enum: ['gallery', 'custom', 'ai_auto'] },
    gallery_item_id: nullableString(100),
    composition_prompt: nullableString(1000),
    shot_type: nullableEnum(['full_body', 'half_body', 'close_up', 'wide', 'extreme_close_up']),
    angle: nullableEnum(['front', 'side', 'three_quarter', 'bird_eye', 'worm_eye', 'dutch_angle']),
    custom_note: nullableString(1000),
  },
} as const;

const dialogueLineJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entity_id', 'text', 'type', 'position'],
  properties: {
    entity_id: nullableString(100),
    text: { type: 'string', minLength: 1, maxLength: 500 },
    type: { type: 'string', enum: ['speech', 'thought', 'narration', 'shout', 'whisper'] },
    position: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'center'] },
  },
} as const;

const entityAssignmentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'entity_id',
    'role',
    'expression',
    'custom_expression',
    'action',
    'custom_action',
    'position',
    'facing_direction',
    'effect_note',
    'state_id',
  ],
  properties: {
    entity_id: { type: 'string', minLength: 1, maxLength: 100 },
    role: { type: 'string', enum: ['primary', 'secondary', 'background'] },
    expression: {
      type: 'string',
      enum: ['determined', 'calm', 'angry', 'sad', 'surprised', 'custom'],
    },
    custom_expression: nullableString(200),
    action: {
      type: 'string',
      enum: ['standing_firm', 'attacking', 'defending', 'running', 'custom'],
    },
    custom_action: nullableString(200),
    position: { type: 'string', enum: ['left', 'center', 'right', 'background'] },
    facing_direction: nullableEnum([
      'front',
      'left',
      'right',
      'away',
      'three_quarter_left',
      'three_quarter_right',
    ]),
    effect_note: nullableString(500),
    state_id: nullableString(100),
  },
} as const;

const panelRepairPatchJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'panel_role',
    'panel_size',
    'situation_text',
    'composition',
    'dialogue_in_panel',
    'dialogue',
    'sfx_text',
    'background_note',
    'panel_notes',
    'entities',
  ],
  properties: {
    panel_role: nullableEnum([
      'establish',
      'action',
      'reaction',
      'emphasis',
      'transition',
      'pause',
      'impact',
    ]),
    panel_size: nullableEnum(['standard', 'large', 'wide', 'narrow', 'splash']),
    situation_text: nullableString(2000),
    composition: { anyOf: [compositionJsonSchema, { type: 'null' }] },
    dialogue_in_panel: nullableBoolean,
    dialogue: nullableArray(dialogueLineJsonSchema, EPISODE_PAGE_PLAN_MAX_DIALOGUE_LINES_PER_PANEL),
    sfx_text: nullableString(200),
    background_note: nullableString(2000),
    panel_notes: nullableString(2000),
    entities: nullableArray(entityAssignmentJsonSchema, 20),
  },
} as const;

function buildEpisodePlanAuditJsonSchema(
  allowedPageIds: readonly string[],
): Record<string, unknown> {
  const pageIdJsonSchema = { type: 'string', enum: [...allowedPageIds] };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['accepted', 'issues', 'page_repairs', 'panel_repairs', 'source_coverage'],
    properties: {
      accepted: { type: 'boolean' },
      issues: {
        type: 'array',
        maxItems: STORY_AI_LIMITS.maxSkeletonPages * 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'severity', 'page_ids', 'message', 'repair_instruction'],
          properties: {
            code: { type: 'string', enum: episodePlanAuditIssueCodes },
            severity: { type: 'string', enum: ['warning', 'error'] },
            page_ids: {
              type: 'array',
              minItems: 1,
              maxItems: STORY_AI_LIMITS.maxSkeletonPages,
              items: pageIdJsonSchema,
            },
            message: { type: 'string', minLength: 1, maxLength: 1000 },
            repair_instruction: { type: 'string', minLength: 1, maxLength: 1000 },
          },
        },
      },
      page_repairs: {
        type: 'array',
        maxItems: STORY_AI_LIMITS.maxSkeletonPages,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['page_id', 'changed_fields', 'patch'],
          properties: {
            page_id: pageIdJsonSchema,
            changed_fields: {
              type: 'array',
              minItems: 1,
              maxItems: episodePlanAuditPageRepairFields.length,
              items: { type: 'string', enum: episodePlanAuditPageRepairFields },
            },
            patch: {
              type: 'object',
              additionalProperties: false,
              required: [
                'source_scene_ids',
                'page_purpose',
                'continuity_note',
                'dialogue_mode',
                'page_dialogue_toggle',
              ],
              properties: {
                source_scene_ids: nullableArray({ type: 'string' }, 100),
                page_purpose: nullableString(500),
                continuity_note: nullableString(1000),
                dialogue_mode: nullableEnum(['image_baked', 'balloon_only', 'mixed']),
                page_dialogue_toggle: nullableBoolean,
              },
            },
          },
        },
      },
      panel_repairs: {
        type: 'array',
        maxItems: STORY_AI_LIMITS.maxSkeletonPages * STORY_AI_LIMITS.maxPanelsPerPage,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['page_id', 'panel_order', 'changed_fields', 'patch'],
          properties: {
            page_id: pageIdJsonSchema,
            panel_order: { type: 'integer', minimum: 1, maximum: 1000 },
            changed_fields: {
              type: 'array',
              minItems: 1,
              maxItems: episodePlanAuditPanelRepairFields.length,
              items: { type: 'string', enum: episodePlanAuditPanelRepairFields },
            },
            patch: panelRepairPatchJsonSchema,
          },
        },
      },
      source_coverage: {
        type: 'array',
        minItems: allowedPageIds.length,
        maxItems: allowedPageIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['page_id', 'checks'],
          properties: {
            page_id: pageIdJsonSchema,
            checks: {
              type: 'array',
              minItems: 1,
              maxItems: EPISODE_PLAN_AUDIT_COVERAGE_MAX_CHECKS_PER_PAGE,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'source_ref',
                  'source_quote',
                  'status',
                  'output_evidence',
                  'issue_code',
                  'repair_target',
                ],
                properties: {
                  source_ref: {
                    type: 'string',
                    minLength: 1,
                    maxLength: EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS,
                  },
                  source_quote: {
                    type: 'string',
                    minLength: 4,
                    maxLength: EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS,
                  },
                  status: { type: 'string', enum: ['present', 'missing'] },
                  output_evidence: {
                    type: 'array',
                    maxItems: EPISODE_PLAN_AUDIT_COVERAGE_MAX_EVIDENCE_PER_CHECK,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['output_ref', 'quote'],
                      properties: {
                        output_ref: {
                          type: 'string',
                          minLength: 1,
                          maxLength: EPISODE_PLAN_AUDIT_COVERAGE_REF_MAX_CHARS,
                        },
                        quote: {
                          type: 'string',
                          minLength: 4,
                          maxLength: EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS,
                        },
                      },
                    },
                  },
                  issue_code: nullableEnum(['source_omission', 'ongoing_action_dropped']),
                  repair_target: {
                    anyOf: [
                      {
                        type: 'object',
                        additionalProperties: false,
                        required: ['scope', 'page_id', 'panel_order'],
                        properties: {
                          scope: { type: 'string', enum: ['panel'] },
                          page_id: pageIdJsonSchema,
                          panel_order: { type: 'integer', minimum: 1, maximum: 1000 },
                        },
                      },
                      { type: 'null' },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
