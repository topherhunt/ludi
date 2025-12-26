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
            props.onClose?.();
            props.onAddFolderInside?.(props.item.list_id);
          }}
        >
          Add Folder Inside
        </div>
      </Show>

      {/* Add Folder After */}
      <div
        class="context-menu-item"
        onClick={() => {
          props.onClose?.();
          props.onAddFolderAfter?.(props.item.parent_list_id, props.item.position + 1);
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
            props.onClose?.();
            props.onPlayFolder?.(props.item.list_id);
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
            props.onClose?.();
            props.onRename?.(props.item);
          }}
        >
          Rename
        </div>
      </Show>

      {/* Delete */}
      <div
        class="context-menu-item"
        onClick={() => {
          props.onClose?.();
          props.onDelete?.(props.item);
        }}
      >
        Delete
      </div>
    </div>
  );
}
