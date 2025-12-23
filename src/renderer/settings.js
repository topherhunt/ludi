// DOM elements
const databasePathInput = document.getElementById('databasePath');
const libraryPathInput = document.getElementById('libraryPath');
const browseBtn = document.getElementById('browseBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

// Column visibility checkboxes
const colTrack = document.getElementById('colTrack');
const colDuration = document.getElementById('colDuration');
const colArtist = document.getElementById('colArtist');
const colAlbum = document.getElementById('colAlbum');
const colTags = document.getElementById('colTags');

let originalSettings = {};

// Load settings on init
async function loadSettings() {
  const settings = await window.electronAPI.getSettings();
  originalSettings = { ...settings };

  databasePathInput.value = settings.database_path || '';
  libraryPathInput.value = settings.library_path || '';

  // Load column visibility from localStorage
  const columnSettings = loadColumnSettings();
  colTrack.checked = columnSettings.visibility.track;
  colDuration.checked = columnSettings.visibility.duration;
  colArtist.checked = columnSettings.visibility.artist;
  colAlbum.checked = columnSettings.visibility.album;
  colTags.checked = columnSettings.visibility.tags;
}

function loadColumnSettings() {
  const defaults = {
    visibility: {
      track: true,
      duration: true,
      artist: true,
      album: true,
      tags: true
    },
    widths: {}
  };

  const saved = localStorage.getItem('ludi-column-settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return { ...defaults, ...parsed, visibility: { ...defaults.visibility, ...parsed.visibility } };
    } catch (e) {
      return defaults;
    }
  }
  return defaults;
}

function saveColumnSettings(visibility) {
  const current = loadColumnSettings();
  current.visibility = visibility;
  localStorage.setItem('ludi-column-settings', JSON.stringify(current));
}

// Browse for library path
browseBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.selectDirectory();
  if (result) {
    libraryPathInput.value = result;
  }
});

// Cancel button
cancelBtn.addEventListener('click', () => {
  window.electronAPI.closeSettings();
});

// Save button
saveBtn.addEventListener('click', async () => {
  const newSettings = {
    library_path: libraryPathInput.value
  };

  // Save column visibility
  const visibility = {
    track: colTrack.checked,
    duration: colDuration.checked,
    artist: colArtist.checked,
    album: colAlbum.checked,
    tags: colTags.checked
  };
  saveColumnSettings(visibility);

  // Notify main window with the column settings data (localStorage is not shared between windows)
  const columnSettingsData = loadColumnSettings();
  await window.electronAPI.notifyColumnSettingsChanged(columnSettingsData);

  await window.electronAPI.saveSettings(newSettings);
  window.electronAPI.closeSettings();
});

// Initialize
loadSettings();
