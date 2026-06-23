import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { selectedItems } from '../stores/navigation.js';

/**
 * Context menu for tree items
 */
export function ContextMenu(props) {
  let menuRef;

  // Close menu when clicking outside
  const handleClickOutside = (e) => {
    if (menuRef && !menuRef.contains(e.target)) {
      props.onClose?.();
    }
  };

  onMount(() => {
    // Delay adding listener to prevent immediate close
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside);
  });

  const isFolder = () => props.item?.list_id !== null;
  const hasSelection = () => selectedItems().size > 0;
  const isMultiSelect = () => selectedItems().size > 1;
  // Count selected folders via their rendered rows (selection is set before right-click).
  const selectedFolderCount = () =>
    document.querySelectorAll('.tree-item-content.selected[data-is-folder="true"]').length;

  return (
    <div
      class="context-menu"
      ref={menuRef}
      style={{
        left: `${props.x}px`,
        top: `${props.y}px`,
      }}
    >
      {/* Add Folder Inside (for folders only) */}
      <Show when={isFolder()}>
        <div
          class="context-menu-item"
          onClick={() => {
            const listId = props.item.list_id;
            props.onClose?.();
            props.onAddFolderInside?.(listId);
          }}
        >
          Add Folder Inside
        </div>
      </Show>

      {/* Add Folder After */}
      <div
        class="context-menu-item"
        onClick={() => {
          // Capture values before closing (props.item becomes undefined after onClose)
          const parentListId = props.item.parent_list_id;
          const position = props.item.position + 1;
          props.onClose?.();
          props.onAddFolderAfter?.(parentListId, position);
        }}
      >
        Add Folder After
      </div>

      {/* Move into New Folder (when items selected) */}
      <Show when={hasSelection()}>
        <div
          class="context-menu-item"
          onClick={() => {
            props.onClose?.();
            props.onMoveIntoNewFolder?.();
          }}
        >
          Move into New Folder...
        </div>
      </Show>

      <Show when={isFolder()}>
        <div class="context-menu-separator" />

        {/* Play This Folder */}
        <div
          class="context-menu-item"
          onClick={() => {
            const listId = props.item.list_id;
            props.onClose?.();
            props.onPlayFolder?.(listId);
          }}
        >
          Play This Folder
        </div>

        <div class="context-menu-separator" />

        {/* Collapse All */}
        <div
          class="context-menu-item"
          onClick={() => {
            props.onClose?.();
            props.onCollapseAll?.();
          }}
        >
          Collapse All
        </div>

        {/* Expand All */}
        <div
          class="context-menu-item"
          onClick={() => {
            props.onClose?.();
            props.onExpandAll?.();
          }}
        >
          Expand All
        </div>

        <div class="context-menu-separator" />

        {/* Sort by... submenu */}
        <div class="context-menu-item has-submenu">
          Sort by...
          <div class="context-submenu">
            <div
              class="context-menu-item"
              onClick={() => {
                const listId = props.item.list_id;
                props.onClose?.();
                props.onSort?.(listId, 'artist');
              }}
            >
              Artist, album, track #, title
            </div>
            <div
              class="context-menu-item"
              onClick={() => {
                const listId = props.item.list_id;
                props.onClose?.();
                props.onSort?.(listId, 'title');
              }}
            >
              Title (alphabetical)
            </div>
          </div>
        </div>

        {/* Flatten */}
        <div
          class="context-menu-item"
          onClick={() => {
            const listId = props.item.list_id;
            props.onClose?.();
            props.onFlatten?.(listId);
          }}
        >
          Flatten
        </div>
      </Show>

      <div class="context-menu-separator" />

      {/* Batch rename when multiple items (incl. >=1 folder) are selected */}
      <Show when={isMultiSelect() && selectedFolderCount() > 0}>
        <div
          class="context-menu-item"
          onClick={() => {
            props.onClose?.();
            props.onBatchRename?.();
          }}
        >
          Rename {selectedFolderCount()} folders...
        </div>
      </Show>

      {/* Single-folder rename */}
      <Show when={!isMultiSelect() && isFolder()}>
        <div
          class="context-menu-item"
          onClick={() => {
            const item = props.item;
            props.onClose?.();
            props.onRename?.(item);
          }}
        >
          Rename
        </div>
      </Show>

      {/* Song-only actions */}
      <Show when={!isFolder()}>
        <div class="context-menu-separator" />

        <div
          class="context-menu-item"
          onClick={() => {
            const item = props.item;
            props.onClose?.();
            props.onShowInFinder?.(item);
          }}
        >
          Show in Finder
        </div>

        <div
          class="context-menu-item"
          onClick={() => {
            const item = props.item;
            props.onClose?.();
            props.onCopyPath?.(item);
          }}
        >
          Copy file path
        </div>
      </Show>

      {/* Delete */}
      <div
        class="context-menu-item"
        onClick={() => {
          const item = props.item;
          props.onClose?.();
          props.onDelete?.(item);
        }}
      >
        Delete
      </div>
    </div>
  );
}
