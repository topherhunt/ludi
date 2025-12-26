import { Show, createSignal, onCleanup } from 'solid-js';
import {
  columnVisibility,
  gridTemplateColumns,
  setColumnWidth,
  getColumnWidth,
} from '../stores/columns.js';

/**
 * Column headers with resize handles
 */
export function ColumnHeaders() {
  const [resizing, setResizing] = createSignal(null);
  const [startX, setStartX] = createSignal(0);
  const [startWidth, setStartWidth] = createSignal(0);

  const visibility = columnVisibility;

  // Start resizing a column
  const startResize = (column, e) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(column);
    setStartX(e.clientX);
    setStartWidth(getColumnWidth(column) || 100);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResize);
  };

  // Handle mouse move during resize
  const handleMouseMove = (e) => {
    const column = resizing();
    if (!column) return;

    const delta = e.clientX - startX();
    const newWidth = Math.max(40, startWidth() + delta);
    setColumnWidth(column, newWidth);
  };

  // Stop resizing
  const stopResize = () => {
    setResizing(null);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResize);
  };

  // Cleanup listeners on unmount
  onCleanup(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResize);
  });

  return (
    <div
      class="column-headers"
      id="columnHeaders"
      style={{ 'grid-template-columns': gridTemplateColumns() }}
    >
      <div class="col-header col-title">
        Title
        <span class="resize-handle" onMouseDown={(e) => startResize('title', e)} />
      </div>

      <Show when={visibility().track}>
        <div class="col-header col-track" data-column="track">
          #
          <span class="resize-handle" onMouseDown={(e) => startResize('track', e)} />
        </div>
      </Show>

      <Show when={visibility().duration}>
        <div class="col-header col-duration" data-column="duration">
          Time
          <span class="resize-handle" onMouseDown={(e) => startResize('duration', e)} />
        </div>
      </Show>

      <Show when={visibility().artist}>
        <div class="col-header col-artist" data-column="artist">
          Artist
          <span class="resize-handle" onMouseDown={(e) => startResize('artist', e)} />
        </div>
      </Show>

      <Show when={visibility().album}>
        <div class="col-header col-album" data-column="album">
          Album
          <span class="resize-handle" onMouseDown={(e) => startResize('album', e)} />
        </div>
      </Show>

      <Show when={visibility().tags}>
        <div class="col-header col-tags" data-column="tags">
          Tags
        </div>
      </Show>
    </div>
  );
}
