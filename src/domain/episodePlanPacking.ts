import { EPISODE_BEAT_PLAN_TEXT_LIMITS } from './constants/storyAi.js';

export const EPISODE_PLAN_DETAIL_PACK_OUTPUT_UNITS = 27;
export const EPISODE_BEAT_PLAN_LEDGER_PACK_OUTPUT_CHARS = 4_200;
export const EPISODE_BEAT_PLAN_LEDGER_PACK_MAX_PAGES = 8;

export interface EpisodePlanPackablePage {
  frameCount: number;
}

/**
 * Packs consecutive pages by estimated structured-output weight. A page is
 * never split, even when it is larger than the target pack budget.
 */
export function packEpisodePlanPages<TPage extends EpisodePlanPackablePage>(
  pages: readonly TPage[],
  maxOutputUnits = EPISODE_PLAN_DETAIL_PACK_OUTPUT_UNITS,
): TPage[][] {
  if (!Number.isSafeInteger(maxOutputUnits) || maxOutputUnits <= 0) {
    throw new Error('maxOutputUnits must be a positive safe integer');
  }

  const packs: TPage[][] = [];
  let currentPack: TPage[] = [];
  let currentUnits = 0;

  for (const page of pages) {
    const pageUnits = estimateEpisodePlanPageOutputUnits(page);
    if (currentPack.length > 0 && currentUnits + pageUnits > maxOutputUnits) {
      packs.push(currentPack);
      currentPack = [];
      currentUnits = 0;
    }

    currentPack.push(page);
    currentUnits += pageUnits;
  }

  if (currentPack.length > 0) {
    packs.push(currentPack);
  }

  return packs;
}

export function estimateEpisodePlanPageOutputUnits(
  page: EpisodePlanPackablePage,
): number {
  const frameCount = Number.isSafeInteger(page.frameCount) && page.frameCount > 0
    ? page.frameCount
    : 1;
  return frameCount + 1;
}

/**
 * Keeps the global ledger inside a conservative visible-text budget. The
 * provider's reasoning budget is separate and handled by max_output_tokens;
 * this estimate only decides where page boundaries can safely be placed.
 */
export function estimateEpisodeBeatPlanLedgerOutputChars(
  page: EpisodePlanPackablePage,
): number {
  const frameCount = Number.isSafeInteger(page.frameCount) && page.frameCount > 0
    ? page.frameCount
    : 1;
  const limits = EPISODE_BEAT_PLAN_TEXT_LIMITS;
  return frameCount * limits.storyBeatChars +
    limits.entryExitChars * 2 +
    limits.newInformationChars * limits.maxNewInformationItems +
    limits.dialogueIntentChars +
    limits.handoffChars;
}

/**
 * Packs consecutive pages for the compact global ledger. Page boundaries are
 * immutable, so an oversized page remains a standalone pack.
 */
export function packEpisodeBeatPlanLedgerPages<TPage extends EpisodePlanPackablePage>(
  pages: readonly TPage[],
  maxOutputChars = EPISODE_BEAT_PLAN_LEDGER_PACK_OUTPUT_CHARS,
  maxPagesPerPack = EPISODE_BEAT_PLAN_LEDGER_PACK_MAX_PAGES,
): TPage[][] {
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0) {
    throw new Error('maxOutputChars must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxPagesPerPack) || maxPagesPerPack <= 0) {
    throw new Error('maxPagesPerPack must be a positive safe integer');
  }

  const packs: TPage[][] = [];
  let currentPack: TPage[] = [];
  let currentChars = 0;

  for (const page of pages) {
    const pageChars = estimateEpisodeBeatPlanLedgerOutputChars(page);
    if (
      currentPack.length > 0 &&
      (currentPack.length >= maxPagesPerPack || currentChars + pageChars > maxOutputChars)
    ) {
      packs.push(currentPack);
      currentPack = [];
      currentChars = 0;
    }

    currentPack.push(page);
    currentChars += pageChars;
  }

  if (currentPack.length > 0) {
    packs.push(currentPack);
  }

  return packs;
}
