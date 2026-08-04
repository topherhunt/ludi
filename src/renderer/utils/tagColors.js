import PALETTE from '../../shared/tag-colors.json';

/**
 * Curated palette of ~40 pleasant tag colors spanning the spectrum. Used for
 * the color-swatch picker and for auto-assigning a color to a newly created tag.
 * Shared with the main process, which colors the tags the analyzer creates.
 */
export const TAG_COLORS = PALETTE;

/**
 * Pick a random color that isn't already used by an existing tag. Falls back to
 * any random palette color if every color is already taken.
 * @param {string[]} usedColors - colors currently assigned to tags
 * @returns {string}
 */
export function randomAvailableColor(usedColors = []) {
  const used = new Set(usedColors);
  const available = TAG_COLORS.filter(c => !used.has(c));
  const pool = available.length > 0 ? available : TAG_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}
