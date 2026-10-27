import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import {
  COLUMNS,
  columnVisibility,
  gridTemplateColumns,
  setColumnWidth,
  getColumnWidth,
  toggleColumnVisibility,
} from '../stores/columns.js';
import { FloatingMenu } from './FloatingMenu.jsx';

/**
 * Column headers with resize handles. Right-click opens a menu of every column;
 * it stays open while you toggle several, and closes on a click anywhere else.
 */
export function ColumnHeaders() {
  const [resizing, setResizing] = createSignal(null);
  const [startX, setStartX] = createSignal(0);
  const [startWidth, setStartWidth] = createSignal(0);
  const [chooserAt, setChooserAt] = createSignal(null); // { x, y } while open
  let chooserEl;

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

  const closeChooserOnOutsideClick = (e) => {
    if (!chooserEl.contains(e.target)) setChooserAt(null);
  };

  createEffect(() => {
    if (chooserAt()) document.addEventListener('mousedown', closeChooserOnOutsideClick);
    else document.removeEventListener('mousedown', closeChooserOnOutsideClick);
  });

  // Cleanup listeners on unmount
  onCleanup(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResize);
    document.removeEventListener('mousedown', closeChooserOnOutsideClick);
  });

  return (
    <div
      class="column-headers qa-column-headers"
      id="columnHeaders"
      style={{ 'grid-template-columns': gridTemplateColumns() }}
      onContextMenu={(e) => {
        e.preventDefault();
        setChooserAt({ x: e.clientX, y: e.clientY });
      }}
    >
      <div class="col-header col-title">
        Title
        <span class="resize-handle" onMouseDown={(e) => startResize('title', e)} />
      </div>

      <For each={COLUMNS}>
        {(column) => (
          <Show when={columnVisibility()[column.key]}>
            <div class={`col-header col-${column.key}`} data-column={column.key}>
              {column.label}
              <Show when={column.key !== 'tags'}>
                <span class="resize-handle" onMouseDown={(e) => startResize(column.key, e)} />
              </Show>
            </div>
          </Show>
        )}
      </For>

      <Show when={chooserAt()}>
        <FloatingMenu
          class="context-menu qa-column-chooser"
          x={chooserAt().x}
          y={chooserAt().y}
          ref={(el) => (chooserEl = el)}
        >
          <For each={COLUMNS}>
            {(column) => (
              <div
                class="context-menu-item qa-column-option"
                data-column={column.key}
                onClick={() => toggleColumnVisibility(column.key)}
              >
                <i class={`context-menu-icon bi ${columnVisibility()[column.key] ? 'bi-check2' : ''}`} />
                {column.menuLabel || column.label}
              </div>
            )}
          </For>
        </FloatingMenu>
      </Show>
    </div>
  );
}
