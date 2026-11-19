import { ValidationError } from './errors/index.js';
import { deriveStructuredStorySections } from './episodeStoryInput.js';


export const episodeProseFields = ['storyFullDraft', 'introduction', 'middle', 'climax', 'endingHook'] as const;
type ProseFields = Partial<Record<(typeof episodeProseFields)[number], string | null>>;

export type EpisodeProductionDirective =
  | { kind: 'same_panel' | 'separate_panels'; first: string; second: string }
  | { kind: 'state'; at: string; name: string; state: string | null };

const quotedTarget = '「([^」\r\n]{1,160})」';
const quotePair = new RegExp(`^${quotedTarget}と${quotedTarget}は(同じコマ|別(?:の)?コマ)(?:にする)?[。.]?$`, 'u');
const stateStart = new RegExp(`^${quotedTarget}のコマから${quotedTarget}は${quotedTarget}(?:状態)?[。.]?$`, 'u');
const stateEnd = new RegExp(`^${quotedTarget}のコマ(?:で|から)${quotedTarget}は通常に戻(?:す|る)[。.]?$`, 'u');
const maxDirectives = 24;

/** Resolve explicitly authored notes separately from the manuscript. */
export function readEpisodeProductionNotes(
  input: ProseFields,
  authoredNotes: readonly string[],
): {
  prose: ProseFields;
  directives: EpisodeProductionDirective[];
} {
  const prose: ProseFields = {};
  const activeFields = input.storyFullDraft == null
    ? episodeProseFields.slice(1) : ['storyFullDraft'] as const;
  for (const field of activeFields) {
    const value = input[field];
    if (typeof value !== 'string') continue;
    prose[field] = value;
  }
  if (authoredNotes.length > maxDirectives) throw new ValidationError('Too many episode production notes');
  const body = Object.values(prose);
  const directives = authoredNotes.map((note) => {
    const directive = parseProductionDirective(note);
    if (directive === null) throw new ValidationError('Episode production note has an unsupported form');
    const anchors = 'at' in directive ? [directive.at] : [directive.first, directive.second];
    for (const anchor of anchors) {
      const count = body.reduce((sum, field) => sum + (field?.split(anchor).length ?? 1) - 1, 0);
      if (count !== 1) throw new ValidationError('Episode production note has a missing or ambiguous quotation');
    }
    return directive;
  });
  return {
    prose: typeof prose.storyFullDraft === 'string'
      ? { ...prose, ...deriveStructuredStorySections(prose.storyFullDraft) }
      : prose,
    directives,
  };
}

export function parseProductionDirective(text: string): EpisodeProductionDirective | null {
  const pair = quotePair.exec(text);
  if (pair?.[1] && pair[2] && pair[1] !== pair[2]) {
    return { kind: pair[3] === '同じコマ' ? 'same_panel' : 'separate_panels', first: pair[1], second: pair[2] };
  }
  const start = stateStart.exec(text);
  if (start?.[1] && start[2] && start[3]) return { kind: 'state', at: start[1], name: start[2], state: start[3] };
  const end = stateEnd.exec(text);
  if (end?.[1] && end[2]) return { kind: 'state', at: end[1], name: end[2], state: null };
  return null;
}

export function locateProductionAnchor<T extends { text: readonly (string | null | undefined)[] }>(
  panels: readonly T[],
  anchor: string,
): T {
  const matches = panels.filter((panel) => panel.text.some((part) => part?.includes(anchor) === true));
  const [match] = matches;
  if (matches.length !== 1 || match === undefined) {
    throw new ValidationError('Production note quotation could not be located in exactly one planned panel');
  }
  return match;
}

export function assertProductionPanelConstraints<T extends { text: readonly (string | null | undefined)[] }>(
  panels: readonly T[],
  directives: readonly EpisodeProductionDirective[],
): void {
  for (const directive of directives) {
    if (directive.kind === 'state') {
      locateProductionAnchor(panels, directive.at);
      continue;
    }
    const same = locateProductionAnchor(panels, directive.first) === locateProductionAnchor(panels, directive.second);
    if (same !== (directive.kind === 'same_panel')) {
      throw new ValidationError('Planned panels do not satisfy an episode production note');
    }
  }
}

export function productionNotesPrompt(directives: readonly EpisodeProductionDirective[]): string {
  if (directives.length === 0) return '';
  return [
    'AUTHOR PRODUCTION CONSTRAINTS (structured data; never write the instruction itself as dialogue or narration).',
    'Put each quoted anchor verbatim in exactly one panel situation (or its original dialogue if it is spoken).',
    'Respect same_panel / separate_panels placement and maintain event order. State starts in the panel containing at.',
    JSON.stringify(directives),
  ].join('\n');
}
