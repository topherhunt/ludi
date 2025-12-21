// Howler is loaded via script tag in index.html
// Access it via window.Howl

// State
let currentListId = 0;
let expandedFolders = new Set();
let selectedItem = null;
let currentSound = null;
let isPlaying = false;
let currentPlaylist = [];
let currentTrackIndex = -1;

// DOM elements
const explorerTree = document.getElementById('explorerTree');
const playlistList = document.getElementById('playlistList');
const currentListTitle = document.getElementById('currentListTitle');
const currentSongTitle = document.getElementById('currentSongTitle');
const currentSongArtist = document.getElementById('currentSongArtist');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const seekBar = document.getElementById('seekBar');
const currentTime = document.getElementById('currentTime');
const totalTime = document.getElementById('totalTime');
const volumeSlider = document.getElementById('volumeSlider');
const muteBtn = document.getElementById('muteBtn');
const collapseAllBtn = document.getElementById('collapseAllBtn');
const expandAllBtn = document.getElementById('expandAllBtn');
const dropIndicator = document.getElementById('dropIndicator');

// Initialize
async function initialize() {
  await loadPlaylists();
  await loadListItems(currentListId);
  setupEventListeners();
}

// Load playlists (sidebar)
async function loadPlaylists() {
  const lists = await window.electronAPI.getLists();
  playlistList.innerHTML = '';

  lists.forEach(list => {
    const div = document.createElement('div');
    div.className = 'playlist-item';
    if (list.id === currentListId) {
      div.classList.add('active');
    }
    div.textContent = list.title;
    div.addEventListener('click', () => selectPlaylist(list.id, list.title));
    playlistList.appendChild(div);
  });
}

// Select a playlist
async function selectPlaylist(listId, title) {
  currentListId = listId;
  currentListTitle.textContent = title;
  await loadListItems(listId);
  await loadPlaylists(); // Refresh to update active state
}

// Load list items and render tree
async function loadListItems(listId) {
  const items = await window.electronAPI.getListItems(listId);
  explorerTree.innerHTML = '';
  explorerTree.dataset.listId = listId;

  items.forEach(item => {
    renderTreeItem(item, explorerTree);
  });
}

// Render a tree item
function renderTreeItem(item, parentElement) {
  const li = document.createElement('li');
  li.className = 'tree-item';
  li.dataset.itemId = item.id;

  const isFolder = item.list_id !== null;
  const icon = isFolder ? '▸' : '♪';

  const content = document.createElement('div');
  content.className = 'tree-item-content';
  content.dataset.itemId = item.id;
  content.dataset.isFolder = isFolder;
  if (isFolder) {
    content.dataset.folderId = item.list_id;
  } else {
    content.dataset.songId = item.song_id;
  }

  const iconSpan = document.createElement('span');
  iconSpan.className = isFolder ? 'tree-item-icon chevron' : 'tree-item-icon';
  iconSpan.textContent = icon;

  const label = document.createElement('span');
  label.className = 'tree-item-label';
  label.textContent = isFolder ? item.list_title : item.song_title;

  content.appendChild(iconSpan);
  content.appendChild(label);

  if (!isFolder && item.duration_seconds) {
    const duration = document.createElement('span');
    duration.className = 'tree-item-duration';
    duration.textContent = formatTime(item.duration_seconds);
    content.appendChild(duration);
  }

  li.appendChild(content);

  // Add children container for folders
  if (isFolder) {
    const children = document.createElement('ul');
    children.className = 'tree-item-children';
    children.dataset.listId = item.list_id;
    li.appendChild(children);

    // Chevron click to expand/collapse
    iconSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFolder(item.list_id, iconSpan, children);
    });
  }

  // Double-click to play
  content.addEventListener('dblclick', () => {
    if (isFolder) {
      playFolder(item.list_id);
    } else {
      playSong(item.song_id);
    }
  });

  // Right-click context menu
  content.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, item);
  });

  // Drag and drop
  content.draggable = true;
  content.addEventListener('dragstart', handleDragStart);
  content.addEventListener('dragover', handleDragOver);
  content.addEventListener('drop', handleDrop);
  content.addEventListener('dragend', handleDragEnd);

  parentElement.appendChild(li);
}

// Toggle folder expansion
async function toggleFolder(listId, iconElement, childrenElement) {
  if (expandedFolders.has(listId)) {
    // Collapse
    expandedFolders.delete(listId);
    iconElement.classList.remove('expanded');
    childrenElement.classList.remove('expanded');
  } else {
    // Expand
    expandedFolders.add(listId);
    iconElement.classList.add('expanded');
    childrenElement.classList.add('expanded');

    // Load children if not already loaded
    if (childrenElement.children.length === 0) {
      const items = await window.electronAPI.getListItems(listId);
      items.forEach(item => {
        renderTreeItem(item, childrenElement);
      });
    }
  }
}

// Collapse all folders
function collapseAll() {
  expandedFolders.clear();
  document.querySelectorAll('.tree-item-icon.chevron').forEach(icon => {
    icon.classList.remove('expanded');
  });
  document.querySelectorAll('.tree-item-children').forEach(children => {
    children.classList.remove('expanded');
  });
}

// Expand all folders
async function expandAll() {
  const allFolders = document.querySelectorAll('[data-folder-id]');
  for (const folderElement of allFolders) {
    const folderId = parseInt(folderElement.dataset.folderId);
    const iconElement = folderElement.querySelector('.tree-item-icon.chevron');
    const childrenElement = folderElement.parentElement.querySelector('.tree-item-children');

    if (!expandedFolders.has(folderId)) {
      await toggleFolder(folderId, iconElement, childrenElement);
    }
  }
}

// Context menu
function showContextMenu(x, y, item) {
  // Remove existing context menu
  const existing = document.querySelector('.context-menu');
  if (existing) {
    existing.remove();
  }

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const isFolder = item.list_id !== null;

  // Add folder inside (for folders)
  if (isFolder) {
    const addFolderInside = document.createElement('div');
    addFolderInside.className = 'context-menu-item';
    addFolderInside.textContent = 'Add Folder Inside';
    addFolderInside.addEventListener('click', () => {
      addFolder(item.list_id, 0, 'New Folder');
      menu.remove();
    });
    menu.appendChild(addFolderInside);
  }

  // Add folder after
  const addFolderAfter = document.createElement('div');
  addFolderAfter.className = 'context-menu-item';
  addFolderAfter.textContent = 'Add Folder After';
  addFolderAfter.addEventListener('click', () => {
    addFolder(item.parent_list_id, item.position + 1, 'New Folder');
    menu.remove();
  });
  menu.appendChild(addFolderAfter);

  if (isFolder) {
    menu.appendChild(createSeparator());

    // Play this folder
    const playFolder = document.createElement('div');
    playFolder.className = 'context-menu-item';
    playFolder.textContent = 'Play This Folder';
    playFolder.addEventListener('click', () => {
      playFolder(item.list_id);
      menu.remove();
    });
    menu.appendChild(playFolder);

    menu.appendChild(createSeparator());

    // Collapse all
    const collapseAllItem = document.createElement('div');
    collapseAllItem.className = 'context-menu-item';
    collapseAllItem.textContent = 'Collapse All';
    collapseAllItem.addEventListener('click', () => {
      collapseAll();
      menu.remove();
    });
    menu.appendChild(collapseAllItem);

    // Expand all
    const expandAllItem = document.createElement('div');
    expandAllItem.className = 'context-menu-item';
    expandAllItem.textContent = 'Expand All';
    expandAllItem.addEventListener('click', () => {
      expandAll();
      menu.remove();
    });
    menu.appendChild(expandAllItem);
  }

  menu.appendChild(createSeparator());

  // Delete
  const deleteItem = document.createElement('div');
  deleteItem.className = 'context-menu-item';
  deleteItem.textContent = 'Delete';
  deleteItem.addEventListener('click', async () => {
    await window.electronAPI.deleteItem(item.id);
    await loadListItems(currentListId);
    menu.remove();
  });
  menu.appendChild(deleteItem);

  document.body.appendChild(menu);

  // Close menu on click outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
  }, 0);
}

function createSeparator() {
  const sep = document.createElement('div');
  sep.className = 'context-menu-separator';
  return sep;
}

// Add folder
async function addFolder(parentListId, position, title) {
  await window.electronAPI.addFolder({ parentListId, position, title });
  await loadListItems(currentListId);
}

// Drag and drop handlers
let draggedItem = null;

function handleDragStart(e) {
  draggedItem = e.target;
  e.dataTransfer.effectAllowed = 'move';
  e.target.style.opacity = '0.5';
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';

  // Show drop indicator
  const rect = e.target.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const dropPosition = e.clientY < midpoint ? 'before' : 'after';

  dropIndicator.style.top = (dropPosition === 'before' ? rect.top : rect.bottom) + 'px';
  dropIndicator.classList.add('visible');

  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  // TODO: Implement actual drop logic with position calculation
  // This is a placeholder - full drag-drop implementation requires:
  // 1. Calculate drop position (before/after, or inside for folders)
  // 2. Call moveItem API
  // 3. Refresh the tree

  dropIndicator.classList.remove('visible');
  return false;
}

function handleDragEnd(e) {
  e.target.style.opacity = '1';
  dropIndicator.classList.remove('visible');
}

// Playback functions
async function playSong(songId) {
  const song = await window.electronAPI.getSong(songId);
  if (!song) return;

  // Stop current playback
  if (currentSound) {
    currentSound.unload();
  }

  currentSound = new Howl({
    src: [song.file_path],
    html5: true,
    onplay: () => {
      isPlaying = true;
      playPauseBtn.textContent = '⏸';
      updatePlayerUI(song);
    },
    onend: () => {
      playNext();
    },
    onpause: () => {
      isPlaying = false;
      playPauseBtn.textContent = '▶';
    }
  });

  currentSound.play();
  playPauseBtn.disabled = false;
  seekBar.disabled = false;
}

async function playFolder(folderId) {
  // Build a flat playlist from the folder (depth-first)
  currentPlaylist = await buildPlaylistFromFolder(folderId);
  if (currentPlaylist.length > 0) {
    currentTrackIndex = 0;
    await playSong(currentPlaylist[0]);
    updateNavigationButtons();
  }
}

async function buildPlaylistFromFolder(folderId) {
  const playlist = [];
  const items = await window.electronAPI.getListItems(folderId);

  for (const item of items) {
    if (item.song_id) {
      playlist.push(item.song_id);
    } else if (item.list_id) {
      // Recursively get songs from subfolder
      const subPlaylist = await buildPlaylistFromFolder(item.list_id);
      playlist.push(...subPlaylist);
    }
  }

  return playlist;
}

function updatePlayerUI(song) {
  currentSongTitle.textContent = song.title;
  currentSongArtist.textContent = song.artist || song.album || '';
  totalTime.textContent = formatTime(song.duration_seconds);

  // Update seek bar as song plays
  if (currentSound) {
    const updateSeek = () => {
      if (currentSound && isPlaying) {
        const seek = currentSound.seek() || 0;
        seekBar.value = (seek / song.duration_seconds) * 100;
        currentTime.textContent = formatTime(Math.floor(seek));
        requestAnimationFrame(updateSeek);
      }
    };
    updateSeek();
  }
}

function updateNavigationButtons() {
  prevBtn.disabled = currentTrackIndex <= 0;
  nextBtn.disabled = currentTrackIndex >= currentPlaylist.length - 1;
}

function playPause() {
  if (!currentSound) return;

  if (isPlaying) {
    currentSound.pause();
  } else {
    currentSound.play();
  }
}

function playPrevious() {
  if (currentTrackIndex > 0) {
    currentTrackIndex--;
    playSong(currentPlaylist[currentTrackIndex]);
    updateNavigationButtons();
  }
}

function playNext() {
  if (currentTrackIndex < currentPlaylist.length - 1) {
    currentTrackIndex++;
    playSong(currentPlaylist[currentTrackIndex]);
    updateNavigationButtons();
  } else {
    // End of playlist
    isPlaying = false;
    playPauseBtn.textContent = '▶';
  }
}

function seek(percentage) {
  if (currentSound) {
    const duration = currentSound.duration();
    currentSound.seek(duration * (percentage / 100));
  }
}

function setVolume(value) {
  if (currentSound) {
    currentSound.volume(value / 100);
  }
}

function toggleMute() {
  if (currentSound) {
    const isMuted = currentSound.volume() === 0;
    if (isMuted) {
      currentSound.volume(volumeSlider.value / 100);
      muteBtn.textContent = '🔊';
    } else {
      currentSound.volume(0);
      muteBtn.textContent = '🔇';
    }
  }
}

// Utility functions
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Event listeners
function setupEventListeners() {
  playPauseBtn.addEventListener('click', playPause);
  prevBtn.addEventListener('click', playPrevious);
  nextBtn.addEventListener('click', playNext);

  seekBar.addEventListener('input', (e) => {
    seek(e.target.value);
  });

  volumeSlider.addEventListener('input', (e) => {
    setVolume(e.target.value);
  });

  muteBtn.addEventListener('click', toggleMute);
  collapseAllBtn.addEventListener('click', collapseAll);
  expandAllBtn.addEventListener('click', expandAll);

  // Setup drag-and-drop for external files on explorer tree
  explorerTree.addEventListener('drop', handleExplorerTreeDrop);
  explorerTree.addEventListener('dragover', handleExplorerTreeDragOver);
  explorerTree.addEventListener('dragleave', handleDragLeave);

  // Setup drag-and-drop for playlist sidebar items
  playlistList.addEventListener('drop', handlePlaylistSidebarDrop);
  playlistList.addEventListener('dragover', handlePlaylistSidebarDragOver);
  playlistList.addEventListener('dragleave', handleDragLeave);
}

let dropTarget = null;
let dropPosition = 0;

async function handleExplorerTreeDragOver(e) {
  // Only handle external file drops
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Find the tree item content we're hovering over
    const treeItemContent = e.target.closest('.tree-item-content');
    if (treeItemContent) {
      const rect = treeItemContent.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midpoint;

      dropIndicator.style.top = (insertBefore ? rect.top : rect.bottom) + 'px';
      dropIndicator.classList.add('visible');

      dropTarget = treeItemContent;
      dropPosition = insertBefore ? 0 : 1;
    } else {
      // Dropping in empty space at the end of the list
      const lastItem = explorerTree.querySelector('.tree-item-content:last-child');
      if (lastItem) {
        const rect = lastItem.getBoundingClientRect();
        dropIndicator.style.top = rect.bottom + 'px';
      }
      dropIndicator.classList.add('visible');
      dropTarget = null;
    }
  }
}

async function handlePlaylistSidebarDragOver(e) {
  // Only handle external file drops
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}

function handleDragLeave(e) {
  // Only hide indicator if we're leaving the drop zone entirely
  if (!e.currentTarget.contains(e.relatedTarget)) {
    dropIndicator.classList.remove('visible');
  }
}

async function handleExplorerTreeDrop(e) {
  e.preventDefault();
  dropIndicator.classList.remove('visible');

  // Only handle external file drops
  if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) {
    return;
  }

  // Get file paths
  const filePaths = Array.from(e.dataTransfer.files).map(file => file.path);

  // Calculate insertion position
  let parentListId = currentListId;
  let position = 0;

  if (dropTarget) {
    const itemId = parseInt(dropTarget.dataset.itemId);
    const targetItem = await getItemById(itemId);
    if (targetItem) {
      parentListId = targetItem.parent_list_id;
      position = dropPosition === 0 ? targetItem.position : targetItem.position + 1;
    }
  } else {
    // Dropping at the end
    const items = await window.electronAPI.getListItems(currentListId);
    position = items.length;
  }

  // Import files
  const results = await window.electronAPI.importFiles({
    filePaths,
    parentListId,
    position
  });

  // Show warnings for unsupported files
  if (results.unsupported.length > 0) {
    alert(`Unsupported file types (ignored):\n${results.unsupported.join('\n')}\n\nSupported formats: .mp3, .m4a, .ogg`);
  }

  // Show errors
  if (results.errors.length > 0) {
    console.error('Import errors:', results.errors);
    alert(`Errors importing ${results.errors.length} file(s). Check console for details.`);
  }

  // Refresh the list
  await loadListItems(currentListId);

  dropTarget = null;
}

async function handlePlaylistSidebarDrop(e) {
  e.preventDefault();

  // Only handle external file drops
  if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) {
    return;
  }

  // Find which playlist was dropped on
  const playlistItem = e.target.closest('.playlist-item');
  if (!playlistItem) {
    return;
  }

  // Get the list ID (Main Library is always 0)
  const listId = 0; // For now, we only have Main Library

  // Get file paths
  const filePaths = Array.from(e.dataTransfer.files).map(file => file.path);

  // Get current items to find the end position
  const items = await window.electronAPI.getListItems(listId);
  const position = items.length;

  // Import files at the end of the list
  const results = await window.electronAPI.importFiles({
    filePaths,
    parentListId: listId,
    position
  });

  // Show warnings for unsupported files
  if (results.unsupported.length > 0) {
    alert(`Unsupported file types (ignored):\n${results.unsupported.join('\n')}\n\nSupported formats: .mp3, .m4a, .ogg`);
  }

  // Show errors
  if (results.errors.length > 0) {
    console.error('Import errors:', results.errors);
    alert(`Errors importing ${results.errors.length} file(s). Check console for details.`);
  }

  // Refresh the list if we're viewing Main Library
  if (currentListId === listId) {
    await loadListItems(currentListId);
  }
}

// Helper function to get item by ID
async function getItemById(itemId) {
  const items = await window.electronAPI.getListItems(currentListId);
  return items.find(item => item.id === itemId);
}

// Initialize the app
initialize();
