import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { selectedItems } from '../stores/navigation.js';
import { FloatingMenu } from './FloatingMenu.jsx';

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
  // Mirrors Explorer's handleFindSimilar: a click inside a multi-selection acts
  // on the selection, a click outside it acts on the one row.
  const isSeedingFromSelection = () =>
    isMultiSelect() && selectedItems().has(props.item?.id);
  // Results views show songs pulled out of their folders, so actions that place
  // things relative to a row's position in its folder would land somewhere the
  // user can't see. They stay listed, grayed out.
  const placesByPosition = () => props.rowsOutOfPlace;
  // A folder there shows only its matching songs, so actions on everything
  // inside it would touch songs the user can't see.
  const actsOnHiddenSongs = () => isFolder() && props.rowsOutOfPlace;

  return (
    <FloatingMenu class="context-menu" ref={menuRef} x={props.x} y={props.y}>
      {/* Add Folder Inside (for folders only) */}
      <Show when={isFolder()}>
        <div
          class="context-menu-item"
          classList={{ disabled: actsOnHiddenSongs() }}
          onClick={() => {
            if (actsOnHiddenSongs()) return;
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
        class="context-menu-item qa-add-folder-after"
        classList={{ disabled: placesByPosition() }}
        onClick={() => {
          if (placesByPosition()) return;
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
          class="context-menu-item qa-move-into-new-folder"
          classList={{ disabled: placesByPosition() }}
          onClick={() => {
            if (placesByPosition()) return;
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
          class="context-menu-item qa-play-folder"
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
          classList={{ disabled: actsOnHiddenSongs() }}
          onClick={() => {
            if (actsOnHiddenSongs()) return;
            props.onClose?.();
            props.onCollapseAll?.();
          }}
        >
          Collapse All
        </div>

        {/* Expand All */}
        <div
          class="context-menu-item"
          classList={{ disabled: actsOnHiddenSongs() }}
          onClick={() => {
            if (actsOnHiddenSongs()) return;
            props.onClose?.();
            props.onExpandAll?.();
          }}
        >
          Expand All
        </div>

        <div class="context-menu-separator" />

        {/* Sort by... submenu */}
        <div class="context-menu-item has-submenu qa-sort-menu" classList={{ disabled: actsOnHiddenSongs() }}>
          Sort by...
          <Show when={!actsOnHiddenSongs()}>
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
          </Show>
        </div>

        {/* Flatten */}
        <div
          class="context-menu-item qa-flatten"
          classList={{ disabled: actsOnHiddenSongs() }}
          onClick={() => {
            if (actsOnHiddenSongs()) return;
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

        {/* Seeded from the whole selection when the click landed inside it --
            the label says which, so there's no guessing what you'll get. */}
        <div
          class="context-menu-item qa-find-similar"
          onClick={() => {
            const item = props.item;
            props.onClose?.();
            props.onFindSimilar?.(item);
          }}
        >
          {isSeedingFromSelection() ? `Find songs like these ${selectedItems().size}` : 'Find similar songs'}
        </div>

        <div class="context-menu-separator" />

        {/* Rate... submenu. Acts on the selection, same as the star column. */}
        <div class="context-menu-item has-submenu qa-rate-menu">
          {isSeedingFromSelection() ? `Rate these ${selectedItems().size}...` : 'Rate...'}
          <div class="context-submenu">
            <For each={[5, 4, 3, 2, 1]}>
              {(stars) => (
                <div
                  class="context-menu-item qa-rate-option"
                  data-stars={stars}
                  onClick={() => {
                    const itemId = props.item.id;
                    props.onClose?.();
                    props.onRate?.(itemId, stars);
                  }}
                >
                  {'★'.repeat(stars)}
                </div>
              )}
            </For>
            <div class="context-menu-separator" />
            <div
              class="context-menu-item qa-rate-clear"
              onClick={() => {
                const itemId = props.item.id;
                props.onClose?.();
                props.onRate?.(itemId, null);
              }}
            >
              Clear rating
            </div>
          </div>
        </div>

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

      <div class="context-menu-separator" />

      {/* Copy the audio files out to a folder. Works on folders too -- they
          export everything inside them, exactly like Option-dragging out. */}
      <div
        class="context-menu-item qa-copy-files-to"
        onClick={() => {
          const item = props.item;
          props.onClose?.();
          props.onCopyFilesTo?.(item);
        }}
      >
        {isSeedingFromSelection() ? `Copy these ${selectedItems().size} to a folder...` : 'Copy files to a folder...'}
      </div>

      {/* Delete. In a playlist this only removes the placement, so say so. */}
      <div
        class="context-menu-item qa-delete-item"
        classList={{ disabled: actsOnHiddenSongs() }}
        onClick={() => {
          if (actsOnHiddenSongs()) return;
          const item = props.item;
          props.onClose?.();
          props.onDelete?.(item);
        }}
      >
        {props.removesFromPlaylist ? 'Remove from Playlist' : 'Delete'}
      </div>
    </FloatingMenu>
  );
}
