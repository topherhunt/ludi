# SolidJS Migration Plan for LUDI Music Player

## Executive Summary

This document outlines a comprehensive plan to migrate the LUDI Music Player renderer from vanilla JavaScript (~2,283 lines in `renderer.js`) to SolidJS. The migration will:

1. Eliminate manual DOM synchronization bugs
2. Enable fine-grained reactivity (only update what changes)
3. Improve maintainability with component-based architecture
4. Preserve all existing functionality and tests

---

## Current Architecture Analysis

### Files to Migrate

| File | Lines | Purpose |
|------|-------|---------|
| `src/renderer/renderer.js` | 2,283 | Main UI logic, state, event handlers |
| `src/renderer/index.html` | 111 | Static HTML shell |
| `src/renderer/settings.js` | 103 | Settings window logic |
| `src/renderer/settings.html` | - | Settings window HTML |
| `src/renderer/styles.css` | ~600 | Styling (keep as-is) |

### Current State Variables (renderer.js)

```javascript
// Navigation/View State
let currentListId = 0;
let selectedItems = new Set();
let lastSelectedItemId = null;

// Playback State
let currentSound = null;           // Howler instance
let isPlaying = false;
let currentPlaylist = [];
let currentTrackIndex = -1;
let currentPlayingSongId = null;
let shuffleEnabled = false;
let loopMode = 'off';              // 'off', 'all', 'one'
let shuffledIndices = [];

// Drag & Drop State
let draggedItem = null;
let draggedItems = [];
let isInternalDrag = false;
let dropTarget = null;
let dropPosition = 0;

// Column Settings
let columnSettings = { visibility: {...}, widths: {...} };
let resizing = null;
let startX = 0;
let startWidth = 0;
```

### Key Pain Points in Current Code

1. **Full tree re-renders on state changes** (lines 1063, 1074, 1164, 1327)
   - `loadListItems(currentListId)` called on play, pause, stop, song end
   - Rebuilds entire DOM tree just to update one icon

2. **Manual selection UI sync** (lines 488-497)
   - `updateSelectionUI()` loops through all items to toggle `.selected` class

3. **Async recursive rendering** (lines 223-375)
   - `renderTreeItem()` is 150+ lines of imperative DOM creation
   - Nested async calls for folder children

4. **Event listener cleanup** (lines 121-177)
   - Manual `renameModalCleanup` pattern for modal listeners

---

## Target Architecture

### Directory Structure

```
src/renderer/
├── index.html                 # Minimal shell with <div id="app">
├── index.jsx                  # SolidJS entry point
├── styles.css                 # Keep existing styles
├── bootstrap-icons.min.css    # Keep as-is
├── howler.min.js              # Keep as-is (loaded via script tag)
│
├── components/
│   ├── App.jsx                # Root component
│   ├── Sidebar.jsx            # Sidebar with playlist list
│   ├── Explorer.jsx           # Main panel container
│   ├── ExplorerHeader.jsx     # Title + Collapse/Expand buttons
│   ├── ColumnHeaders.jsx      # Resizable column headers
│   ├── TreeView.jsx           # Tree container
│   ├── TreeItem.jsx           # Individual tree item (song or folder)
│   ├── TreeItemContent.jsx    # The row content (columns)
│   ├── PlayerControls.jsx     # Footer with playback controls
│   ├── Modal.jsx              # Generic modal dialog
│   ├── RenameModal.jsx        # Folder rename modal
│   ├── ContextMenu.jsx        # Right-click menu
│   └── DropIndicator.jsx      # Drag-drop visual indicator
│
├── stores/
│   ├── navigation.js          # currentListId, selectedItems
│   ├── playback.js            # isPlaying, currentSong, shuffle, loop
│   ├── dragdrop.js            # drag state
│   ├── columns.js             # column visibility/widths
│   └── modals.js              # modal open/close state
│
├── hooks/
│   ├── useKeyboard.js         # Keyboard shortcut handling
│   ├── useDragDrop.js         # Drag-drop logic
│   └── useAudio.js            # Howler wrapper
│
└── utils/
    ├── format.js              # formatTime, etc.
    ├── api.js                 # window.electronAPI wrappers
    └── tree.js                # Tree traversal helpers
```

### Component Hierarchy

```
App
├── Sidebar
│   └── PlaylistItem (For each)
├── Explorer
│   ├── ExplorerHeader
│   ├── ColumnHeaders
│   ├── DropIndicator
│   └── TreeView
│       └── TreeItem (For each, recursive)
│           ├── TreeItemContent
│           └── TreeView (if folder & expanded)
├── PlayerControls
├── Modal
├── RenameModal
└── ContextMenu (portal to body)
```

---

## Build Tooling Changes

### Current Setup
- No bundler, raw JS files loaded via `<script>` tags
- Electron loads `index.html` directly

### New Setup with Vite

```bash
# Install dependencies
npm install solid-js
npm install -D vite vite-plugin-solid
```

**New `vite.config.js`:**
```javascript
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    target: 'esnext',
    minify: false,  // Easier debugging in Electron
  },
  server: {
    port: 5173,
  },
});
```

**Updated `package.json` scripts:**
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "start": "npm run build && electron .",
    "electron:dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "test": "npm run build && playwright test"
  }
}
```

**Updated `main.js` to load from Vite in dev:**
```javascript
if (process.env.NODE_ENV === 'development') {
  mainWindow.loadURL('http://localhost:5173');
} else {
  mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
}
```

### CSP Updates

Update `index.html` CSP for Vite dev server:
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' http://localhost:5173;
  style-src 'self' 'unsafe-inline';
  connect-src 'self' ws://localhost:5173;
  media-src 'self' data: file:;
  font-src 'self'
">
```

---

## State Management Design

### Using Solid Stores

**`stores/playback.js`:**
```javascript
import { createSignal, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';

// Simple signals for primitives
export const [isPlaying, setIsPlaying] = createSignal(false);
export const [currentPlayingSongId, setCurrentPlayingSongId] = createSignal(null);
export const [shuffleEnabled, setShuffleEnabled] = createSignal(false);
export const [loopMode, setLoopMode] = createSignal('off'); // 'off' | 'all' | 'one'

// Store for complex state
export const [playbackState, setPlaybackState] = createStore({
  playlist: [],
  trackIndex: -1,
  shuffledIndices: [],
});

// Derived state
export const currentSongId = createMemo(() => {
  const idx = playbackState.trackIndex;
  if (idx < 0 || idx >= playbackState.playlist.length) return null;

  if (shuffleEnabled() && playbackState.shuffledIndices.length > 0) {
    const actualIdx = playbackState.shuffledIndices[idx];
    return playbackState.playlist[actualIdx];
  }
  return playbackState.playlist[idx];
});

// Expose for testing (matches current behavior)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'shuffleEnabled', {
    get: () => shuffleEnabled(),
  });
  Object.defineProperty(window, 'loopMode', {
    get: () => loopMode(),
  });
}
```

**`stores/navigation.js`:**
```javascript
import { createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';

export const [currentListId, setCurrentListId] = createSignal(0);
export const [lastSelectedItemId, setLastSelectedItemId] = createSignal(null);

// Using a store for the Set to enable fine-grained updates
export const [selectionState, setSelectionState] = createStore({
  items: new Set(),
});

export function isSelected(itemId) {
  return selectionState.items.has(itemId);
}

export function toggleSelection(itemId, { shift = false, cmd = false } = {}) {
  setSelectionState(produce(state => {
    if (cmd) {
      if (state.items.has(itemId)) {
        state.items.delete(itemId);
      } else {
        state.items.add(itemId);
        setLastSelectedItemId(itemId);
      }
    } else if (shift && lastSelectedItemId() !== null) {
      // Range selection logic would go here
      // Needs access to visible items list
    } else {
      state.items.clear();
      state.items.add(itemId);
      setLastSelectedItemId(itemId);
    }
  }));
}

export function clearSelection() {
  setSelectionState(produce(state => {
    state.items.clear();
  }));
  setLastSelectedItemId(null);
}

export function getSelectedItems() {
  return Array.from(selectionState.items);
}
```

---

## Component Examples

### TreeItem.jsx (Core Component)

```jsx
import { Show, For, createResource, createMemo, createSignal } from 'solid-js';
import { isSelected, toggleSelection } from '../stores/navigation';
import { currentPlayingSongId, isPlaying } from '../stores/playback';
import { columnSettings } from '../stores/columns';
import { formatTime } from '../utils/format';
import { getListItems, folderContainsSong } from '../utils/api';

export function TreeItem(props) {
  const isFolder = () => props.item.list_id !== null;
  const [isExpanded, setIsExpanded] = createSignal(props.item.list_is_expanded || false);

  // Fine-grained reactivity: only this computed re-runs when currentPlayingSongId changes
  const isCurrentSong = createMemo(() =>
    !isFolder() && props.item.song_id === currentPlayingSongId()
  );

  // Check if folder contains playing song (async)
  const [containsPlayingSong] = createResource(
    () => isFolder() ? [props.item.list_id, currentPlayingSongId()] : null,
    ([folderId, songId]) => songId ? folderContainsSong(folderId, songId) : false
  );

  const showPlayingIndicator = createMemo(() =>
    isCurrentSong() || (isFolder() && containsPlayingSong())
  );

  // Icon class - only this specific DOM node updates when isPlaying changes
  const iconClass = createMemo(() => {
    if (isFolder()) return 'bi bi-caret-right-fill';
    if (isCurrentSong()) {
      return isPlaying() ? 'bi bi-play-fill' : 'bi bi-pause-fill';
    }
    return 'bi bi-music-note';
  });

  const handleClick = (e) => {
    if (e.target.closest('.tree-item-icon.chevron')) return;
    toggleSelection(props.item.id, {
      shift: e.shiftKey,
      cmd: e.metaKey || e.ctrlKey
    });
  };

  const handleDoubleClick = () => {
    if (isFolder()) {
      props.onPlayFolder?.(props.item.list_id);
    } else {
      props.onPlaySong?.(props.item.song_id, props.item.parent_list_id);
    }
  };

  const toggleExpand = async (e) => {
    e.stopPropagation();
    const newState = !isExpanded();
    setIsExpanded(newState);
    await window.electronAPI.updateFolderExpanded({
      listId: props.item.list_id,
      isExpanded: newState
    });
  };

  const gridTemplate = createMemo(() => {
    // Build grid template based on visible columns
    const cols = columnSettings();
    // ... same logic as buildGridTemplateColumns()
  });

  return (
    <li class="tree-item" data-item-id={props.item.id}>
      <div
        class="tree-item-content"
        classList={{
          selected: isSelected(props.item.id),
        }}
        style={{ 'grid-template-columns': gridTemplate() }}
        onClick={handleClick}
        onDblClick={handleDoubleClick}
        onContextMenu={(e) => props.onContextMenu?.(e, props.item)}
        draggable={true}
        onDragStart={(e) => props.onDragStart?.(e, props.item)}
        onDragOver={props.onDragOver}
        onDrop={props.onDrop}
        onDragEnd={props.onDragEnd}
        data-item-id={props.item.id}
        data-is-folder={isFolder()}
        data-folder-id={isFolder() ? props.item.list_id : undefined}
        data-song-id={!isFolder() ? props.item.song_id : undefined}
      >
        <span class="col-title" style={{ 'padding-left': `${props.depth * 20}px` }}>
          <Show
            when={isFolder()}
            fallback={
              <span
                class="tree-item-icon"
                classList={{
                  playing: showPlayingIndicator() && isPlaying(),
                  paused: showPlayingIndicator() && !isPlaying()
                }}
              >
                <i class={iconClass()} />
              </span>
            }
          >
            <span
              class="tree-item-icon chevron"
              classList={{ expanded: isExpanded() }}
              onClick={toggleExpand}
            >
              <i class="bi bi-caret-right-fill" />
            </span>
          </Show>
          <span class="tree-item-label">
            {isFolder() ? props.item.list_title : props.item.song_title}
            <Show when={isFolder()}>
              <FolderItemCount listId={props.item.list_id} />
            </Show>
          </span>
        </span>

        <span class="col-track">{!isFolder() && props.item.track_number}</span>
        <span class="col-duration">{!isFolder() && formatTime(props.item.duration_seconds)}</span>
        <span class="col-artist">{!isFolder() && props.item.artist !== 'Unknown' && props.item.artist}</span>
        <span class="col-album">{!isFolder() && props.item.album !== 'Unknown' && props.item.album}</span>
        <span class="col-tags"></span>
      </div>

      <Show when={isFolder() && isExpanded()}>
        <TreeChildren
          listId={props.item.list_id}
          depth={props.depth + 1}
          onPlayFolder={props.onPlayFolder}
          onPlaySong={props.onPlaySong}
          onContextMenu={props.onContextMenu}
          onDragStart={props.onDragStart}
          onDragOver={props.onDragOver}
          onDrop={props.onDrop}
          onDragEnd={props.onDragEnd}
        />
      </Show>
    </li>
  );
}

function TreeChildren(props) {
  const [items] = createResource(
    () => props.listId,
    (listId) => getListItems(listId)
  );

  return (
    <ul class="tree-item-children expanded" data-list-id={props.listId}>
      <For each={items()}>
        {(item) => (
          <TreeItem
            item={item}
            depth={props.depth}
            onPlayFolder={props.onPlayFolder}
            onPlaySong={props.onPlaySong}
            onContextMenu={props.onContextMenu}
            onDragStart={props.onDragStart}
            onDragOver={props.onDragOver}
            onDrop={props.onDrop}
            onDragEnd={props.onDragEnd}
          />
        )}
      </For>
    </ul>
  );
}

function FolderItemCount(props) {
  const [count] = createResource(
    () => props.listId,
    (listId) => getFolderItemCount(listId)
  );

  return (
    <span class="tree-item-count">
      {count() !== undefined ? `${count()} item${count() !== 1 ? 's' : ''}` : ''}
    </span>
  );
}
```

### Modal.jsx

```jsx
import { Show, Portal } from 'solid-js/web';
import { createSignal, onCleanup } from 'solid-js';

export function Modal(props) {
  let dialogRef;

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      props.onClose?.();
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      props.onClose?.();
    }
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="modal-overlay visible"
          onClick={handleOverlayClick}
          onKeyDown={handleKeyDown}
        >
          <div class="modal-dialog" ref={dialogRef}>
            <Show when={props.title}>
              <div class="modal-title">{props.title}</div>
            </Show>
            <div class="modal-content">{props.children}</div>
            <div class="modal-buttons">
              {props.buttons}
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

export function ConfirmModal(props) {
  return (
    <Modal
      open={props.open}
      title={props.title}
      onClose={props.onNo}
      buttons={
        <>
          <button class="modal-btn modal-btn-secondary" onClick={props.onNo}>No</button>
          <button class="modal-btn" onClick={props.onYes}>Yes</button>
        </>
      }
    >
      <div innerHTML={props.message} />
    </Modal>
  );
}
```

---

## Migration Phases

### Phase 1: Setup & Infrastructure
**Goal:** Get SolidJS building alongside existing code

1. Install dependencies (`solid-js`, `vite`, `vite-plugin-solid`)
2. Create `vite.config.js`
3. Create minimal `src/renderer/index.jsx` that renders "Hello Solid"
4. Update Electron's `main.js` to load from Vite in dev mode
5. Update CSP headers
6. Verify hot reload works
7. Run existing tests (they should still pass since we haven't changed functionality)

### Phase 2: State Stores
**Goal:** Centralize state management

1. Create `stores/navigation.js` (selection state)
2. Create `stores/playback.js` (playback state)
3. Create `stores/columns.js` (column visibility/widths)
4. Create `stores/modals.js` (modal open/close state)
5. Create `stores/dragdrop.js` (drag state)
6. Expose test globals (`window.shuffleEnabled`, `window.loopMode`)
7. Write unit tests for stores

### Phase 3: Utility Functions
**Goal:** Extract pure functions

1. Create `utils/format.js` (formatTime)
2. Create `utils/api.js` (wrapper around `window.electronAPI`)
3. Create `utils/tree.js` (isDescendantFolder, folderContainsSong, getFolderItemCount, buildPlaylistFromFolder)
4. Create `utils/shuffle.js` (shuffleArray)
5. Write unit tests for utilities

### Phase 4: Audio Hook
**Goal:** Encapsulate Howler logic

1. Create `hooks/useAudio.js`
   - Wraps Howler.js
   - Exposes play, pause, seek, volume, mute
   - Handles onend, onplay, onpause callbacks
   - Updates playback store signals
2. Test audio functionality

### Phase 5: Simple Components
**Goal:** Build leaf components first

1. `DropIndicator.jsx`
2. `PlayerControls.jsx` (using playback store + audio hook)
3. `Modal.jsx` and `RenameModal.jsx`
4. `ContextMenu.jsx` (using Portal)
5. `ColumnHeaders.jsx` (with resize logic)
6. `ExplorerHeader.jsx`
7. Test each component in isolation

### Phase 6: Tree Components
**Goal:** The core UI

1. `TreeItemContent.jsx` (the row itself)
2. `TreeItem.jsx` (wraps content + children)
3. `TreeView.jsx` (the `<ul>` container + data fetching)
4. Wire up selection, playing indicator, expand/collapse
5. Verify playing indicator updates without full re-render

### Phase 7: Drag & Drop
**Goal:** Implement drag-drop

1. Create `hooks/useDragDrop.js`
2. Add drag handlers to TreeItem
3. Implement drop logic (reorder, drop into folder)
4. Handle external file drops
5. Test drag-drop scenarios

### Phase 8: Keyboard Navigation
**Goal:** Implement keyboard shortcuts

1. Create `hooks/useKeyboard.js`
2. Arrow key navigation
3. Enter/Space to play
4. Backspace to delete
5. Escape to close modals/clear selection
6. Test keyboard interactions

### Phase 9: Sidebar & App Shell
**Goal:** Complete the layout

1. `Sidebar.jsx` with playlist list
2. `Explorer.jsx` combining all explorer components
3. `App.jsx` as root
4. Wire everything together
5. Full integration test

### Phase 10: Settings Window
**Goal:** Migrate settings UI

1. Create `src/renderer/settings/index.jsx`
2. Migrate settings.js logic to SolidJS
3. Update settings.html

### Phase 11: Cleanup & Optimization
**Goal:** Remove old code, optimize

1. Delete `renderer.js`
2. Delete vanilla HTML structure from `index.html`
3. Performance audit (check re-render counts)
4. Bundle size check
5. Full test suite pass

---

## Testing Strategy

### Existing Tests

The current Playwright tests in `tests/app.spec.js` will continue to work because:

1. They test via the DOM (selectors like `.tree-item-content`, `#playPauseBtn`)
2. They test via `window.electronAPI` which is unchanged
3. They test via exposed globals (`window.shuffleEnabled`, `window.loopMode`)

### New Tests to Add

1. **Unit tests for stores** (using Vitest)
   - Selection state transitions
   - Playback state transitions
   - Column settings persistence

2. **Component tests** (using solid-testing-library)
   - TreeItem renders correctly for songs vs folders
   - TreeItem shows playing indicator for current song
   - Modal opens/closes correctly

3. **Integration tests** (keep using Playwright)
   - Verify no regressions in existing functionality

### Test Commands

```json
{
  "scripts": {
    "test:unit": "vitest",
    "test:e2e": "npm run build && playwright test",
    "test": "npm run test:unit && npm run test:e2e"
  }
}
```

---

## Risk Mitigation

### Risk 1: Breaking existing functionality
**Mitigation:**
- Keep vanilla `renderer.js` until Phase 11
- Run Playwright tests after each phase
- Feature flag to switch between old/new renderer if needed

### Risk 2: Howler.js integration issues
**Mitigation:**
- Keep Howler loaded via script tag (don't bundle)
- Wrap in `useAudio` hook, test separately
- Fallback to window.Howl if needed

### Risk 3: Electron IPC timing issues
**Mitigation:**
- Use createResource for async data
- Handle loading/error states explicitly
- Don't block render on async operations

### Risk 4: Drag-drop complexity
**Mitigation:**
- Implement in isolated hook first
- Port logic line-by-line from existing code
- Test each scenario individually

---

## Success Criteria

1. **All existing Playwright tests pass**
2. **Playing indicator updates without tree re-render** (verify via React DevTools equivalent or console.log)
3. **Selection updates without tree re-render**
4. **Bundle size < 100KB** (SolidJS is ~7KB, rest is our code)
5. **No console errors during normal operation**
6. **Hot reload works in development**

---

## Dependencies to Add

```json
{
  "dependencies": {
    "solid-js": "^1.8.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "vite-plugin-solid": "^2.8.0",
    "vitest": "^1.0.0",
    "@solidjs/testing-library": "^0.8.0",
    "concurrently": "^8.0.0",
    "wait-on": "^7.0.0"
  }
}
```

---

## Timeline Estimate

This migration can be done incrementally while keeping the app functional:

- **Phase 1-3:** Infrastructure and utilities
- **Phase 4-5:** Audio and simple components
- **Phase 6-8:** Core tree and interactions
- **Phase 9-11:** Integration and cleanup

Each phase should be a separate commit/PR to allow easy rollback if issues arise.

---

## Questions to Resolve Before Starting

1. **Do you want to use TypeScript?** - No. Just plain JS, for simplicity.

2. **Keep settings window vanilla or migrate too?** - Yes. Preferably all or nearly all UI will be as Solid components.

3. **Do you want to change the testing framework?** - Yes. Add Vitest unit tests as relevant, but leave the E2E integration tests in place, they will be an important pattern to retain going forward.

4. **Any features you want to add during migration?** - No, just a 1:1 migration for now.
