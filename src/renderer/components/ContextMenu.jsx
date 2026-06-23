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
      </Show>

      <div class="context-menu-separator" />

      {/* Rename (for folders only) */}
      <Show when={isFolder()}>
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
