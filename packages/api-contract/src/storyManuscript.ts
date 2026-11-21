/** Commands remain in the saved manuscript. Only opted-in consumers interpret
 * them; generated dialogue and character evidence use the separated prose. */
export interface StoryManuscriptDirection {
  instruction: string;
  offset: number;
}

export interface StoryManuscriptBlock {
  id: string;
  text: string;
  evidenceSpans: string[];
  directions: StoryManuscriptDirection[];
  fixedPanel: boolean;
  boundaryBefore: 'page' | 'panel' | null;
  boundaryAfter: 'page' | 'panel' | null;
}

export interface StoryManuscriptPage {
  blocks: StoryManuscriptBlock[];
  explicitPanels: boolean;
  fixedPage: boolean;
}

export interface StoryManuscript {
  prose: string;
  hasCommands: boolean;
  explicitPageCount: number | null;
  minimumPanelCount: number;
  pages: StoryManuscriptPage[];
}

export class StoryManuscriptError extends Error {}

/** New clients treat authored commands as intent without a second opt-in.
 * Detection stays safe while typing; malformed commands remain enabled so the
 * normal validation path can explain them instead of silently ignoring them.
 * Legacy consumers still explicitly control parseStoryManuscript's enabled flag. */
export function hasStoryManuscriptCommands(text: string): boolean {
  try {
    return parseStoryManuscript(text, true).hasCommands;
  } catch (error) {
    if (error instanceof StoryManuscriptError) return true;
    throw error;
  }
}

const quoted = '「[^」\\r\\n]{1,160}」';
const legacyNote = new RegExp(`^[ \\t]*[#＃][ \\t]*(?:${quoted}と${quoted}は(?:同じコマ|別(?:の)?コマ)(?:にする)?|${quoted}のコマから${quoted}は${quoted}(?:状態)?|${quoted}のコマ(?:で|から)${quoted}は通常に戻(?:す|る))[。.]?[ \\t]*$`, 'u');
const separator = /^[ \t]*(===|＝＝＝|---|ーーー)[ \t]*$/u;
const inlineDirection = /(?<!#)(#)([^#＃\r\n]+)\1(?!#)|＃([^#＃\r\n]*)＃/gu;

function isMarkdownHeading(text: string, index: number, matched: string): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return /^#\s/u.test(matched) && /^ {0,3}$/u.test(text.slice(lineStart, index));
}

function readBlock(raw: string, id: string,
  boundaryBefore: StoryManuscriptBlock['boundaryBefore'],
  boundaryAfter: StoryManuscriptBlock['boundaryAfter']): StoryManuscriptBlock {
  const directions: StoryManuscriptDirection[] = [];
  const evidenceSpans: string[] = [];
  let text = '';
  let cursor = 0;
  for (const match of raw.matchAll(inlineDirection)) {
    if (isMarkdownHeading(raw, match.index, match[0])) continue;
    evidenceSpans.push(raw.slice(cursor, match.index));
    text += raw.slice(cursor, match.index);
    const instruction = (match[2] ?? match[3])?.trim() ?? '';
    if (instruction.length === 0 || instruction.length > 600) {
      throw new StoryManuscriptError('作画指示は＃で囲み、1〜600文字で入力してください。');
    }
    directions.push({ instruction, offset: text.length });
    // Never join words on opposite sides of an instruction into new evidence.
    text += '\n\n';
    cursor = match.index + match[0].length;
  }
  text += raw.slice(cursor);
  evidenceSpans.push(raw.slice(cursor));
  if (text.replace(/^[ \t]*＃[ \t]+[^\r\n]*$/gmu, '').includes('＃')) {
    throw new StoryManuscriptError('作画指示を閉じる＃がありません。');
  }
  const leadingWhitespace = text.length - text.trimStart().length;
  return { id, text: text.trim(), evidenceSpans: evidenceSpans.map(span => span.trim()).filter(Boolean), boundaryBefore, boundaryAfter,
    fixedPanel: boundaryBefore !== null && boundaryAfter !== null
      && (boundaryBefore === 'panel' || boundaryAfter === 'panel'),
    directions: directions.map(direction => ({
    ...direction, offset: Math.max(0, direction.offset - leadingWhitespace),
  })) };
}

export function parseStoryManuscript(text: string, enabled: boolean): StoryManuscript {
  if (!enabled) return {
    prose: text, hasCommands: false, explicitPageCount: null,
    minimumPanelCount: text.trim().length > 0 ? 1 : 0,
    pages: [{ blocks: [{ id: 'segment-1', text, evidenceSpans: [text], directions: [], fixedPanel: false,
      boundaryBefore: null, boundaryAfter: null }], explicitPanels: false, fixedPage: false }],
  };
  const pages: StoryManuscriptPage[] = [];
  let page: StoryManuscriptPage = { blocks: [], explicitPanels: false, fixedPage: false };
  let lines: string[] = [];
  let blockNumber = 0;
  let pageBreak = false;
  let hasCommands = false;
  let boundaryBefore: StoryManuscriptBlock['boundaryBefore'] = null;
  let pageStartsAtBoundary = false;
  const flushBlock = (boundaryAfter: StoryManuscriptBlock['boundaryAfter']): void => {
    const block = readBlock(lines.join('\n'), `segment-${++blockNumber}`, boundaryBefore, boundaryAfter);
    lines = [];
    if (block.text.length > 0) page.blocks.push(block);
    else if (block.directions.length > 0) {
      throw new StoryManuscriptError('作画指示と同じ区切りの中に、対象のシーンを入力してください。');
    }
    if (block.directions.length > 0) hasCommands = true;
    boundaryBefore = boundaryAfter;
  };
  for (const line of text.split(/\r?\n/u)) {
    if (legacyNote.test(line)) { hasCommands = true; continue; }
    const marker = separator.exec(line)?.[1];
    if (marker === undefined) { lines.push(line); continue; }
    const isPage = marker === '===' || marker === '＝＝＝';
    flushBlock(isPage ? 'page' : 'panel');
    hasCommands = true;
    if (isPage) {
      pageBreak = true;
      page.fixedPage = pageStartsAtBoundary;
      if (page.blocks.length > 0) pages.push(page);
      page = { blocks: [], explicitPanels: false, fixedPage: false };
      pageStartsAtBoundary = true;
    } else {
      page.explicitPanels = true;
    }
  }
  flushBlock(null);
  if (page.blocks.length > 0) pages.push(page);
  if (!hasCommands) return parseStoryManuscript(text, false);
  const directions = pages.flatMap(item => item.blocks.flatMap(block => block.directions));
  if (directions.length > 64) throw new StoryManuscriptError('作画指示は64件以内にしてください。');
  if (pages.length > 32 || pages.reduce((sum, item) => sum + item.blocks.length, 0) > 256) {
    throw new StoryManuscriptError('原稿のページ・コマ区切りが上限を超えています。');
  }
  return {
    prose: pages.flatMap(item => item.blocks.map(block => block.text)).join('\n\n'),
    hasCommands, pages, explicitPageCount: pageBreak && pages.length > 0 && pages.every(item => item.fixedPage)
      ? pages.length : null,
    minimumPanelCount: pages.reduce((sum, item) => sum + (item.explicitPanels ? item.blocks.length : 1), 0),
  };
}

export function analyzeStoryManuscript(text: string, enabled: boolean): Pick<StoryManuscript,
  'prose' | 'explicitPageCount' | 'minimumPanelCount'> {
  const { prose, explicitPageCount, minimumPanelCount } = parseStoryManuscript(text, enabled);
  return { prose, explicitPageCount, minimumPanelCount };
}

export function storyManuscriptEvidence(text: string, enabled: boolean): string[] {
  return parseStoryManuscript(text, enabled).pages.flatMap(page => page.blocks.flatMap(block => block.evidenceSpans));
}

/** Immutable command tokens stay between the same editable prose fragments. */
export function splitStoryManuscriptForEditing(text: string): Array<{ kind: 'prose' | 'command'; text: string }> {
  parseStoryManuscript(text, true);
  const parts: Array<{ kind: 'prose' | 'command'; text: string }> = [];
  let prose = '';
  const command = (value: string): void => {
    if (prose.length > 0) { parts.push({ kind: 'prose', text: prose }); prose = ''; }
    parts.push({ kind: 'command', text: value });
  };
  for (const line of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    const content = line.replace(/\r?\n$/u, '');
    if (separator.test(content) || legacyNote.test(content)) { command(line); continue; }
    let cursor = 0;
    for (const match of line.matchAll(inlineDirection)) {
      if (isMarkdownHeading(line, match.index, match[0])) continue;
      prose += line.slice(cursor, match.index);
      command(match[0]);
      cursor = match.index + match[0].length;
    }
    prose += line.slice(cursor);
  }
  if (prose.length > 0) parts.push({ kind: 'prose', text: prose });
  return parts;
}
