import { For, createResource, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { currentListId, setCurrentListId, clearSelection } from '../stores/navigation.js';
import { getLists } from '../utils/api.js';

/**
 * Sidebar component with playlist list
 */
export function Sidebar(props) {
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);

  // Fetch lists from database
  const [lists, { refetch }] = createResource(getLists);

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
    };
    const onDocClick = (e) => {
      if (
        isDropdownOpen() &&
        !e.target.closest('#addLibraryDropdown') &&
        !e.target.closest('#addLibraryBtn')
      ) {
        closeDropdown();
      }
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

  // Handle click on empty space in sidebar to clear selection
  const handleSidebarClick = (e) => {
    // Only clear if clicking on empty space (not on a playlist item)
    if (!e.target.closest('.playlist-item') && !e.target.closest('.sidebar-header')) {
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
    </aside>
  );
}
