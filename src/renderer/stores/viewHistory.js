import { createSignal, createMemo, createEffect, createRoot } from 'solid-js';
import { currentListId, setCurrentListId, clearSelection } from './navigation.js';
import { searchQuery, searchRootListId, runSearch, clearSearch } from './search.js';
import { isShowingSimilar, similarSeeds, showSimilarTo, clearSimilar } from './similar.js';
import {
  clusters,
  activeCluster,
  isShowingCluster,
  groupsOpen,
  openGroups,
  closeGroups,
  showCluster,
  clearCluster,
} from './clusters.js';
import { mapOpen, openMap, closeMap } from './musicMap.js';
import { facetsOpen, openFacets, closeFacets } from './facets.js';

/**
 * Back/forward through the screens the explorer has shown.
 *
 * Every screen is described by a small `view` object (what kind, plus whatever
 * identifies it), derived from the stores that own each screen. Whenever that
 * description changes, the new screen is recorded -- so every way of switching
 * screens, from the sidebar to a context menu, lands in history without having
 * to remember to.
 */
const MAX_ENTRIES = 20;

// Two views are the same screen when their keys match; a renamed group or an
// edited search refines the current entry instead of adding one.
function keyOf(view) {
  switch (view.kind) {
    case 'list': return `list:${view.listId}`;
    case 'search': return `search:${view.listId}`;
    case 'similar': return `similar:${view.seeds.map(seed => seed.songId).join(',')}`;
    case 'cluster': return `cluster:${view.cluster.id}`;
    default: return view.kind;
  }
}

const {
  listTitles,
  setListTitles,
  currentView,
  entries,
  setEntries,
  index,
  setIndex,
} = createRoot(() => {
  // Root list id -> title, published by the sidebar, so a history entry can be
  // named without a database round trip.
  const [listTitles, setListTitles] = createSignal(new Map());
  const [entries, setEntries] = createSignal([]);
  const [index, setIndex] = createSignal(-1);

  // Mirrors the precedence of the explorer's <Switch>: the first open screen wins.
  const currentView = createMemo(() => {
    if (mapOpen()) return { kind: 'map' };
    if (facetsOpen()) return { kind: 'facets' };
    if (isShowingSimilar()) return { kind: 'similar', seeds: similarSeeds() };
    if (isShowingCluster()) return { kind: 'cluster', cluster: activeCluster() };
    if (groupsOpen()) return { kind: 'groups' };
    if (searchQuery()) return { kind: 'search', listId: searchRootListId(), query: searchQuery() };
    return { kind: 'list', listId: currentListId() };
  });

  return { listTitles, setListTitles, currentView, entries, setEntries, index, setIndex };
});

// Opening a screen puts the previous one away in separate steps (clear the
// search, then set the list...), so the description passes through screens
// nobody asked for. Recording once per microtask sees only where it settled.
let flushQueued = false;
let restoring = false;

function flush() {
  flushQueued = false;
  const view = currentView();
  const list = entries();
  const current = list[index()];

  if (restoring || (current && keyOf(current) === keyOf(view))) {
    if (current) setEntries(list.map((entry, i) => (i === index() ? view : entry)));
    return;
  }

  const kept = [...list.slice(0, index() + 1), view].slice(-MAX_ENTRIES);
  setEntries(kept);
  setIndex(kept.length - 1);
}

createRoot(() => {
  createEffect(() => {
    currentView();
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(flush);
  });
});

/**
 * Show a root list (the Main Library or a playlist), putting away whatever else
 * the explorer was showing. Search results are scoped to one list, so the
 * search goes too.
 */
function openList(listId) {
  clearSearch();
  clearSimilar();
  clearCluster();
  closeGroups();
  closeMap();
  closeFacets();
  setCurrentListId(listId);
  clearSelection();
}

// Root list id -> { query, scrollTop } as the sidebar last switched away from it.
const leftLists = new Map();

function explorerContainer() {
  const container = document.querySelector('.explorer-container');
  if (!container) throw new Error('No explorer container on screen');
  return container;
}

// Rows load asynchronously (a tree's folders one by one), so wait, briefly, until
// there is enough content to scroll that far.
function restoreScroll(top, attemptsLeft = 60) {
  setTimeout(() => {
    const container = document.querySelector('.explorer-container');
    const fits = container && container.scrollHeight - container.clientHeight >= top;
    if (container && (fits || attemptsLeft === 0)) container.scrollTop = top;
    else if (attemptsLeft > 0) restoreScroll(top, attemptsLeft - 1);
  }, 16);
}

/**
 * A sidebar click on a root list. Switching lists remembers the one you leave
 * (its search and scroll) and brings back the one you return to, so you can
 * flip between a filtered list and a playlist. Clicking the list you're on
 * resets it.
 */
async function switchToList(listId) {
  const view = currentView();
  if (view.kind === 'list' || view.kind === 'search') {
    leftLists.set(view.listId, {
      query: view.kind === 'search' ? view.query : null,
      scrollTop: explorerContainer().scrollTop,
    });
  }
  const remembered = view.listId === listId ? undefined : leftLists.get(listId);
  openList(listId);
  if (!remembered) return;
  if (remembered.query) await runSearch(remembered.query);
  restoreScroll(remembered.scrollTop);
}

// An entry can outlive what it points at: a deleted playlist, a regrouped
// library.
function stillExists(view) {
  if (view.kind === 'list' || view.kind === 'search') return listTitles().has(view.listId);
  if (view.kind === 'cluster') return clusters().some(cluster => cluster.id === view.cluster.id);
  return true;
}

function restore(view) {
  switch (view.kind) {
    case 'list': return openList(view.listId);
    case 'search': openList(view.listId); return runSearch(view.query);
    case 'similar': return showSimilarTo(view.seeds);
    case 'cluster': return showCluster(view.cluster);
    case 'groups': return openGroups();
    case 'map': return openMap();
    case 'facets': return openFacets();
    default: throw new Error(`Unknown view kind: ${view.kind}`);
  }
}

function targetIndex(step) {
  const list = entries();
  for (let i = index() + step; i >= 0 && i < list.length; i += step) {
    if (stillExists(list[i])) return i;
  }
  return null;
}

function go(step) {
  const target = targetIndex(step);
  if (target === null) return;
  setIndex(target);
  restoring = true;
  restore(entries()[target]);
  // Queued after any flush the restore triggered, so that flush still sees it.
  queueMicrotask(() => { restoring = false; });
}

const goBack = () => go(-1);
const goForward = () => go(1);

function listTitle(listId) {
  const title = listTitles().get(listId);
  if (title === undefined) throw new Error(`No title known for list ${listId}`);
  return title;
}

/** What a history entry is called in the back/forward tooltips. */
function viewLabel(view) {
  switch (view.kind) {
    case 'list': return listTitle(view.listId);
    case 'search': return `Search "${view.query}" in ${listTitle(view.listId)}`;
    case 'similar':
      return view.seeds.length === 1
        ? `Songs like "${view.seeds[0].title}"`
        : `Songs like ${view.seeds.length} selected songs`;
    case 'cluster': return `Group "${view.cluster.name}"`;
    case 'groups': return 'Groups';
    case 'map': return 'Music Map';
    case 'facets': return 'Facets';
    default: throw new Error(`Unknown view kind: ${view.kind}`);
  }
}

const backTarget = () => {
  const i = targetIndex(-1);
  return i === null ? null : entries()[i];
};
const forwardTarget = () => {
  const i = targetIndex(1);
  return i === null ? null : entries()[i];
};

export {
  MAX_ENTRIES,
  listTitles,
  setListTitles,
  currentView,
  entries as historyEntries,
  openList,
  switchToList,
  goBack,
  goForward,
  backTarget,
  forwardTarget,
  viewLabel,
};
