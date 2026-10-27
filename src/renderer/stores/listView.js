import { createSignal, createRoot } from 'solid-js';
import { GROUP_MODES, SORT_FIELDS } from '../utils/arrangeRows.js';
import { MAIN_LIBRARY_ID } from './navigation.js';

/**
 * How each song list is grouped and sorted, remembered per list across screens
 * and restarts. View keys: `list:<id>` for the Main Library and each playlist
 * (search results use the key of the list searched), `similar` and `cluster`.
 *
 * Which groups are collapsed is per session only.
 */

const STORAGE_KEY = 'ludi-list-view-settings';

function defaultSettings(viewKey) {
  if (viewKey === `list:${MAIN_LIBRARY_ID}`) {
    return { groupBy: 'album', sort: [{ field: 'album', dir: 'asc' }] };
  }
  return { groupBy: 'none', sort: [{ field: 'natural', dir: 'asc' }] };
}

/** What "natural" order means in each kind of view. */
export function naturalSortLabel(viewKey) {
  if (viewKey === `list:${MAIN_LIBRARY_ID}`) return 'Library order';
  if (viewKey.startsWith('list:')) return 'Playlist order';
  if (viewKey === 'similar') return 'Best match';
  return 'Default order';
}

function loadFromStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : {};
}

const { allSettings, setAllSettings, collapse, setCollapse } = createRoot(() => {
  const [allSettings, setAllSettings] = createSignal(loadFromStorage());
  // viewKey -> { collapsedByDefault, toggled: Set<groupKey> }
  const [collapse, setCollapse] = createSignal({});
  return { allSettings, setAllSettings, collapse, setCollapse };
});

export function viewSettings(viewKey) {
  return allSettings()[viewKey] || defaultSettings(viewKey);
}

function updateSettings(viewKey, change) {
  const next = { ...allSettings(), [viewKey]: { ...viewSettings(viewKey), ...change } };
  setAllSettings(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function setGroupBy(viewKey, groupBy) {
  if (!GROUP_MODES[groupBy]) throw new Error(`Unknown group mode: ${groupBy}`);
  updateSettings(viewKey, { groupBy });
}

/** Sort by just this field, in its usual direction. */
export function replaceSort(viewKey, field) {
  updateSettings(viewKey, { sort: [{ field, dir: SORT_FIELDS[field].defaultDir }] });
}

/** Add a field after the current ones; ties on those fall through to it. */
export function addSort(viewKey, field) {
  const sort = viewSettings(viewKey).sort;
  if (sort.some((s) => s.field === field)) return;
  updateSettings(viewKey, { sort: [...sort, { field, dir: SORT_FIELDS[field].defaultDir }] });
}

export function toggleSortDir(viewKey, field) {
  updateSettings(viewKey, {
    sort: viewSettings(viewKey).sort.map((s) =>
      s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s),
  });
}

export function removeSort(viewKey, field) {
  const sort = viewSettings(viewKey).sort.filter((s) => s.field !== field);
  if (sort.length === 0) throw new Error('Cannot remove the only sort field');
  updateSettings(viewKey, { sort });
}

/** Rows can be dragged into a new order only when they show that order. */
export function isReorderable(viewKey) {
  const { groupBy, sort } = viewSettings(viewKey);
  return viewKey.startsWith('list:') && groupBy === 'none' &&
    sort.length === 1 && sort[0].field === 'natural' && sort[0].dir === 'asc';
}

// ---- Collapsed groups ------------------------------------------------------

// Library and playlist groups start collapsed (a whole library expanded is
// thousands of rows); results views start expanded, since you asked to see them.
function collapseState(collapseKey) {
  return collapse()[collapseKey] || { collapsedByDefault: collapseKey.startsWith('list:'), toggled: new Set() };
}

export function isGroupCollapsed(collapseKey, groupKey) {
  const state = collapseState(collapseKey);
  return state.collapsedByDefault !== state.toggled.has(groupKey);
}

export function toggleGroupCollapsed(collapseKey, groupKey) {
  const state = collapseState(collapseKey);
  const toggled = new Set(state.toggled);
  if (toggled.has(groupKey)) toggled.delete(groupKey);
  else toggled.add(groupKey);
  setCollapse({ ...collapse(), [collapseKey]: { ...state, toggled } });
}

export function setAllGroupsCollapsed(collapseKey, collapsed) {
  setCollapse({ ...collapse(), [collapseKey]: { collapsedByDefault: collapsed, toggled: new Set() } });
}

/** A new search starts with every group open. */
export function resetSearchCollapse() {
  const { search, ...rest } = collapse();
  setCollapse(rest);
}

// Tests share one app per worker across specs; each test starts from these
// settings (and no collapse state) instead of whatever the last spec left.
if (typeof window !== 'undefined') {
  window.__ludiResetListViews = (settings) => {
    setAllSettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setCollapse({});
  };
}
