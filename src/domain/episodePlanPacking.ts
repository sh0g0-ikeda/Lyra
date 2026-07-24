export const EPISODE_PLAN_DETAIL_PACK_OUTPUT_UNITS = 27;

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
