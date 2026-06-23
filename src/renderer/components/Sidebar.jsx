import { For, createResource, createSignal, Show } from 'solid-js';
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
        <button
          id="addLibraryBtn"
          class="add-btn"
          title="Add"
          onClick={toggleDropdown}
        >
          +
        </button>
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
