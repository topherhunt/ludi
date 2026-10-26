import { createSignal, createRoot } from 'solid-js';
import * as api from '../utils/api.js';
import { randomAvailableColor } from '../utils/tagColors.js';

// Global tag state. `tags` is the app-wide list of defined tags (ordered by
// position); `libraryVersion` is a bump-counter that song-list views depend on,
// and is the single "the library changed, reload" signal: tag and metadata
// edits, playlist copies, imports, moves and deletes all bump it.
const SHOW_AI_TAGS_KEY = 'ludi-show-ai-tags';

const {
  tags,
  setTags,
  libraryVersion,
  setLibraryVersion,
  showAiTags,
  setShowAiTags,
} = createRoot(() => {
  const [tags, setTags] = createSignal([]);
  const [libraryVersion, setLibraryVersion] = createSignal(0);
  // Whether the sidebar and the edit panel include tags only the analyzer
  // applied. Song rows never do.
  const [showAiTags, setShowAiTags] = createSignal(localStorage.getItem(SHOW_AI_TAGS_KEY) === 'true');
  return { tags, setTags, libraryVersion, setLibraryVersion, showAiTags, setShowAiTags };
});

function toggleShowAiTags() {
  const next = !showAiTags();
  localStorage.setItem(SHOW_AI_TAGS_KEY, String(next));
  setShowAiTags(next);
}

/** You created the tag, or applied it to at least one song by hand. */
function isYourTag(tag) {
  return !tag.is_auto || tag.manual_count > 0;
}

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
  showAiTags,
  toggleShowAiTags,
  isYourTag,
  refreshTags,
  bumpLibraryVersion,
  findTagByName,
  createTagWithColor,
};
