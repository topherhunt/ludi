import { For, createResource, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { currentListId, setCurrentListId, clearSelection } from '../stores/navigation.js';
import { getLists, renameTag, setTagColor, deleteTag, reorderTags } from '../utils/api.js';
import { tags, refreshTags, bumpLibraryVersion, findTagByName } from '../stores/tags.js';
import { runSearch, isSearching, searchQuery } from '../stores/search.js';
import { showRenameModal, showConfirmModal, showAlert } from '../stores/modals.js';
import { TAG_COLORS } from '../utils/tagColors.js';
import { TagPill } from './TagPill.jsx';
import { SongEditPanel } from './SongEditPanel.jsx';

/**
 * Sidebar component with playlist list
 */
export function Sidebar(props) {
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);

  // Tag context menu + color-picker popover state
  const [tagMenu, setTagMenu] = createSignal(null);       // { x, y, tag } | null
  const [colorPicker, setColorPicker] = createSignal(null); // { x, y, tag } | null
  let draggingTagId = null;

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
    });
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

  // Handle clicking on a playlist item
  const handlePlaylistClick = (listId) => {
    setCurrentListId(listId);
    clearSelection();
    props.onListChange?.(listId);
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
      if (e.key === 'Escape') { setTagMenu(null); setColorPicker(null); }
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
      !e.target.closest('.tag-color-popover')
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
              id="newFolderMenuItem"
              onClick={handleNewFolder}
            >
              New Folder
            </div>
          </div>
        </Show>
      </div>

      <div class="playlist-list" id="playlistList">
        <For each={lists() || []}>
          {(list) => (
            <div
              class="playlist-item"
              classList={{ active: currentListId() === list.id }}
              onClick={() => handlePlaylistClick(list.id)}
            >
              {list.title}
            </div>
          )}
        </For>
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
          class="tag-color-popover"
          style={{ left: `${colorPicker().x}px`, top: `${colorPicker().y}px` }}
        >
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
      </Show>
    </aside>
  );
}
