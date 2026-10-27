import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { selectedItems } from '../stores/navigation.js';
import { FloatingMenu } from './FloatingMenu.jsx';

// DEPRECATED (folders): song lists no longer show folders, so every
// folder-only action below stays hidden. TODO: delete them with the rest of the
// folder code (see TASKS.md).
const SHOW_FOLDER_ACTIONS = false;

/**
 * Context menu for song rows and group rows
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

  // A group row (album, artist...) stands for the songs inside it.
  const isGroup = () => props.item.groupKey !== undefined;
  const isFolder = () => SHOW_FOLDER_ACTIONS && props.item.list_id !== null;
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
      <Show when={isGroup()}>
        <div
          class="context-menu-item qa-play-group"
          onClick={() => {
            const groupKey = props.item.groupKey;
            props.onClose?.();
            props.onPlayGroup?.(groupKey);
          }}
        >
          Play This Group
        </div>

        <div class="context-menu-separator" />

        <div
          class="context-menu-item qa-group-collapse-all"
          onClick={() => {
            props.onClose?.();
            props.onCollapseAll?.();
          }}
        >
          Collapse All
        </div>
        <div
          class="context-menu-item qa-group-expand-all"
          onClick={() => {
            props.onClose?.();
            props.onExpandAll?.();
          }}
        >
          Expand All
        </div>
      </Show>

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
      <Show when={SHOW_FOLDER_ACTIONS}>
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
      </Show>

      {/* Move into New Folder (when items selected) */}
      <Show when={SHOW_FOLDER_ACTIONS && hasSelection()}>
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
        <div class="context-menu-item has-submenu qa-folder-sort-menu" classList={{ disabled: actsOnHiddenSongs() }}>
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

      {/* Batch rename when multiple items (incl. >=1 folder) are selected */}
      <Show when={SHOW_FOLDER_ACTIONS && isMultiSelect() && selectedFolderCount() > 0}>
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
      <Show when={!isFolder() && !isGroup()}>
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
