// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.
/** New episodes and increases stop at this count; saved longer episodes remain readable. */
export const MAX_NEW_EPISODE_PAGES = 20;

/** Keep unchanged legacy values editable without silently clamping saved stories. */
export function editableEpisodePageLimit(savedPageCount?: number | null): number {
  return typeof savedPageCount === 'number'
    && Number.isSafeInteger(savedPageCount)
    && savedPageCount > MAX_NEW_EPISODE_PAGES
    ? savedPageCount
    : MAX_NEW_EPISODE_PAGES;
}
