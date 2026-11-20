import type { StoryManuscript, StoryManuscriptBlock } from '../../../packages/api-contract/src/storyManuscript.js';
import { PANEL_FRAME_TEMPLATES, resolveDefaultPanelFrameTemplateId } from '../../domain/constants/panelFrameTemplates.js';
import { inferEntityIdsFromTexts } from '../../domain/entityAliases.js';
import { ValidationError } from '../../domain/errors/index.js';
import type { PageSkeletonPageDraft, PageSkeletonPanelDraft } from '../../domain/types/storyAi.js';

export interface ManuscriptPageGroup {
  pageNumber: number;
  pageCount: number;
  blocks: StoryManuscriptBlock[];
  fixedPage: boolean;
}

export interface ManuscriptBlockCompilation {
  block: StoryManuscriptBlock;
  pageCount: number;
  minimumPanels: number;
  maximumPanels: number;
}

export interface CompiledManuscriptBlock {
  panels: PageSkeletonPanelDraft[];
  layouts: Array<{ start: number; count: number; template: PageSkeletonPageDraft['suggestedLayout'] }>;
}

/** Allocate only within authored page boundaries. A bounded panel is an atomic
 * source unit; unbounded prose can expand into multiple panels and pages.
 * Keep source-to-slot metadata so later detail/audit passes can enforce the same
 * contract without inferring ownership from generated prose. */
export function resolveManuscriptPageGroups(
  manuscript: StoryManuscript,
  estimatedPages: number,
): ManuscriptPageGroup[] {
  if (manuscript.pages.length === 0) throw new ValidationError('原稿本文を入力してください。');
  const minimum = manuscript.pages.map(page => Math.max(1, Math.ceil(page.blocks.length / 8)));
  if (manuscript.pages.some((page, index) => page.fixedPage && minimum[index] !== 1)) {
    throw new ValidationError('指定した1ページのコマ数は8コマ以内にしてください。');
  }
  const maximum = manuscript.pages.map(page => page.fixedPage ? 1 :
    page.blocks.every(block => block.fixedPanel) ? page.blocks.length : 32);
  const total = Math.min(sum(maximum), Math.max(sum(minimum), manuscript.explicitPageCount ?? estimatedPages));
  const counts = allocate(minimum, maximum,
    manuscript.pages.map(page => sum(page.blocks.map(block => block.text.length))), total);
  let pageNumber = 1;
  return manuscript.pages.map((page, index) => {
    const pageCount = counts[index] ?? 1;
    const group = { pageNumber, pageCount, blocks: page.blocks, fixedPage: page.fixedPage };
    pageNumber += pageCount;
    return group;
  });
}

export async function buildStoryManuscriptSkeleton(input: {
  source: string;
  manuscript: StoryManuscript;
  estimatedPages: number;
  entities: readonly { id: string; name: string; aliases: string[] }[];
  compileBlock: (input: ManuscriptBlockCompilation) => Promise<PageSkeletonPanelDraft[] | CompiledManuscriptBlock>;
}): Promise<PageSkeletonPageDraft[]> {
  const pages: PageSkeletonPageDraft[] = [];
  for (const group of resolveManuscriptPageGroups(input.manuscript, input.estimatedPages)) {
    const weights = group.blocks.map(block => block.text.length);
    const lower = group.blocks.map(() => 1);
    const upper = group.blocks.map(block => block.fixedPanel ? 1 : group.pageCount * 8);
    const minimum = allocate(lower, upper, weights, Math.max(group.blocks.length, group.pageCount));
    const maximum = allocate(minimum, upper, weights, Math.min(sum(upper), group.pageCount * 8));
    const preferred = allocate(minimum, maximum, weights,
      Math.min(sum(maximum), Math.max(sum(minimum), group.pageCount * 4)));
    const slots: { blockId: string; panel: PageSkeletonPanelDraft }[] = [];
    const layouts = new Map<number, CompiledManuscriptBlock['layouts'][number]>();
    for (const [index, block] of group.blocks.entries()) {
      let panels: PageSkeletonPanelDraft[];
      if (block.fixedPanel) {
        if (block.text.length > 2000) throw new ValidationError('1コマに指定した本文は2000文字以内にしてください。');
        panels = [{ order: 1, panelRole: 'action', suggestedSize: 'standard', situationHint: block.text,
          suggestedEntities: inferEntityIdsFromTexts([...input.entities], [block.text], 8), suggestedDialogueHint: null }];
      } else {
        const pageCount = Math.min(group.pageCount, maximum[index] ?? 1,
          Math.max(1, Math.ceil((preferred[index] ?? 1) / 4)));
        const minimumPanels = minimum[index] ?? 1;
        const maximumPanels = Math.min(maximum[index] ?? 8, pageCount * 8);
        const compiled = await input.compileBlock({ block, pageCount, minimumPanels, maximumPanels });
        panels = Array.isArray(compiled) ? compiled : compiled.panels;
        if (!Array.isArray(compiled)) {
          for (const layout of compiled.layouts) layouts.set(slots.length + layout.start, layout);
        }
        if (panels.length < minimumPanels || panels.length > maximumPanels) {
          throw new ValidationError('自動コマ割りが手動区切り内のコマ数上限を満たしていません。再実行してください。');
        }
      }
      slots.push(...panels.map(panel => ({ blockId: block.id, panel })));
    }
    const compiledPageCounts: number[] = [];
    let layoutCursor = 0;
    while (layoutCursor < slots.length) {
      const layout = layouts.get(layoutCursor);
      if (layout === undefined || layout.count < 1 || layout.count > 8
        || PANEL_FRAME_TEMPLATES[layout.template]?.panelCount !== layout.count) break;
      compiledPageCounts.push(layout.count);
      layoutCursor += layout.count;
    }
    const keepCompiledPages = layoutCursor === slots.length && compiledPageCounts.length === group.pageCount;
    let cursor = 0;
    for (let pageIndex = 0; pageIndex < group.pageCount; pageIndex += 1) {
      const count = keepCompiledPages ? compiledPageCounts[pageIndex]!
        : Math.ceil((slots.length - cursor) / (group.pageCount - pageIndex));
      const selected = slots.slice(cursor, cursor + count);
      const preferredLayout = layouts.get(cursor);
      cursor += count;
      const suggestedLayout = preferredLayout?.count === count
        && PANEL_FRAME_TEMPLATES[preferredLayout.template]?.panelCount === count
        ? preferredLayout.template : resolveDefaultPanelFrameTemplateId(count);
      if (suggestedLayout === null || count < 1 || count > 8) {
        throw new ValidationError('手動区切りを守って1ページに配置できるのは1〜8コマです。');
      }
      pages.push({
        pageNumber: group.pageNumber + pageIndex,
        purpose: selected[0]?.panel.situationHint.slice(0, 300) ?? '',
        suggestedPanelCount: count, suggestedLayout,
        panels: selected.map(({ panel }, index) => ({ ...panel, order: index + 1 })),
        manuscriptSource: { version: 1, source: input.source,
          panels: selected.map(({ blockId }, index) => ({ order: index + 1, blockId })) },
      });
    }
  }
  return pages;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function allocate(minimum: readonly number[], maximum: readonly number[], weights: readonly number[], total: number): number[] {
  const values = [...minimum];
  while (sum(values) < total) {
    let selected = -1;
    let score = -1;
    for (let index = 0; index < values.length; index += 1) {
      if ((values[index] ?? 0) >= (maximum[index] ?? 0)) continue;
      const candidate = (weights[index] ?? 1) / ((values[index] ?? 0) + 1);
      if (candidate > score) { selected = index; score = candidate; }
    }
    if (selected < 0) break;
    values[selected] = (values[selected] ?? 0) + 1;
  }
  return values;
}
