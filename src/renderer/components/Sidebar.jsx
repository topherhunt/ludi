import { For, createResource, createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import { currentListId, setCurrentListId, clearSelection, MAIN_LIBRARY_ID } from '../stores/navigation.js';
import {
  getLists,
  renameTag,
  setTagColor,
  deleteTag,
  reorderTags,
  createPlaylist,
  deletePlaylist,
  reorderPlaylists,
  renameFolder,
  addSongsToList,
} from '../utils/api.js';
import { tags, refreshTags, bumpLibraryVersion, findTagByName } from '../stores/tags.js';
import { runSearch, isSearching, searchQuery, clearSearch } from '../stores/search.js';
import { showRenameModal, hideRenameModal, showConfirmModal, showAlert } from '../stores/modals.js';
import { copyIntoPlaylist } from '../stores/playlistCopy.js';
import { showImportSummary } from '../utils/importSummary.js';
import { TAG_COLORS } from '../utils/tagColors.js';
import { TagPill } from './TagPill.jsx';
import { SidebarPlaylistRow } from './SidebarPlaylistRow.jsx';
import { DropIndicator } from './DropIndicator.jsx';
import { SongEditPanel } from './SongEditPanel.jsx';

/**
 * Sidebar component with playlist list
 */
export function Sidebar(props) {
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);

  // Tag context menu + color-picker popover state
  const [tagMenu, setTagMenu] = createSignal(null);       // { x, y, tag } | null
  const [colorPicker, setColorPicker] = createSignal(null); // { x, y, tag } | null
  const [playlistMenu, setPlaylistMenu] = createSignal(null); // { x, y, list } | null
  let draggingTagId = null;
  let playlistListRef;
  let colorPopoverRef;

  // Fetch lists from database
  const [lists, { refetch }] = createResource(getLists);

  // Refresh views after a tag definition changes (rename/recolor/delete/reorder).
  const refreshAfterTagChange = async () => {
    await refreshTags();
    bumpLibraryVersion();
    if (isSearching()) runSearch(searchQuery());
  };

  // The exact query string a tag chip searches for.
  const tagQuery = (tag) => {
    const quoted = tag.name.includes(' ') ? `"${tag.name}"` : tag.name;
    return `tag=${quoted}`;
  };

  // A tag is "active" when it is the sole applied filter.
  const isTagActive = (tag) => isSearching() && searchQuery().trim() === tagQuery(tag);

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

  // Left-click a tag chip -> replace the current view with a search for that tag.
  const handleTagClick = (tag, e) => {
    flyTagToSearch(tag, e?.currentTarget);
    runSearch(tagQuery(tag));
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

  // The popover opens at the cursor, so right-clicking a tag low in the window
  // would push it past the bottom edge -- and nothing scrolls to bring it back.
  // Measure it once it's in the DOM and pull it back inside the viewport.
  const VIEWPORT_MARGIN = 8;
  createEffect(() => {
    const picker = colorPicker();
    if (!picker || !colorPopoverRef) return;
    const { width, height } = colorPopoverRef.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    colorPopoverRef.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(picker.x, maxLeft))}px`;
    colorPopoverRef.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(picker.y, maxTop))}px`;
  });

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

  // Drag-and-drop reorder of tag chips.
  const onChipDragStart = (e, tag) => {
    draggingTagId = tag.id;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onChipDrop = async (e, targetTag) => {
    e.preventDefault();
    if (draggingTagId === null || draggingTagId === targetTag.id) return;
    const ids = tags().map(t => t.id);
    const from = ids.indexOf(draggingTagId);
    const dragged = draggingTagId;
    draggingTagId = null;
    if (from === -1) return;
    ids.splice(from, 1);
    const insertAt = ids.indexOf(targetTag.id);
    ids.splice(insertAt, 0, dragged);
    await reorderTags(ids);
    await refreshTags();
  };

  // ---- Playlists ----

  // Handle clicking on a playlist item. Switching lists drops any active search:
  // results are scoped to one list, so keeping them would show stale hits.
  const handlePlaylistClick = (list) => {
    clearSearch();
    setCurrentListId(list.id);
    clearSelection();
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
    });
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
      if (e.key === 'Escape') { setTagMenu(null); setColorPicker(null); setPlaylistMenu(null); }
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

      <div class="playlist-list" id="playlistList" ref={playlistListRef}>
        <For each={lists() || []}>
          {(list) => (
            <SidebarPlaylistRow
              list={list}
              depth={0}
              isTagDragging={() => draggingTagId !== null}
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

      <Show when={tags().length > 0}>
        <div class="tags-section qa-tags-section">
          <div class="tags-heading">Tags</div>
          <div class="tags-list">
            <For each={tags()}>
              {(tag) => (
                <span
                  draggable={true}
                  onDragStart={(e) => onChipDragStart(e, tag)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onChipDrop(e, tag)}
                >
                  <TagPill
                    tag={tag}
                    active={isTagActive(tag)}
                    onClick={(e) => handleTagClick(tag, e)}
                    onContextMenu={(e) => handleTagContextMenu(e, tag)}
                  />
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>

      <SongEditPanel />

      {/* Playlist right-click context menu. The Main Library can only be played. */}
      <Show when={playlistMenu()}>
        <div
          class="context-menu playlist-context-menu"
          style={{ left: `${playlistMenu().x}px`, top: `${playlistMenu().y}px` }}
        >
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
        </div>
      </Show>

      {/* Tag right-click context menu */}
      <Show when={tagMenu()}>
        <div
          class="context-menu tag-context-menu"
          style={{ left: `${tagMenu().x}px`, top: `${tagMenu().y}px` }}
        >
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
        </div>
      </Show>

      {/* Color-swatch popover */}
      <Show when={colorPicker()}>
        <div
          ref={colorPopoverRef}
          class="tag-color-popover"
          style={{ left: `${colorPicker().x}px`, top: `${colorPicker().y}px` }}
        >
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
        </div>
      </Show>
    </aside>
  );
}
