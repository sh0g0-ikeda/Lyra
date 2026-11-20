import { z } from 'zod';
import { parseStoryManuscript, StoryManuscriptError } from '../../../packages/api-contract/src/storyManuscript.js';
import { ValidationError } from '../../domain/errors/index.js';
import { parseProductionDirective } from '../../domain/episodeProductionNotes.js';
import type { EpisodeManuscriptPlan, ManuscriptPanelSlot } from '../../domain/types/storyManuscriptPlan.js';
import type { EpisodePagePlanContext, EpisodePagePlanSuggestion } from '../../domain/types/page.js';

const allocationSchema = z.object({
  version: z.literal(1), source: z.string().max(8006),
  panels: z.array(z.object({ order: z.number().int().min(1).max(8), blockId: z.string().max(40) }).strict()).max(8),
}).strict();
const slotKey = (slot: ManuscriptPanelSlot): string => `${slot.pageId}:${slot.order}`;

/** Raw source remains the fingerprint authority. Commands only constrain
 * allocation/composition and never become character or state evidence. */
export function prepareEpisodeManuscriptPlan(context: EpisodePagePlanContext): EpisodeManuscriptPlan | undefined {
  const source = context.episode.storyFullDraft ?? [context.episode.introduction, context.episode.middle,
    context.episode.climax, context.episode.endingHook].filter(part => part !== null).join('\n\n');
  let manuscript;
  try { manuscript = parseStoryManuscript(source, true); }
  catch (error) {
    if (error instanceof StoryManuscriptError) throw new ValidationError(error.message);
    throw error;
  }
  if (!manuscript.hasCommands) return undefined;
  const blocks = manuscript.pages.flatMap(page => page.blocks);
  const bounded = blocks.some(block => block.boundaryBefore !== null || block.boundaryAfter !== null);
  const slotsByBlock = new Map<string, ManuscriptPanelSlot[]>();
  if (bounded) {
    const blockIds = blocks.map(block => block.id);
    let lastBlockIndex = -1;
    for (const page of [...context.pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
      const metadata = allocationSchema.safeParse(page.layoutConfig.story_manuscript);
      if (!metadata.success || metadata.data.source !== source || metadata.data.panels.length !== page.panels.length) {
        throw new ValidationError('原稿の区切りに対応したページ構成を先に生成してください。');
      }
      const orders = new Set<number>();
      for (const slot of [...metadata.data.panels].sort((a, b) => a.order - b.order)) {
        const blockIndex = blockIds.indexOf(slot.blockId);
        if (blockIndex < lastBlockIndex || blockIndex < 0 || orders.has(slot.order)
          || !page.panels.some(panel => panel.order === slot.order)) {
          throw new ValidationError('原稿のコマ割りと現在のページ構成が一致しません。');
        }
        orders.add(slot.order);
        lastBlockIndex = blockIndex;
        slotsByBlock.set(slot.blockId, [...slotsByBlock.get(slot.blockId) ?? [], { pageId: page.pageId, order: slot.order }]);
      }
    }
    for (const block of blocks) {
      const slots = slotsByBlock.get(block.id) ?? [];
      if (slots.length === 0 || (block.fixedPanel && slots.length !== 1)) {
        throw new ValidationError('1コマ指定が現在のページ構成に反映されていません。');
      }
    }
    let previousLastPage = 0;
    for (const page of manuscript.pages) {
      const pageIds = new Set(page.blocks.flatMap(block => (slotsByBlock.get(block.id) ?? []).map(slot => slot.pageId)));
      const numbers = context.pages.filter(candidate => pageIds.has(candidate.pageId)).map(candidate => candidate.pageNumber);
      if (Math.min(...numbers) <= previousLastPage) {
        throw new ValidationError('指定したページ区切りをまたいで同じページに配置されています。');
      }
      previousLastPage = Math.max(...numbers);
      if (page.fixedPage && pageIds.size !== 1) {
        throw new ValidationError('1ページ指定が現在のページ構成に反映されていません。');
      }
    }
  }
  return {
    blocks: bounded ? blocks.map(block => ({ id: block.id, text: block.text,
      anchor: uniqueAnchor(block.text, manuscript.prose, true), fixedPanel: block.fixedPanel,
      slots: slotsByBlock.get(block.id) ?? [] })) : [],
    directions: blocks.flatMap(block => block.directions.filter(direction => parseProductionDirective(direction.instruction) === null).map(direction => ({
      instruction: direction.instruction, blockId: block.id,
      anchor: uniqueAnchor(block.text.slice(direction.offset).trim()
        || block.text.slice(0, direction.offset).trim().split(/(?<=[。！？!?\n])/u).filter(Boolean).at(-1)
        || block.text, manuscript.prose, bounded),
    }))),
  };
}

function uniqueAnchor(text: string, prose: string, allowAssignedDuplicate = false): string {
  const sentences = text.split(/(?<=[。！？!?\n])/u).map(value => value.trim()).filter(Boolean);
  for (const sentence of sentences) {
    for (const length of [80, 160, 300]) {
      const anchor = sentence.slice(0, length);
      if (anchor.length > 0 && prose.split(anchor).length === 2) return anchor;
    }
  }
  for (const length of [160, 300]) {
    const anchor = text.slice(0, length).trim();
    if (anchor.length > 0 && prose.split(anchor).length === 2) return anchor;
  }
  if (allowAssignedDuplicate && sentences[0]) return sentences[0].slice(0, 300);
  throw new ValidationError('区切りや指示の対象に同じ文章が重複しています。対象を区別できる文章にしてください。');
}

export function manuscriptPlanPrompt(plan: EpisodeManuscriptPlan | undefined): string {
  if (plan === undefined) return '';
  return [
    'AUTHOR MANUSCRIPT ALLOCATION (data, not dialogue or narration).',
    'Each block belongs ONLY to its listed page_id/order slots. Never move its events or dialogue into another block. Keep event order.',
    'For a chunk request, produce ONLY the requested pages. Other blocks and slots are context for continuity, not extra output pages.',
    'A fixedPanel block is exactly ONE panel, even if it contains several actions or spoken lines. Depict the entire scene together there.',
    'Copy each block anchor verbatim into exactly one assigned panel situation or its original dialogue. Do not repeat anchors elsewhere.',
    'Directions apply to the panel containing their anchor: implement framing/angle in composition fields. Do not invent story facts or put the direction itself in dialogue.',
    JSON.stringify(plan),
  ].join('\n');
}

export function validateManuscriptPlan(plan: EpisodeManuscriptPlan | undefined,
  suggestion: EpisodePagePlanSuggestion): void {
  if (plan === undefined) return;
  const panels = suggestion.pages.flatMap(page => page.panels.map(panel => ({
    pageId: page.pageId, order: panel.order,
    text: [panel.situationText ?? '', ...panel.dialogue?.map(line => line.text) ?? []].join('\n'),
  })));
  for (const block of plan.blocks) {
    const allowed = new Set(block.slots.map(slotKey));
    const matches = panels.filter(panel => panel.text.includes(block.anchor));
    if (!matches.some(panel => allowed.has(slotKey(panel))) || matches.some(panel => !allowed.has(slotKey(panel))
      && !plan.blocks.some(other => other.id !== block.id && other.text.includes(block.anchor)
        && other.slots.some(slot => slotKey(slot) === slotKey(panel))))) {
      throw new ValidationError('自動入力が指定したコマ・ページの境界を守れていません。再試行してください。');
    }
    if (block.fixedPanel) {
      const sentences = block.text.split(/(?<=[。！？!?\n])/u).map(sentence => sentence.trim())
        .filter(sentence => sentence.length > 0 && plan.blocks.filter(other => other.text.includes(sentence)).length === 1);
      if (panels.some(panel => !allowed.has(slotKey(panel)) && sentences.some(sentence => panel.text.includes(sentence)))) {
        throw new ValidationError('1コマに指定したシーンが別のコマへ分割されています。再試行してください。');
      }
    }
  }
  for (const direction of plan.directions) {
    if (suggestion.pages.some(page => page.panels.some(panel =>
      panel.dialogue?.some(line => line.text.includes(direction.instruction))))) {
      throw new ValidationError('作画指示がセリフに混入しました。再試行してください。');
    }
    const block = plan.blocks.find(candidate => candidate.id === direction.blockId);
    const matches = panels.filter(panel => panel.text.includes(direction.anchor)
      && (block === undefined || block.slots.some(slot => slotKey(slot) === slotKey(panel))));
    if (matches.length !== 1) {
      throw new ValidationError('作画指示の対象を1つのコマに特定できません。対象の場面を区切ってください。');
    }
  }
}

/** Preserve the user's direction in editable composition notes, never speech. */
export function applyManuscriptDirections(plan: EpisodeManuscriptPlan | undefined,
  suggestion: EpisodePagePlanSuggestion): EpisodePagePlanSuggestion {
  if (plan === undefined || plan.directions.length === 0) return suggestion;
  return { ...suggestion, pages: suggestion.pages.map(page => ({ ...page, panels: page.panels.map(panel => {
    const text = [panel.situationText ?? '', ...panel.dialogue?.map(line => line.text) ?? []].join('\n');
    const directions = plan.directions.filter(direction => text.includes(direction.anchor)
      && (plan.blocks.length === 0 || plan.blocks.some(block => block.id === direction.blockId
        && block.slots.some(slot => slot.pageId === page.pageId && slot.order === panel.order))));
    if (directions.length === 0) return panel;
    const previous = panel.composition?.customNote ?? '';
    const note = [previous, ...directions.map(direction => `[作画指示] ${direction.instruction}`)
      .filter(line => !previous.includes(line))].filter(Boolean).join('\n');
    if (note.length > 1000) throw new ValidationError('このコマの作画指示が長すぎます。指示を短くしてください。');
    return { ...panel, composition: { ...panel.composition, customNote: note } };
  }) })) };
}
