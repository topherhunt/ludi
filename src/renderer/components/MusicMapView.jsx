import { createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import {
  mapPoints,
  mapAnalyzed,
  mapLoading,
  mapBuilding,
  rebuildMap,
} from '../stores/musicMap.js';
import { showRenameModal, showAlert } from '../stores/modals.js';
import { bumpLibraryVersion } from '../stores/tags.js';
import { saveMapSelectionAsPlaylist } from '../utils/api.js';
import {
  INITIAL_VIEW,
  worldToScreen,
  zoomAt,
  panBy,
  nearestPoint,
  pointsInPolygon,
} from '../utils/map-geometry.js';

/**
 * The music map: the whole library as dots on a page, near each other when they
 * sound alike.
 *
 * Drawn on a canvas rather than as elements, because ten thousand divs is ten
 * thousand divs. That means nothing here is clickable in the usual sense -- every
 * interaction goes through the geometry in map-geometry.js, which turns a mouse
 * position into a song.
 *
 * Drag to pan, wheel to zoom towards the pointer, shift-drag to lasso a region,
 * double-click a dot to play it.
 */

// A dot stays legible when you zoom in without becoming a blob at full extent.
const DOT_RADIUS = 2.5;
const DOT_GROWTH = 0.04;

// Golden-angle hues: consecutive groups get colours as far apart as possible, so
// neighbouring clumps never read as the same group.
const HUE_STEP = 137.508;
const UNGROUPED_COLOR = '#6b6b6b';

// A lasso needs a few points to have an inside; a shift-click shouldn't select.
const MIN_LASSO_POINTS = 3;

function colorFor(clusterId) {
  if (clusterId === null || clusterId === undefined) return UNGROUPED_COLOR;
  return `hsl(${(clusterId * HUE_STEP) % 360}, 62%, 58%)`;
}

export function MusicMapView(props) {
  let containerRef;
  let canvasRef;

  const [view, setView] = createSignal(INITIAL_VIEW);
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [hovered, setHovered] = createSignal(null); // { point, x, y } | null
  const [selection, setSelection] = createSignal([]);
  const [lasso, setLasso] = createSignal(null); // screen points being drawn

  // Drag state is deliberately not reactive: it changes on every mouse move and
  // nothing renders from it directly.
  let dragging = null; // { mode: 'pan' | 'lasso', lastX, lastY }

  const missingCount = () => Math.max(0, mapAnalyzed() - mapPoints().length);

  const canvasPoint = (e) => {
    const rect = canvasRef.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ---- Drawing ----

  const draw = () => {
    if (!canvasRef) return;
    const { width, height } = size();
    if (width === 0 || height === 0) return;

    const ctx = canvasRef.getContext('2d');
    const currentView = view();
    const selected = new Set(selection().map(point => point.songId));

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    const radius = DOT_RADIUS + currentView.zoom * DOT_GROWTH;
    for (const point of mapPoints()) {
      const screen = worldToScreen(point, currentView, size());
      if (screen.x < -radius || screen.x > width + radius) continue;
      if (screen.y < -radius || screen.y > height + radius) continue;

      ctx.beginPath();
      ctx.arc(screen.x, screen.y, selected.has(point.songId) ? radius + 2 : radius, 0, Math.PI * 2);
      ctx.fillStyle = colorFor(point.clusterId);
      ctx.fill();
      if (selected.has(point.songId)) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    }

    const hover = hovered();
    if (hover) {
      const screen = worldToScreen(hover.point, currentView, size());
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }

    const path = lasso();
    if (path && path.length > 1) {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (const step of path.slice(1)) ctx.lineTo(step.x, step.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120, 170, 255, 0.15)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(150, 190, 255, 0.9)';
      ctx.stroke();
    }
  };

  createEffect(draw);

  // ---- Sizing ----

  // The canvas has two sizes: its CSS size, which is what every coordinate here
  // is in, and its backing-store size, which has to account for the display's
  // pixel ratio or everything looks soft.
  const resize = () => {
    if (!containerRef || !canvasRef) return;
    const rect = containerRef.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvasRef.width = Math.round(rect.width * ratio);
    canvasRef.height = Math.round(rect.height * ratio);
    canvasRef.style.width = `${rect.width}px`;
    canvasRef.style.height = `${rect.height}px`;
    canvasRef.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
    setSize({ width: rect.width, height: rect.height });
  };

  onMount(() => {
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef);
    onCleanup(() => observer.disconnect());
  });

  // ---- Pointer ----

  const handleWheel = (e) => {
    e.preventDefault();
    // Exponential so each notch is the same proportional change either way.
    setView(zoomAt(view(), canvasPoint(e), Math.exp(-e.deltaY * 0.002), size()));
  };

  const handlePointerDown = (e) => {
    const point = canvasPoint(e);
    canvasRef.setPointerCapture(e.pointerId);
    if (e.shiftKey) {
      dragging = { mode: 'lasso' };
      setLasso([point]);
    } else {
      dragging = { mode: 'pan', lastX: point.x, lastY: point.y };
    }
  };

  const handlePointerMove = (e) => {
    const point = canvasPoint(e);

    if (!dragging) {
      const hit = nearestPoint(mapPoints(), point, view(), size());
      setHovered(hit ? { point: hit, x: point.x, y: point.y } : null);
      return;
    }

    if (dragging.mode === 'pan') {
      setView(panBy(view(), point.x - dragging.lastX, point.y - dragging.lastY, size()));
      dragging.lastX = point.x;
      dragging.lastY = point.y;
      return;
    }

    setLasso([...lasso(), point]);
  };

  const handlePointerUp = (e) => {
    if (!dragging) return;
    canvasRef.releasePointerCapture(e.pointerId);

    if (dragging.mode === 'lasso') {
      const path = lasso() || [];
      setSelection(path.length >= MIN_LASSO_POINTS
        ? pointsInPolygon(mapPoints(), path, view(), size())
        : []);
      setLasso(null);
    }
    dragging = null;
  };

  const handleDblClick = (e) => {
    const hit = nearestPoint(mapPoints(), canvasPoint(e), view(), size());
    if (hit) props.onPlaySong?.(hit.itemId, hit.parentListId);
  };

  // The same song menu the lists offer, for the dot under the pointer.
  const handleContextMenu = (e) => {
    e.preventDefault();
    const hit = nearestPoint(mapPoints(), canvasPoint(e), view(), size());
    if (!hit) return;
    props.onContextMenu(e.clientX, e.clientY, {
      id: hit.itemId,
      list_id: null,
      song_id: hit.songId,
      parent_list_id: hit.parentListId,
    });
  };

  // ---- Actions ----

  const handleRebuild = async () => {
    const summary = await rebuildMap();
    setSelection([]);
    setView(INITIAL_VIEW);
    if (summary.points === 0) {
      showAlert(
        '<i class="bi bi-map" style="margin-right: 8px;"></i>Not Enough To Map',
        `Only ${summary.songs} songs have been analyzed. Run the audio analysis from Settings first -- the map needs a library to find shape in.`
      );
      return;
    }
    showAlert(
      '<i class="bi bi-map" style="margin-right: 8px;"></i>Map Built',
      `${summary.points} songs placed on the map.`
    );
  };

  const handleSaveSelection = () => {
    const songs = selection();
    showRenameModal('Map Selection', async (title) => {
      const trimmed = (title || '').trim();
      if (!trimmed) return;
      await saveMapSelectionAsPlaylist(songs.map(point => point.songId), trimmed);
      bumpLibraryVersion();
      showAlert(
        '<i class="bi bi-music-note-list" style="margin-right: 8px;"></i>Playlist Created',
        `"${trimmed}" now holds ${songs.length} songs.`
      );
    }, 'Save Selection As Playlist');
  };

  return (
    <div class="explorer-container map-container qa-map-view" id="explorerContainer">
      {/* The zoom level is on the element because it is otherwise invisible:
          the canvas can't be inspected, so nothing else could tell you (or a
          test) what the view is doing. */}
      <div class="map-canvas-wrap" ref={containerRef} data-zoom={view().zoom.toFixed(3)}>
        <canvas
          ref={canvasRef}
          class="map-canvas qa-map-canvas"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDblClick={handleDblClick}
          onContextMenu={handleContextMenu}
        />

        <Show when={hovered()}>
          <div
            class="map-tooltip qa-map-tooltip"
            style={{ left: `${hovered().x + 14}px`, top: `${hovered().y + 14}px` }}
          >
            <div class="map-tooltip-title">{hovered().point.title}</div>
            <Show when={hovered().point.artist}>
              <div class="map-tooltip-artist">{hovered().point.artist}</div>
            </Show>
          </div>
        </Show>

        <Show when={!mapLoading() && mapPoints().length === 0}>
          <div class="map-empty qa-map-empty">
            <i class="bi bi-map" />
            <p>Your library has not been mapped yet.</p>
            <button class="modal-btn qa-map-build" disabled={mapBuilding()} onClick={handleRebuild}>
              {mapBuilding() ? 'Building...' : 'Build the map'}
            </button>
          </div>
        </Show>
      </div>

      <div class="map-status">
        <span class="qa-map-count">{mapPoints().length} songs</span>
        <Show when={missingCount() > 0}>
          <span class="map-missing qa-map-missing">
            {missingCount()} analyzed since the last build -- rebuild to place them
          </span>
        </Show>
        <Show when={selection().length > 0}>
          <span class="map-selection qa-map-selection">{selection().length} selected</span>
          <button class="map-status-btn qa-map-save-selection" onClick={handleSaveSelection}>
            Save as playlist
          </button>
          <button class="map-status-btn qa-map-clear-selection" onClick={() => setSelection([])}>
            Clear
          </button>
        </Show>
        <span class="map-hint">Drag to pan, scroll to zoom, shift-drag to select</span>
      </div>
    </div>
  );
}
