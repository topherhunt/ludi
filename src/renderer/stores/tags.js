import { createSignal, createRoot } from 'solid-js';
import * as api from '../utils/api.js';
import { randomAvailableColor } from '../utils/tagColors.js';

// Global tag state. `tags` is the app-wide list of defined tags (ordered by
// position); `libraryVersion` is a bump-counter that song-list resources depend
// on so tag/metadata mutations trigger a refresh.
const {
  tags,
  setTags,
  libraryVersion,
  setLibraryVersion,
} = createRoot(() => {
  const [tags, setTags] = createSignal([]);
  const [libraryVersion, setLibraryVersion] = createSignal(0);
  return { tags, setTags, libraryVersion, setLibraryVersion };
});

/** Reload the tag list from the database. */
async function refreshTags() {
  setTags(await api.getAllTags());
}

/** Bump the library version so dependent song-list resources refetch. */
function bumpLibraryVersion() {
  setLibraryVersion(v => v + 1);
}

/** Find a defined tag by name (case-insensitive), or undefined. */
function findTagByName(name) {
  const lower = (name || '').toLowerCase();
  return tags().find(t => t.name.toLowerCase() === lower);
}

/**
 * Create a new tag with an auto-assigned random (unused) color, then refresh the
 * tag list. Returns the created tag.
 */
async function createTagWithColor(name) {
  const color = randomAvailableColor(tags().map(t => t.color));
  const tag = await api.createTag(name, color);
  await refreshTags();
  return tag;
}

export {
  tags,
  libraryVersion,
  refreshTags,
  bumpLibraryVersion,
  findTagByName,
  createTagWithColor,
};
