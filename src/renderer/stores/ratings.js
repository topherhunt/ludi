import * as api from '../utils/api.js';
import { bumpLibraryVersion } from './tags.js';
import { selectedItems } from './navigation.js';

export const MAX_RATING = 5;

/**
 * Clicking the star you are already on clears the rating.
 *
 * A rating is a judgement, and "I take that back" needs to be as cheap as
 * making it in the first place -- otherwise the only way out of a stray click
 * is to pick a rating you don't mean.
 */
export function toggleRating(currentRating, clickedStar) {
  return currentRating === clickedStar ? null : clickedStar;
}

/**
 * Resolve selected placement ids to the distinct song ids behind them.
 *
 * Goes to the database rather than reading `data-song-id` off the rendered
 * rows: a selected song inside a collapsed folder is not in the DOM, and it
 * should still get rated. Mirrors how Explorer seeds a similarity search.
 */
async function songIdsForItems(itemIds) {
  const songIds = new Set();
  for (const id of itemIds) {
    const row = await api.getItem(id);
    if (row && row.song_id !== null) songIds.add(row.song_id);
  }
  return Array.from(songIds);
}

/**
 * Write a rating to songs and refresh every view showing them.
 * @param {number[]} songIds
 * @param {number|null} rating - 1-5, or null to clear
 */
export async function rateSongs(songIds, rating) {
  if (songIds.length === 0) return;
  await api.setSongRating(songIds, rating);
  bumpLibraryVersion();
}

/**
 * Which rows a rating gesture on `itemId` should act on.
 *
 * The same rule the rest of the app's row actions follow: acting inside a
 * multi-selection acts on the whole selection, acting outside it acts on the
 * one row you touched.
 */
function targetItemIds(itemId) {
  const selected = selectedItems();
  return selected.has(itemId) && selected.size > 1 ? Array.from(selected) : [itemId];
}

/**
 * Rate from a gesture aimed at one row -- a star click, or a context-menu pick.
 * Widens to the whole selection when the row is part of a multi-selection.
 */
export async function rateFromRow(itemId, rating) {
  const songIds = await songIdsForItems(targetItemIds(itemId));
  await rateSongs(songIds, rating);
}

/**
 * Rate every selected song outright (the 1-5 and 0 hotkeys, and the context
 * menu). No toggling here: these callers name the rating they want, and `null`
 * is reachable directly, so there is nothing to undo ambiguously.
 */
export async function rateSelection(rating) {
  const songIds = await songIdsForItems(Array.from(selectedItems()));
  await rateSongs(songIds, rating);
}
