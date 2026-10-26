import { For, createResource, createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { currentListId, clearSelection, MAIN_LIBRARY_ID } from '../stores/navigation.js';
import {
  getLists,
  renameTag,
  setTagColor,
  deleteTag,
  createPlaylist,
  deletePlaylist,
  reorderPlaylists,
  renameFolder,
  addSongsToList,
} from '../utils/api.js';
import {
  refreshTags,
  bumpLibraryVersion,
  libraryVersion,
  findTagByName,
  showAiTags,
  toggleShowAiTags,
} from '../stores/tags.js';
import { scopedTags, aiTagsInView, isTagFiltered } from '../stores/tagFacets.js';
import { savedSearches, renameSavedSearch, deleteSavedSearch } from '../stores/savedSearches.js';
import { groupsOpen, isShowingCluster, openGroups } from '../stores/clusters.js';
import { mapOpen, openMap } from '../stores/musicMap.js';
import { facetsOpen, openFacets } from '../stores/facets.js';
import { runSearch, isSearching, searchQuery, clearSearch } from '../stores/search.js';
import { switchToList, setListTitles } from '../stores/viewHistory.js';
import { addTagTerm, removeTagTerm } from '../utils/tagFilter.js';
import { showRenameModal, hideRenameModal, showConfirmModal, showAlert } from '../stores/modals.js';
import { copyIntoPlaylist } from '../stores/playlistCopy.js';
import { showImportSummary } from '../utils/importSummary.js';
import { TAG_COLORS } from '../utils/tagColors.js';
import { TagPill } from './TagPill.jsx';
import { SidebarPlaylistRow } from './SidebarPlaylistRow.jsx';
import { DropIndicator } from './DropIndicator.jsx';
import { SongEditPanel } from './SongEditPanel.jsx';
import { AnalysisProgress } from './AnalysisProgress.jsx';
import { FloatingMenu } from './FloatingMenu.jsx';

/**
 * Sidebar component with playlist list
 */
export function Sidebar(props) {
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);

  // Tag context menu + color-picker popover state
  const [tagMenu, setTagMenu] = createSignal(null);       // { x, y, tag } | null
  const [colorPicker, setColorPicker] = createSignal(null); // { x, y, tag } | null
  const [playlistMenu, setPlaylistMenu] = createSignal(null); // { x, y, list } | null
  const [savedSearchMenu, setSavedSearchMenu] = createSignal(null); // { x, y, saved } | null
  let playlistListRef;

  // Fetch lists from database. Keyed on the library version so a playlist made
  // somewhere else -- saving a group, for instance -- appears here too.
  const [lists, { refetch }] = createResource(
    () => ({ version: libraryVersion() }),
    getLists
  );

  createEffect(() => {
    const loaded = lists();
    if (loaded) setListTitles(new Map(loaded.map((list) => [list.id, list.title])));
  });

  // Refresh views after a tag definition changes (rename/recolor/delete/reorder).
  const refreshAfterTagChange = async () => {
    await refreshTags();
    bumpLibraryVersion();
  };

  // A tag is "active" when the current query filters for it -- whether it got
  // there by a chip click or by being typed into the search box.
  const isTagActive = (tag) => isTagFiltered(tag);

  // Animate a copy of the clicked chip flying up into the search input, so the
  // filter application is visually obvious (à la Safari's download fly).
  const flyTagToSearch = (tag, chipEl) => {
    const target = document.querySelector('.search-input');
    if (!chipEl || !target || typeof chipEl.animate !== 'function') return;
    const start = chipEl.getBoundingClientRect();
    const end = target.getBoundingClientRect();

    const clone = document.createElement('span');
    clone.className = 'tag-pill tag-fly';
    clone.textContent = tag.name;
    clone.style.setProperty('--tag-color', tag.color);
    clone.style.left = `${start.left}px`;
    clone.style.top = `${start.top}px`;
    document.body.appendChild(clone);

    const dx = (end.left + 10) - start.left;
    const dy = (end.top + end.height / 2 - start.height / 2) - start.top;
    const anim = clone.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0 },
      ],
      { duration: 480, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
    );
    anim.onfinish = () => clone.remove();
    anim.oncancel = () => clone.remove();
  };

  // Left-click a tag chip -> narrow by that tag, or widen again if it's already
  // a filter. Chips accumulate, so clicking "jazz" then "live" asks for both.
  const handleTagClick = (tag, e) => {
    const query = isSearching() ? searchQuery() : '';

    if (isTagActive(tag)) {
      const remaining = removeTagTerm(query, tag.name);
      if (remaining) runSearch(remaining);
      else clearSearch();
      return;
    }

    flyTagToSearch(tag, e?.currentTarget);
    runSearch(addTagTerm(query, tag.name));
  };

  const handleTagContextMenu = (e, tag) => {
    e.preventDefault();
    e.stopPropagation();
    setColorPicker(null);
    setTagMenu({ x: e.clientX, y: e.clientY, tag });
  };

  const handleRenameTag = (tag) => {
    setTagMenu(null);
    showRenameModal(tag.name, async (newName) => {
      const trimmed = (newName || '').trim();
      if (!trimmed || trimmed === tag.name) return;
      const existing = findTagByName(trimmed);
      if (existing && existing.id !== tag.id) {
        showAlert('Rename Tag', `A tag named "${trimmed}" already exists.`);
        return;
      }
      await renameTag(tag.id, trimmed);
      await refreshAfterTagChange();
    }, 'Rename Tag');
  };

  const handleChangeColor = (tag, x, y) => {
    setTagMenu(null);
    setColorPicker({ x, y, tag });
  };

  const handlePickColor = async (tag, color) => {
    setColorPicker(null);
    await setTagColor(tag.id, color);
    await refreshAfterTagChange();
  };

  const handleDeleteTag = (tag) => {
    setTagMenu(null);
    showConfirmModal(
      'Delete Tag',
      `Delete the tag "${tag.name}" and remove it from all songs?`,
      async () => {
        await deleteTag(tag.id);
        await refreshAfterTagChange();
      }
    );
  };

  // ---- Saved searches ----

  // A saved search is its query text, so clicking one does exactly what typing
  // that query would: it searches the list you're looking at. Same query, same
  // scoping rules as the tag chips it was probably built from.
  const handleSavedSearchClick = (saved) => {
    runSearch(saved.query);
  };

  const isSavedSearchActive = (saved) => isSearching() && searchQuery() === saved.query;

  const handleSavedSearchContextMenu = (e, saved) => {
    e.preventDefault();
    e.stopPropagation();
    setTagMenu(null);
    setColorPicker(null);
    setPlaylistMenu(null);
    setSavedSearchMenu({ x: e.clientX, y: e.clientY, saved });
  };

  const handleRenameSavedSearch = (saved) => {
    setSavedSearchMenu(null);
    showRenameModal(saved.name, async (newName) => {
      const trimmed = (newName || '').trim();
      if (!trimmed || trimmed === saved.name) return;
      await renameSavedSearch(saved.id, trimmed);
    }, 'Rename Saved Search');
  };

  const handleDeleteSavedSearch = (saved) => {
    setSavedSearchMenu(null);
    showConfirmModal(
      '<i class="bi bi-trash" style="margin-right: 8px;"></i>Delete Saved Search',
      `Delete the saved search "${saved.name}"? The songs it matched are untouched.`,
      async () => {
        await deleteSavedSearch(saved.id);
      }
    );
  };

  // ---- Analysis views ----

  const handleOpenMap = () => {
    clearSelection();
    openMap();
  };

  const handleOpenFacets = () => {
    clearSelection();
    openFacets();
  };

  const handleOpenGroups = () => {
    clearSelection();
    openGroups();
  };

  // ---- Playlists ----

  const handlePlaylistClick = (list) => {
    switchToList(list.id);
    props.onListChange?.(list.id);
  };

  const handleNewPlaylist = () => {
    closeDropdown();
    showRenameModal('New Playlist', async (title) => {
      const trimmed = (title || '').trim();
      hideRenameModal();
      if (!trimmed) return;
      const playlist = await createPlaylist(trimmed);
      await refetch();
      handlePlaylistClick(playlist);
    }, 'New Playlist');
  };

  // Play a whole playlist from the top. Shared by the double-click and the
  // "Play This Playlist" context-menu item so both behave identically.
  const handlePlayPlaylist = (list) => {
    props.onPlayFolder?.(list.id);
  };

  const handlePlaylistContextMenu = (e, list) => {
    e.preventDefault();
    e.stopPropagation();
    setTagMenu(null);
    setColorPicker(null);
    setPlaylistMenu({ x: e.clientX, y: e.clientY, list });
  };

  const handleRenamePlaylist = (list) => {
    setPlaylistMenu(null);
    showRenameModal(list.title, async (newName) => {
      const trimmed = (newName || '').trim();
      hideRenameModal();
      if (!trimmed || trimmed === list.title) return;
      // A playlist rename is the same UPDATE as a folder rename.
      await renameFolder(list.id, trimmed);
      await refetch();
      if (currentListId() === list.id) props.onListChange?.(list.id);
    }, 'Rename Playlist');
  };

  const handleDeletePlaylist = (list) => {
    setPlaylistMenu(null);
    showConfirmModal(
      '<i class="bi bi-trash" style="margin-right: 8px;"></i>Delete Playlist',
      `Delete the playlist "${list.title}"? The songs themselves stay in your library.`,
      async () => {
        await deletePlaylist(list.id);
        await refetch();
        if (currentListId() === list.id) {
          handlePlaylistClick({ id: MAIN_LIBRARY_ID });
        }
      }
    );
  };

  // Reorder: pull the dragged playlist out of the sidebar order and put it back
  // next to the target. The Main Library is pinned first and never takes part.
  const handleReorderPlaylists = async (draggedListId, targetListId, insertBefore) => {
    if (draggedListId === undefined || draggedListId === targetListId) return;
    const ids = (lists() || [])
      .filter((l) => l.id !== MAIN_LIBRARY_ID)
      .map((l) => l.id);

    const from = ids.indexOf(draggedListId);
    if (from === -1) return;
    ids.splice(from, 1);

    const targetIndex = ids.indexOf(targetListId);
    if (targetIndex === -1) return;
    ids.splice(insertBefore ? targetIndex : targetIndex + 1, 0, draggedListId);

    await reorderPlaylists(ids);
    await refetch();
  };

  // Songs / folders dragged in from the tree are copied, never moved.
  const handleCopyItemsToPlaylist = async (list, itemIds) => {
    if (itemIds.length === 0) return;
    const added = await copyIntoPlaylist(itemIds, list.id, list.title);
    if (added > 0) bumpLibraryVersion();
  };

  // OS files dropped on a playlist import into the Main Library (every song must
  // live there) and are then copied in via the same path an in-app drag takes.
  const handleDropFilesOnPlaylist = async (list, paths) => {
    const result = await addSongsToList(list.id, paths);
    if (result.targetIsPlaylist && result.itemIds.length > 0) {
      await copyIntoPlaylist(result.itemIds, list.id, list.title);
    }
    bumpLibraryVersion();
    showImportSummary(result);
  };

  // Toggle add dropdown
  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen());
  };

  // Close dropdown when clicking elsewhere
  const closeDropdown = () => {
    setIsDropdownOpen(false);
  };

  // Close the New Folder dropdown on Escape or a click outside it. Listeners are
  // always attached and no-op unless the dropdown is open. The open-click on the
  // "+" button is excluded so it doesn't immediately close what it just opened.
  onMount(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && isDropdownOpen()) closeDropdown();
      if (e.key === 'Escape') {
        setTagMenu(null); setColorPicker(null); setPlaylistMenu(null);
        setSavedSearchMenu(null);
      }
    };
    const onDocClick = (e) => {
      if (
        isDropdownOpen() &&
        !e.target.closest('#addLibraryDropdown') &&
        !e.target.closest('#addLibraryBtn')
      ) {
        closeDropdown();
      }
      const inMenu = e.target.closest('.tag-context-menu');
      const inPopover = e.target.closest('.tag-color-popover');
      if (playlistMenu() && !e.target.closest('.playlist-context-menu')) setPlaylistMenu(null);
      if (savedSearchMenu() && !e.target.closest('.saved-search-context-menu')) setSavedSearchMenu(null);
      if (tagMenu() && !inMenu) setTagMenu(null);
      // Don't close the color popover on the very menu click that opened it.
      if (colorPicker() && !inPopover && !inMenu) setColorPicker(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onDocClick);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDocClick);
    });
  });

  // Handle new folder
  const handleNewFolder = () => {
    closeDropdown();
    props.onNewFolder?.();
  };

  // Handle click on empty space in sidebar to clear selection. Never clear when
  // interacting with the edit panel (it edits the current selection) or the tag
  // menus/popovers.
  const handleSidebarClick = (e) => {
    if (
      !e.target.closest('.playlist-item') &&
      !e.target.closest('.sidebar-header') &&
      !e.target.closest('.song-edit-panel') &&
      !e.target.closest('.tags-section') &&
      !e.target.closest('.saved-searches-section') &&
      !e.target.closest('.saved-search-context-menu') &&
      !e.target.closest('.clusters-section') &&
      !e.target.closest('.tag-context-menu') &&
      !e.target.closest('.tag-color-popover') &&
      !e.target.closest('.playlist-context-menu')
    ) {
      clearSelection();
    }
  };

  return (
    <aside class="sidebar" onClick={handleSidebarClick}>
      <div class="sidebar-header">
        <h2>Library</h2>
        <div class="sidebar-actions">
          <button
            id="addLibraryBtn"
            class="add-btn"
            data-tooltip="Add"
            onClick={toggleDropdown}
          >
            +
          </button>
          <button
            class="add-btn qa-collapse-all"
            data-tooltip="Collapse All"
            onClick={() => props.onCollapseAll?.()}
          >
            <i class="bi bi-arrows-collapse"></i>
          </button>
          <button
            class="add-btn qa-expand-all"
            data-tooltip="Expand All"
            onClick={() => props.onExpandAll?.()}
          >
            <i class="bi bi-arrows-expand"></i>
          </button>
        </div>
        <Show when={isDropdownOpen()}>
          <div id="addLibraryDropdown" class="dropdown-menu visible">
            <div
              class="dropdown-item"
              id="newPlaylistMenuItem"
              onClick={handleNewPlaylist}
            >
              New Playlist
            </div>
            <div
              class="dropdown-item"
              id="newFolderMenuItem"
              onClick={handleNewFolder}
            >
              New Folder
            </div>
          </div>
        </Show>
      </div>

      {/* Everything you browse with scrolls as one region, so a long tag list
          costs scrolling rather than costing the playlist tree its height. The
          song edit panel and the analysis strip sit outside it and stay put. */}
      <div class="sidebar-scroll qa-sidebar-scroll">
        <div class="playlist-list" id="playlistList" ref={playlistListRef}>
          <For each={lists() || []}>
            {(list) => (
              <SidebarPlaylistRow
                list={list}
                depth={0}
                getListContainer={() => playlistListRef}
                onSelect={handlePlaylistClick}
                onPlay={handlePlayPlaylist}
                onContextMenu={handlePlaylistContextMenu}
                onReorder={handleReorderPlaylists}
                onCopyItems={handleCopyItemsToPlaylist}
                onDropFiles={handleDropFilesOnPlaylist}
              />
            )}
          </For>
          <DropIndicator scope="sidebar" />
        </div>

        {/* The views built from the audio analysis. Always shown, so the buttons
            that build them are somewhere you can find before there is anything
            to show. */}
        <div class="clusters-section qa-clusters-section">
          <div
            class="saved-search-item qa-open-map"
            classList={{ active: mapOpen() }}
            onClick={handleOpenMap}
          >
            <i class="bi bi-map saved-search-icon" />
            <span class="saved-search-name">Music Map</span>
          </div>

          <div
            class="saved-search-item qa-open-facets"
            classList={{ active: facetsOpen() }}
            onClick={handleOpenFacets}
          >
            <i class="bi bi-signpost-split saved-search-icon" />
            <span class="saved-search-name">Facets</span>
          </div>

          <div
            class="saved-search-item qa-open-groups"
            classList={{ active: groupsOpen() || isShowingCluster() }}
            onClick={handleOpenGroups}
          >
            <i class="bi bi-diagram-2 saved-search-icon" />
            <span class="saved-search-name">Groups</span>
          </div>
        </div>

        <Show when={savedSearches().length > 0}>
          <div class="saved-searches-section qa-saved-searches">
            <div class="tags-heading">Saved Searches</div>
            <For each={savedSearches()}>
              {(saved) => (
                <div
                  class="saved-search-item qa-saved-search"
                  classList={{ active: isSavedSearchActive(saved) }}
                  data-saved-search-id={saved.id}
                  title={saved.query}
                  onClick={() => handleSavedSearchClick(saved)}
                  onContextMenu={(e) => handleSavedSearchContextMenu(e, saved)}
                >
                  <i class="bi bi-search saved-search-icon" />
                  <span class="saved-search-name">{saved.name}</span>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Kept when every tag here is the analyzer's, so the link to show them stays. */}
        <Show when={scopedTags().length > 0 || aiTagsInView()}>
          <div class="tags-section qa-tags-section">
            <div class="tags-heading">Tags</div>
            <div class="tags-list">
              <For each={scopedTags()}>
                {(tag) => (
                  <TagPill
                    tag={tag}
                    count={tag.count}
                    active={isTagActive(tag)}
                    onClick={(e) => handleTagClick(tag, e)}
                    onContextMenu={(e) => handleTagContextMenu(e, tag)}
                  />
                )}
              </For>
            </div>
            <Show when={aiTagsInView()}>
              <span class="text-link qa-toggle-ai-tags" onClick={toggleShowAiTags}>
                {showAiTags() ? 'Hide AI tags' : 'Show AI tags'}
              </span>
            </Show>
          </div>
        </Show>
      </div>

      <SongEditPanel />

      <AnalysisProgress />

      {/* Playlist right-click context menu. The Main Library can only be played. */}
      <Show when={playlistMenu()}>
        <FloatingMenu class="context-menu playlist-context-menu" x={playlistMenu().x} y={playlistMenu().y}>
          <div
            class="context-menu-item qa-playlist-play"
            onClick={() => {
              const list = playlistMenu().list;
              setPlaylistMenu(null);
              handlePlayPlaylist(list);
            }}
          >
            <i class="bi bi-play-fill context-menu-icon"></i>Play
          </div>
          <Show when={playlistMenu().list.id !== MAIN_LIBRARY_ID}>
            <div class="context-menu-item qa-playlist-rename" onClick={() => handleRenamePlaylist(playlistMenu().list)}>
              <i class="bi bi-pencil context-menu-icon"></i>Rename
            </div>
            <div class="context-menu-item qa-playlist-delete" onClick={() => handleDeletePlaylist(playlistMenu().list)}>
              <i class="bi bi-trash context-menu-icon"></i>Delete
            </div>
          </Show>
        </FloatingMenu>
      </Show>

      {/* Saved search right-click context menu */}
      <Show when={savedSearchMenu()}>
        <FloatingMenu class="context-menu saved-search-context-menu" x={savedSearchMenu().x} y={savedSearchMenu().y}>
          <div class="context-menu-item qa-saved-search-rename" onClick={() => handleRenameSavedSearch(savedSearchMenu().saved)}>
            <i class="bi bi-pencil context-menu-icon"></i>Rename
          </div>
          <div class="context-menu-item qa-saved-search-delete" onClick={() => handleDeleteSavedSearch(savedSearchMenu().saved)}>
            <i class="bi bi-trash context-menu-icon"></i>Delete
          </div>
        </FloatingMenu>
      </Show>

      {/* Tag right-click context menu */}
      <Show when={tagMenu()}>
        <FloatingMenu class="context-menu tag-context-menu" x={tagMenu().x} y={tagMenu().y}>
          <div class="context-menu-item qa-tag-rename" onClick={() => handleRenameTag(tagMenu().tag)}>
            Rename
          </div>
          <div
            class="context-menu-item qa-tag-change-color"
            onClick={(e) => handleChangeColor(tagMenu().tag, tagMenu().x, tagMenu().y)}
          >
            Change Color
          </div>
          <div class="context-menu-item qa-tag-delete" onClick={() => handleDeleteTag(tagMenu().tag)}>
            Delete Tag
          </div>
        </FloatingMenu>
      </Show>

      {/* Color-swatch popover */}
      <Show when={colorPicker()}>
        <FloatingMenu class="tag-color-popover" x={colorPicker().x} y={colorPicker().y}>
          <div class="tag-color-popover-title qa-tag-color-title">Pick tag color</div>
          <div class="tag-color-grid">
            <For each={TAG_COLORS}>
              {(color) => (
                <span
                  class="tag-color-swatch qa-tag-color-swatch"
                  style={{ 'background-color': color }}
                  onClick={() => handlePickColor(colorPicker().tag, color)}
                />
              )}
            </For>
          </div>
        </FloatingMenu>
      </Show>
    </aside>
  );
}
