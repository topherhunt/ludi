import { createSignal, createMemo, createRoot } from 'solid-js';

const STORAGE_KEY = 'ludi-column-settings';

const DEFAULT_VISIBILITY = {
  track: true,
  duration: true,
  artist: true,
  album: true,
  tags: true,
};

const DEFAULT_WIDTHS = {
  title: 300,
  track: 40,
  duration: 60,
  artist: 150,
  album: 150,
  tags: 100,
};

/**
 * Load column settings from localStorage
 * @returns {{ visibility: Object, widths: Object }}
 */
function loadFromStorage() {
  if (typeof localStorage === 'undefined') {
    return { visibility: { ...DEFAULT_VISIBILITY }, widths: { ...DEFAULT_WIDTHS } };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        visibility: { ...DEFAULT_VISIBILITY, ...parsed.visibility },
        widths: { ...DEFAULT_WIDTHS, ...parsed.widths },
      };
    }
  } catch (e) {
    console.warn('Failed to load column settings from localStorage:', e);
  }

  return { visibility: { ...DEFAULT_VISIBILITY }, widths: { ...DEFAULT_WIDTHS } };
}

/**
 * Save column settings to localStorage
 * @param {{ visibility: Object, widths: Object }} settings
 */
function saveToStorage(settings) {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save column settings to localStorage:', e);
  }
}

// Initialize from storage and create signals inside createRoot
const {
  columnVisibility,
  setColumnVisibility,
  columnWidths,
  setColumnWidths,
  gridTemplateColumns,
} = createRoot(() => {
  const initialSettings = loadFromStorage();

  const [columnVisibility, setColumnVisibility] = createSignal(initialSettings.visibility);
  const [columnWidths, setColumnWidths] = createSignal(initialSettings.widths);

  const gridTemplateColumns = createMemo(() => {
    const vis = columnVisibility();
    const widths = columnWidths();

    const cols = [`${widths.title || 300}px`];  // Title is always visible

    if (vis.track) cols.push(`${widths.track || 40}px`);
    if (vis.duration) cols.push(`${widths.duration || 60}px`);
    if (vis.artist) cols.push(`${widths.artist || 150}px`);
    if (vis.album) cols.push(`${widths.album || 150}px`);
    // Tags is the last column: let it stretch to fill the remaining width (with a
    // sensible minimum) rather than sitting at a fixed ~100px with empty space
    // to its right.
    if (vis.tags) cols.push('minmax(100px, 1fr)');

    return cols.join(' ');
  });

  return {
    columnVisibility,
    setColumnVisibility,
    columnWidths,
    setColumnWidths,
    gridTemplateColumns,
  };
});

/**
 * Check if a column is visible
 * @param {string} column - Column name (track, duration, artist, album, tags)
 * @returns {boolean}
 */
function isColumnVisible(column) {
  return columnVisibility()[column] ?? true;
}

/**
 * Toggle visibility of a column
 * @param {string} column
 */
function toggleColumnVisibility(column) {
  setColumnVisibility(prev => {
    const next = { ...prev, [column]: !prev[column] };
    saveToStorage({ visibility: next, widths: columnWidths() });
    return next;
  });
}

/**
 * Set visibility for a specific column
 * @param {string} column
 * @param {boolean} visible
 */
function setColumnVisible(column, visible) {
  setColumnVisibility(prev => {
    const next = { ...prev, [column]: visible };
    saveToStorage({ visibility: next, widths: columnWidths() });
    return next;
  });
}

/**
 * Set all column visibility at once
 * @param {Object} visibility
 */
function setAllColumnVisibility(visibility) {
  setColumnVisibility({ ...DEFAULT_VISIBILITY, ...visibility });
  saveToStorage({ visibility: columnVisibility(), widths: columnWidths() });
}

/**
 * Get width of a column
 * @param {string} column
 * @returns {number|null}
 */
function getColumnWidth(column) {
  return columnWidths()[column] ?? null;
}

/**
 * Set width of a column
 * @param {string} column
 * @param {number} width
 */
function setColumnWidth(column, width) {
  setColumnWidths(prev => {
    const next = { ...prev, [column]: width };
    saveToStorage({ visibility: columnVisibility(), widths: next });
    return next;
  });
}

/**
 * Apply settings received from settings window (via IPC)
 * @param {{ visibility: Object, widths?: Object }} settings
 */
function applySettingsFromIPC(settings) {
  if (settings.visibility) {
    setColumnVisibility({ ...DEFAULT_VISIBILITY, ...settings.visibility });
  }
  if (settings.widths) {
    setColumnWidths({ ...DEFAULT_WIDTHS, ...settings.widths });
  }
  saveToStorage({ visibility: columnVisibility(), widths: columnWidths() });
}

export {
  // Signals
  columnVisibility,
  columnWidths,

  // Functions
  isColumnVisible,
  toggleColumnVisibility,
  setColumnVisible,
  setAllColumnVisibility,
  getColumnWidth,
  setColumnWidth,
  applySettingsFromIPC,

  // Computed
  gridTemplateColumns,
};
