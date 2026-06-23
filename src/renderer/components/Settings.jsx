import { createSignal, createResource, onMount, onCleanup, Show } from 'solid-js';
import { AlertModal } from './Modal.jsx';
import { ScanResultsModal } from './ScanResultsModal.jsx';
import { showAlert, alertModalState, hideAlertModal } from '../stores/modals.js';

/**
 * Load column settings from localStorage
 */
function loadColumnSettings() {
  const defaults = {
    visibility: {
      track: true,
      duration: true,
      artist: true,
      album: true,
      tags: true,
    },
    widths: {},
  };

  if (typeof localStorage === 'undefined') return defaults;

  const saved = localStorage.getItem('ludi-column-settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return {
        ...defaults,
        ...parsed,
        visibility: { ...defaults.visibility, ...parsed.visibility },
      };
    } catch (e) {
      return defaults;
    }
  }
  return defaults;
}

/**
 * Save column settings to localStorage
 */
function saveColumnSettings(visibility) {
  const current = loadColumnSettings();
  current.visibility = visibility;
  localStorage.setItem('ludi-column-settings', JSON.stringify(current));
}

/**
 * Settings window component
 */
export function Settings() {
  // Settings state
  const [databasePath, setDatabasePath] = createSignal('');
  const [libraryPath, setLibraryPath] = createSignal('');

  // Column visibility state
  const [colTrack, setColTrack] = createSignal(true);
  const [colDuration, setColDuration] = createSignal(true);
  const [colArtist, setColArtist] = createSignal(true);
  const [colAlbum, setColAlbum] = createSignal(true);
  const [colTags, setColTags] = createSignal(true);

  // Library scan state
  const [scanning, setScanning] = createSignal(false);
  const [scanModalOpen, setScanModalOpen] = createSignal(false);
  const [scannedFiles, setScannedFiles] = createSignal([]);

  // Load settings on mount
  onMount(async () => {
    // Load app settings
    const settings = await window.electronAPI?.getSettings?.() || {};
    setDatabasePath(settings.database_path || '');
    setLibraryPath(settings.library_path || '');

    // Load column visibility from localStorage
    const columnSettings = loadColumnSettings();
    setColTrack(columnSettings.visibility.track);
    setColDuration(columnSettings.visibility.duration);
    setColArtist(columnSettings.visibility.artist);
    setColAlbum(columnSettings.visibility.album);
    setColTags(columnSettings.visibility.tags);
  });

  // Handle browse button
  const handleBrowse = async () => {
    const result = await window.electronAPI?.selectDirectory?.();
    if (result) {
      setLibraryPath(result);
    }
  };

  // Show database path in Finder
  const handleShowDbInFinder = () => {
    window.electronAPI?.showInFinder?.(databasePath());
  };

  // Show library path in Finder
  const handleShowLibraryInFinder = () => {
    window.electronAPI?.showInFinder?.(libraryPath());
  };

  // Scan the library folder for audio files not yet in the database
  const handleScan = async () => {
    setScanning(true);
    try {
      const files = await window.electronAPI?.scanLibraryForNewFiles?.() || [];
      if (files.length === 0) {
        showAlert(
          '<i class="bi bi-search" style="margin-right: 8px;"></i>Scan Complete',
          '<p>No new files found in your library folder.</p>'
        );
      } else {
        setScannedFiles(files);
        setScanModalOpen(true);
      }
    } finally {
      setScanning(false);
    }
  };

  // Import all scanned files in place, then show a summary
  const handleImportAll = async () => {
    const files = scannedFiles();
    setScanModalOpen(false);

    const result = await window.electronAPI?.ingestFilesInPlace?.(files) || { imported: [], errors: [] };
    const imported = result.imported || [];
    const errors = result.errors || [];

    let html = `<p>Imported ${imported.length} file${imported.length === 1 ? '' : 's'} into your library.</p>`;
    if (imported.length > 0) {
      const list = imported.map(s => `<li>${s.file_path}</li>`).join('');
      html += `<div class="skipped-files-list"><ul>${list}</ul></div>`;
    }
    if (errors.length > 0) {
      const list = errors.map(e => `<li>${e.file}: ${e.error}</li>`).join('');
      html += `<p>${errors.length} file${errors.length === 1 ? '' : 's'} could not be imported:</p>`;
      html += `<div class="skipped-files-list"><ul>${list}</ul></div>`;
    }

    setScannedFiles([]);
    showAlert(
      '<i class="bi bi-check-circle" style="margin-right: 8px;"></i>Import Summary',
      html,
      'scan-results-dialog'
    );
  };

  // Cancel the scan results modal without importing
  const handleCancelScan = () => {
    setScanModalOpen(false);
    setScannedFiles([]);
  };

  // Handle cancel button
  const handleCancel = () => {
    window.electronAPI?.closeSettings?.();
  };

  // Handle save button
  const handleSave = async () => {
    // Save app settings
    const newSettings = {
      library_path: libraryPath(),
    };

    // Save column visibility
    const visibility = {
      track: colTrack(),
      duration: colDuration(),
      artist: colArtist(),
      album: colAlbum(),
      tags: colTags(),
    };
    saveColumnSettings(visibility);

    // Notify main window with the column settings data
    const columnSettingsData = loadColumnSettings();
    await window.electronAPI?.notifyColumnSettingsChanged?.(columnSettingsData);

    await window.electronAPI?.saveSettings?.(newSettings);
    window.electronAPI?.closeSettings?.();
  };

  // Handle Escape key to save and close
  onMount(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        // Let an open modal handle Escape itself instead of closing Settings.
        if (scanModalOpen() || alertModalState().isOpen) return;
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <div class="settings-container">
      <header class="settings-header">
        <h1>Settings</h1>
      </header>

      <div class="settings-content">
        <div class="setting-item">
          <label class="setting-label">Database path</label>
          <div class="setting-description">
            Location where Ludi stores your library database
          </div>
          <input
            type="text"
            id="databasePath"
            class="setting-input"
            value={databasePath()}
            readonly
          />
          <button class="browse-btn" onClick={handleShowDbInFinder}>
            Show in Finder
          </button>
        </div>

        <div class="setting-item">
          <label class="setting-label">Library path</label>
          <div class="setting-description">
            Location where audio files are stored
          </div>
          <input
            type="text"
            id="libraryPath"
            class="setting-input"
            value={libraryPath()}
            onInput={(e) => setLibraryPath(e.target.value)}
          />
          <div class="button-row">
            <button id="browseBtn" class="browse-btn" onClick={handleBrowse}>
              Browse...
            </button>
            <button class="browse-btn" onClick={handleShowLibraryInFinder}>
              Show in Finder
            </button>
          </div>
        </div>

        <div class="setting-item">
          <label class="setting-label">Library scan</label>
          <div class="setting-description">
            Find audio files in your library folder that aren't in your library yet, and import them in place.
          </div>
          <button
            class="browse-btn qa-scan-library"
            onClick={handleScan}
            disabled={scanning()}
          >
            {scanning() ? 'Scanning...' : 'Scan for new music files in library folder'}
          </button>
        </div>

        <div class="setting-item">
          <label class="setting-label">Visible columns</label>
          <div class="setting-description">
            Choose which columns to display in the playlist view
          </div>
          <div class="checkbox-group">
            <label class="checkbox-label">
              <input
                type="checkbox"
                id="colTrack"
                checked={colTrack()}
                onChange={(e) => setColTrack(e.target.checked)}
              />
              {' #'}
            </label>
            <label class="checkbox-label">
              <input
                type="checkbox"
                id="colDuration"
                checked={colDuration()}
                onChange={(e) => setColDuration(e.target.checked)}
              />
              {' Time'}
            </label>
            <label class="checkbox-label">
              <input
                type="checkbox"
                id="colArtist"
                checked={colArtist()}
                onChange={(e) => setColArtist(e.target.checked)}
              />
              {' Artist'}
            </label>
            <label class="checkbox-label">
              <input
                type="checkbox"
                id="colAlbum"
                checked={colAlbum()}
                onChange={(e) => setColAlbum(e.target.checked)}
              />
              {' Album'}
            </label>
            <label class="checkbox-label">
              <input
                type="checkbox"
                id="colTags"
                checked={colTags()}
                onChange={(e) => setColTags(e.target.checked)}
              />
              {' Tags'}
            </label>
          </div>
        </div>
      </div>

      <footer class="settings-footer">
        <button id="cancelBtn" class="btn btn-secondary" onClick={handleCancel}>
          Cancel
        </button>
        <button id="saveBtn" class="btn btn-primary" onClick={handleSave}>
          Save
        </button>
      </footer>

      {/* Scan results modal (lists files to import in place) */}
      <ScanResultsModal
        open={scanModalOpen()}
        files={scannedFiles()}
        onImportAll={handleImportAll}
        onCancel={handleCancelScan}
      />

      {/* Alert modal host (no-files-found and import summary) */}
      <Show when={alertModalState().isOpen}>
        <AlertModal
          open={true}
          title={alertModalState().title}
          message={alertModalState().message}
          dialogClass={alertModalState().dialogClass}
          onClose={hideAlertModal}
        />
      </Show>
    </div>
  );
}
