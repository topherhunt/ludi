// DOM elements
const databasePathInput = document.getElementById('databasePath');
const libraryPathInput = document.getElementById('libraryPath');
const browseBtn = document.getElementById('browseBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

let originalSettings = {};

// Load settings on init
async function loadSettings() {
  const settings = await window.electronAPI.getSettings();
  originalSettings = { ...settings };

  databasePathInput.value = settings.database_path || '';
  libraryPathInput.value = settings.library_path || '';
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

  await window.electronAPI.saveSettings(newSettings);
  window.electronAPI.closeSettings();
});

// Initialize
loadSettings();
