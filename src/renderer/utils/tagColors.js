/**
 * Curated palette of ~40 pleasant tag colors spanning the spectrum. Used for
 * the color-swatch picker and for auto-assigning a color to a newly created tag.
 */
export const TAG_COLORS = [
  '#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab', '#1e88e5',
  '#039be5', '#00acc1', '#00897b', '#43a047', '#7cb342', '#c0ca33',
  '#fdd835', '#ffb300', '#fb8c00', '#f4511e', '#6d4c41', '#757575',
  '#ef5350', '#ec407a', '#ab47bc', '#7e57c2', '#5c6bc0', '#42a5f5',
  '#29b6f6', '#26c6da', '#26a69a', '#66bb6a', '#9ccc65', '#d4e157',
  '#ffee58', '#ffca28', '#ffa726', '#ff7043', '#8d6e63', '#bdbdbd',
  '#c62828', '#ad1457', '#6a1b9a', '#283593', '#00838f', '#2e7d32',
];

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
