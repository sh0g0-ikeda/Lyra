import {
  parseStoryManuscript,
  splitStoryManuscriptForEditing,
  StoryManuscriptError,
} from '../../../packages/api-contract/src/storyManuscript.js';
import type { StoryEpisodeDraftFields } from '../../domain/types/storyAi.js';
import { STORY_EPISODE_MANUSCRIPT_MAX_FRAGMENTS } from '../../domain/constants/storyAi.js';

type StoryBodyField = 'storyFullDraft' | 'introduction' | 'middle' | 'climax' | 'endingHook';

export interface StoryManuscriptEditableFragment {
  id: string;
  field: StoryBodyField;
  text: string;
}

export interface StoryManuscriptImmutableField {
  field: StoryBodyField;
  sequence: Array<
    | { kind: 'editable'; id: string; leadingWhitespace: string; trailingWhitespace: string }
    | { kind: 'command'; text: string }
    | { kind: 'whitespace'; text: string }
  >;
}

export interface ImprovedStoryManuscriptFragment {
  id: string;
  text: string;
}

export interface StoryManuscriptImprovementPlan {
  editableFragments: StoryManuscriptEditableFragment[];
  immutableFields: StoryManuscriptImmutableField[];
  reassemble(outputs: readonly ImprovedStoryManuscriptFragment[]): StoryEpisodeDraftFields;
}

export class StoryManuscriptImprovementError extends Error {}

const STRUCTURED_FIELD_MAX_LENGTH = 2_000;
const FULL_DRAFT_MAX_LENGTH = 8_000;

export function buildStoryManuscriptImprovementPlan(
  draft: StoryEpisodeDraftFields,
): StoryManuscriptImprovementPlan | null {
  const fields: StoryBodyField[] = draft.storyInputMode === 'full'
    ? ['storyFullDraft']
    : ['introduction', 'middle', 'climax', 'endingHook'];
  const editableFragments: StoryManuscriptEditableFragment[] = [];
  const immutableFields: StoryManuscriptImmutableField[] = [];
  let hasNewCommands = false;

  for (const field of fields) {
    const value = draft[field];
    if (value === null) continue;
    const parts = splitStoryManuscriptForEditing(value);
    let proseIndex = 0;
    const sequence: StoryManuscriptImmutableField['sequence'] = [];
    for (const part of parts) {
      if (part.kind === 'command') {
        sequence.push({ kind: 'command', text: part.text });
        if (isNewStoryCommand(part.text)) hasNewCommands = true;
        continue;
      }
      const { core, leadingWhitespace, trailingWhitespace } = splitOuterWhitespace(part.text);
      if (core.length === 0) {
        sequence.push({ kind: 'whitespace', text: part.text });
        continue;
      }
      proseIndex += 1;
      const id = `${field}-${proseIndex}`;
      editableFragments.push({ id, field, text: core });
      sequence.push({ kind: 'editable', id, leadingWhitespace, trailingWhitespace });
    }
    immutableFields.push({ field, sequence });
  }

  if (!hasNewCommands) return null;
  if (editableFragments.length > STORY_EPISODE_MANUSCRIPT_MAX_FRAGMENTS) {
    throw new StoryManuscriptError('指示で区切った本文が多すぎます。256か所以内にするか、話を分割してください。');
  }

  return {
    editableFragments,
    immutableFields,
    reassemble: (outputs) => reassembleStoryManuscript(draft, immutableFields, editableFragments, outputs),
  };
}

function reassembleStoryManuscript(
  draft: StoryEpisodeDraftFields,
  fields: readonly StoryManuscriptImmutableField[],
  expectedFragments: readonly StoryManuscriptEditableFragment[],
  outputs: readonly ImprovedStoryManuscriptFragment[],
): StoryEpisodeDraftFields {
  const expectedIds = new Set(expectedFragments.map((fragment) => fragment.id));
  const outputById = new Map<string, string>();
  for (const output of outputs) {
    if (!expectedIds.has(output.id) || outputById.has(output.id)) {
      throw new StoryManuscriptImprovementError('Story manuscript writer returned invalid fragment IDs');
    }
    const core = output.text.trim();
    if (splitStoryManuscriptForEditing(core).some((part) => part.kind === 'command')) {
      throw new StoryManuscriptImprovementError('Story manuscript writer introduced a command token');
    }
    outputById.set(output.id, core);
  }
  if (outputById.size !== expectedIds.size) {
    throw new StoryManuscriptImprovementError('Story manuscript writer omitted a fragment');
  }

  const result: StoryEpisodeDraftFields = { ...draft };
  for (const field of fields) {
    const value = field.sequence.map((part) => {
      if (part.kind === 'command' || part.kind === 'whitespace') return part.text;
      return `${part.leadingWhitespace}${outputById.get(part.id) ?? ''}${part.trailingWhitespace}`;
    }).join('');
    const maxLength = field.field === 'storyFullDraft' ? FULL_DRAFT_MAX_LENGTH : STRUCTURED_FIELD_MAX_LENGTH;
    if (value.length > maxLength) {
      throw new StoryManuscriptImprovementError('Story manuscript writer exceeded the field limit');
    }
    const original = draft[field.field];
    if (original === null) {
      throw new StoryManuscriptImprovementError('Story manuscript field mapping changed');
    }
    assertManuscriptStructurePreserved(original, value);
    result[field.field] = value.trim().length === 0 ? null : value;
  }
  return result;
}

function splitOuterWhitespace(value: string): {
  core: string;
  leadingWhitespace: string;
  trailingWhitespace: string;
} {
  const leadingWhitespace = /^\s*/u.exec(value)?.[0] ?? '';
  const afterLeading = value.slice(leadingWhitespace.length);
  const trailingWhitespace = /\s*$/u.exec(afterLeading)?.[0] ?? '';
  return {
    core: afterLeading.slice(0, afterLeading.length - trailingWhitespace.length),
    leadingWhitespace,
    trailingWhitespace,
  };
}

function assertManuscriptStructurePreserved(original: string, rebuilt: string): void {
  const originalParts = splitStoryManuscriptForEditing(original);
  const rebuiltParts = splitStoryManuscriptForEditing(rebuilt);
  const originalCommands = originalParts.filter((part) => part.kind === 'command').map((part) => part.text);
  const rebuiltCommands = rebuiltParts.filter((part) => part.kind === 'command').map((part) => part.text);
  if (JSON.stringify(originalCommands) !== JSON.stringify(rebuiltCommands)) {
    throw new StoryManuscriptImprovementError('Story manuscript command sequence changed');
  }

  const structure = (value: string) => parseStoryManuscript(value, true).pages.map((page) => ({
    fixedPage: page.fixedPage,
    explicitPanels: page.explicitPanels,
    blocks: page.blocks.map((block) => ({
      fixedPanel: block.fixedPanel,
      boundaryBefore: block.boundaryBefore,
      boundaryAfter: block.boundaryAfter,
    })),
  }));
  if (JSON.stringify(structure(original)) !== JSON.stringify(structure(rebuilt))) {
    throw new StoryManuscriptImprovementError('Story manuscript layout structure changed');
  }
}

function isNewStoryCommand(value: string): boolean {
  const trimmed = value.trim();
  if (/^\\?(?:===|＝＝＝|---|ーーー)$/u.test(trimmed)) return true;
  return (trimmed.startsWith('#') && trimmed.endsWith('#') && trimmed.length > 2)
    || (trimmed.startsWith('＃') && trimmed.endsWith('＃') && trimmed.length > 2);
}
