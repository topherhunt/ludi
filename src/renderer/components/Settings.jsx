import { createSignal, createResource, onMount } from 'solid-js';

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
          <button id="browseBtn" class="browse-btn" onClick={handleBrowse}>
            Browse...
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
    </div>
  );
}
