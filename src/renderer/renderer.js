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
let currentPlayingSongId = null;
let shuffleEnabled = false;
let loopMode = 'off'; // 'off', 'all', 'one'
let shuffledIndices = []; // For shuffle mode, maps play order to actual playlist indices

// Expose state for testing
window.shuffleEnabled = shuffleEnabled;
window.loopMode = loopMode;

// DOM elements
const explorerContainer = document.getElementById('explorerContainer');
const explorerTree = document.getElementById('explorerTree');
const playlistList = document.getElementById('playlistList');
const currentListTitle = document.getElementById('currentListTitle');
const currentSongTitle = document.getElementById('currentSongTitle');
const currentSongArtist = document.getElementById('currentSongArtist');
const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const loopBtn = document.getElementById('loopBtn');
const seekBar = document.getElementById('seekBar');
const currentTime = document.getElementById('currentTime');
const totalTime = document.getElementById('totalTime');
const volumeSlider = document.getElementById('volumeSlider');
const muteBtn = document.getElementById('muteBtn');
const collapseAllBtn = document.getElementById('collapseAllBtn');
const expandAllBtn = document.getElementById('expandAllBtn');
const dropIndicator = document.getElementById('dropIndicator');
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');
const modalOkBtn = document.getElementById('modalOkBtn');

// Modal dialog helper
function showModal(message) {
  modalContent.textContent = message;
  modalOverlay.classList.add('visible');
}

function hideModal() {
  modalOverlay.classList.remove('visible');
}

modalOkBtn.addEventListener('click', hideModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) {
    hideModal();
  }
});

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
  const isPlaying = !isFolder && item.song_id === currentPlayingSongId;
  const icon = isFolder ? '▸' : (isPlaying ? '▶' : '♪');

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
  if (isPlaying) {
    iconSpan.classList.add('playing');
  }
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
  content.addEventListener('dblclick', async () => {
    if (isFolder) {
      playFolder(item.list_id);
    } else {
      // When playing a song, build the playlist from the current list context
      await playSongInContext(item.song_id, item.parent_list_id);
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
  // If this is an external file drop, don't handle it here - let it bubble to container
  if (e.dataTransfer.types.includes('Files')) {
    return; // Let the container handler deal with file drops
  }

  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';

  // Get the container's position for coordinate conversion
  const containerRect = explorerContainer.getBoundingClientRect();

  // Find the closest tree-item-content
  const targetContent = e.target.closest('.tree-item-content');

  if (!targetContent) {
    // This shouldn't happen since this handler is on items, but just in case
    return false;
  }

  // Don't allow dropping on itself
  if (draggedItem === targetContent) {
    dropIndicator.classList.remove('visible');
    return false;
  }

  // Show drop indicator
  const rect = targetContent.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const insertBefore = e.clientY < midpoint;

  // Convert viewport coordinates to container-relative coordinates
  const relativeTop = (insertBefore ? rect.top : rect.bottom) - containerRect.top + explorerContainer.scrollTop;
  dropIndicator.style.top = relativeTop + 'px';
  dropIndicator.classList.add('visible');

  return false;
}

async function handleDrop(e) {
  // If this is an external file drop, don't handle it here - let it bubble to container
  if (e.dataTransfer.types.includes('Files')) {
    return; // Let the container handler deal with file drops
  }

  if (e.stopPropagation) {
    e.stopPropagation();
  }

  dropIndicator.classList.remove('visible');

  if (!draggedItem) {
    return false;
  }

  // Get dragged item info
  const draggedItemId = parseInt(draggedItem.dataset.itemId);

  // Find the target content
  const targetContent = e.target.closest('.tree-item-content');

  if (!targetContent || draggedItem === targetContent) {
    return false;
  }

  // Get target item info
  const targetItemId = parseInt(targetContent.dataset.itemId);

  // Calculate drop position (before or after target)
  const rect = targetContent.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const insertBefore = e.clientY < midpoint;

  try {
    // Get both items from the backend to determine their positions
    const draggedItemData = await getItemById(draggedItemId);
    const targetItemData = await getItemById(targetItemId);

    if (!draggedItemData || !targetItemData) {
      console.error('Could not find item data');
      return false;
    }

    // Calculate new position
    let newParentListId = targetItemData.parent_list_id;
    let newPosition = insertBefore ? targetItemData.position : targetItemData.position + 1;

    // If dragging within same parent and moving down, adjust for the item being removed
    if (draggedItemData.parent_list_id === newParentListId &&
        draggedItemData.position < newPosition) {
      newPosition--;
    }

    // Call the moveItem API
    await window.electronAPI.moveItem({
      itemId: draggedItemId,
      newParentListId,
      newPosition
    });

    // Refresh the tree
    await loadListItems(currentListId);
  } catch (error) {
    console.error('Error moving item:', error);
  }

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

  // Update currently playing song ID
  currentPlayingSongId = songId;

  // Stop current playback
  if (currentSound) {
    currentSound.unload();
  }

  // Convert file path to file:// URL for Howler
  const fileUrl = 'file://' + song.file_path.replace(/\\/g, '/');

  currentSound = new Howl({
    src: [fileUrl],
    html5: true,
    onplay: () => {
      isPlaying = true;
      playPauseBtn.textContent = '⏸';
      updatePlayerUI(song);
      // Refresh tree to update playing indicator
      loadListItems(currentListId);
    },
    onend: () => {
      playNext();
    },
    onpause: () => {
      isPlaying = false;
      playPauseBtn.textContent = '▶';
    },
    onloaderror: (id, error) => {
      console.error('Error loading audio:', error, 'Path:', fileUrl);
    },
    onplayerror: (id, error) => {
      console.error('Error playing audio:', error, 'Path:', fileUrl);
    }
  });

  currentSound.play();
  playPauseBtn.disabled = false;
  seekBar.disabled = false;
}

async function playSongInContext(songId, parentListId) {
  // Build the playlist from the parent list
  currentPlaylist = await buildPlaylistFromFolder(parentListId);

  if (currentPlaylist.length > 0) {
    // Find the index of this song in the playlist
    const songIndex = currentPlaylist.findIndex(id => id === songId);

    if (songIndex === -1) {
      // Song not found, just play it standalone
      await playSong(songId);
      return;
    }

    // Apply shuffle if enabled
    if (shuffleEnabled) {
      shuffledIndices = shuffleArray([...Array(currentPlaylist.length).keys()]);
      // Find where our song ended up in the shuffle
      currentTrackIndex = shuffledIndices.findIndex(idx => idx === songIndex);
    } else {
      shuffledIndices = [];
      currentTrackIndex = songIndex;
    }

    const playingSongId = getCurrentSongId(currentTrackIndex);
    await playSong(playingSongId);
    updateNavigationButtons();
  }
}

async function playFolder(folderId) {
  // Build a flat playlist from the folder (depth-first)
  currentPlaylist = await buildPlaylistFromFolder(folderId);
  if (currentPlaylist.length > 0) {
    currentTrackIndex = 0;

    // Apply shuffle if enabled
    if (shuffleEnabled) {
      shuffledIndices = shuffleArray([...Array(currentPlaylist.length).keys()]);
    } else {
      shuffledIndices = [];
    }

    const songId = getCurrentSongId(0);
    await playSong(songId);
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

// Shuffle function - Fisher-Yates shuffle
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Apply or remove shuffle
function applyShuffleToPlaylist() {
  if (shuffleEnabled && currentPlaylist.length > 0) {
    // Create shuffled indices
    shuffledIndices = shuffleArray([...Array(currentPlaylist.length).keys()]);

    // Find where the current song is in the shuffled order
    if (currentTrackIndex >= 0) {
      const currentSongId = currentPlaylist[currentTrackIndex];
      const newIndex = shuffledIndices.findIndex(idx => idx === currentTrackIndex);
      currentTrackIndex = newIndex;
    }
  } else {
    // Restore original order
    if (shuffledIndices.length > 0 && currentTrackIndex >= 0) {
      // Map back from shuffled index to original index
      currentTrackIndex = shuffledIndices[currentTrackIndex];
    }
    shuffledIndices = [];
  }
  updateNavigationButtons();
}

// Get the actual song ID based on current play mode
function getCurrentSongId(playIndex) {
  if (shuffleEnabled && shuffledIndices.length > 0) {
    const actualIndex = shuffledIndices[playIndex];
    return currentPlaylist[actualIndex];
  }
  return currentPlaylist[playIndex];
}

// Toggle shuffle
function toggleShuffle() {
  shuffleEnabled = !shuffleEnabled;
  window.shuffleEnabled = shuffleEnabled; // Expose for testing
  shuffleBtn.classList.toggle('active', shuffleEnabled);
  applyShuffleToPlaylist();
}

// Toggle loop mode
function toggleLoop() {
  if (loopMode === 'off') {
    loopMode = 'all';
    loopBtn.classList.add('active');
    loopBtn.title = 'Loop: All';
  } else if (loopMode === 'all') {
    loopMode = 'one';
    loopBtn.textContent = '🔂';
    loopBtn.title = 'Loop: One';
  } else {
    loopMode = 'off';
    loopBtn.classList.remove('active');
    loopBtn.textContent = '🔁';
    loopBtn.title = 'Loop: Off';
  }
  window.loopMode = loopMode; // Expose for testing
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
    const songId = getCurrentSongId(currentTrackIndex);
    playSong(songId);
    updateNavigationButtons();
  }
}

function playNext() {
  // Handle loop one mode - replay the same song
  if (loopMode === 'one') {
    const songId = getCurrentSongId(currentTrackIndex);
    playSong(songId);
    return;
  }

  // Move to next track
  if (currentTrackIndex < currentPlaylist.length - 1) {
    currentTrackIndex++;
    const songId = getCurrentSongId(currentTrackIndex);
    playSong(songId);
    updateNavigationButtons();
  } else {
    // End of playlist
    if (loopMode === 'all') {
      // Loop back to the beginning
      currentTrackIndex = 0;
      const songId = getCurrentSongId(currentTrackIndex);
      playSong(songId);
      updateNavigationButtons();
    } else {
      // Stop playback
      isPlaying = false;
      playPauseBtn.textContent = '▶';
      currentPlayingSongId = null;
      loadListItems(currentListId);
    }
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
  shuffleBtn.addEventListener('click', toggleShuffle);
  loopBtn.addEventListener('click', toggleLoop);

  seekBar.addEventListener('input', (e) => {
    seek(e.target.value);
  });

  volumeSlider.addEventListener('input', (e) => {
    setVolume(e.target.value);
  });

  muteBtn.addEventListener('click', toggleMute);
  collapseAllBtn.addEventListener('click', collapseAll);
  expandAllBtn.addEventListener('click', expandAll);

  // Setup drag-and-drop on explorer container (handles both external files and internal items, including empty space)
  explorerContainer.addEventListener('drop', handleExplorerTreeDrop);
  explorerContainer.addEventListener('dragover', handleExplorerTreeDragOver);
  explorerContainer.addEventListener('dragleave', handleDragLeave);

  // Setup drag-and-drop for playlist sidebar items
  playlistList.addEventListener('drop', handlePlaylistSidebarDrop);
  playlistList.addEventListener('dragover', handlePlaylistSidebarDragOver);
  playlistList.addEventListener('dragleave', handleDragLeave);

  // Prevent default dragover on document to prevent browser from opening files
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  });

  // Prevent default drop on document to prevent browser from opening files
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  });
}

let dropTarget = null;
let dropPosition = 0;

async function handleExplorerTreeDragOver(e) {
  const isExternalFileDrop = e.dataTransfer.types.includes('Files');

  // Handle external file drops
  if (isExternalFileDrop) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Get the container's position for coordinate conversion
    const containerRect = explorerContainer.getBoundingClientRect();

    // Find the tree item content we're hovering over
    const treeItemContent = e.target.closest('.tree-item-content');
    if (treeItemContent) {
      const rect = treeItemContent.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const insertBefore = e.clientY < midpoint;

      // Convert viewport coordinates to container-relative coordinates
      const relativeTop = (insertBefore ? rect.top : rect.bottom) - containerRect.top + explorerContainer.scrollTop;
      dropIndicator.style.top = relativeTop + 'px';
      dropIndicator.classList.add('visible');

      dropTarget = treeItemContent;
      dropPosition = insertBefore ? 0 : 1;
    } else {
      // Dropping in empty space - either at the end or in an empty list
      // Get the last item at the root level (not nested in folders)
      const lastItem = explorerTree.querySelector(':scope > li.tree-item:last-child > .tree-item-content');
      if (lastItem) {
        // Position after the last item
        const rect = lastItem.getBoundingClientRect();
        const relativeTop = rect.bottom - containerRect.top + explorerContainer.scrollTop;
        dropIndicator.style.top = relativeTop + 'px';
        dropIndicator.classList.add('visible');
        dropTarget = null;
      } else {
        // Empty list - position at the top of the explorer tree
        const treeRect = explorerTree.getBoundingClientRect();
        const relativeTop = treeRect.top - containerRect.top + explorerContainer.scrollTop;
        dropIndicator.style.top = relativeTop + 'px';
        dropIndicator.classList.add('visible');
        dropTarget = null;
      }
    }
  } else if (draggedItem) {
    // Handle internal item drags
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const containerRect = explorerContainer.getBoundingClientRect();
    const treeItemContent = e.target.closest('.tree-item-content');

    if (!treeItemContent) {
      // Dragging over empty space - position at the end of the list
      // Get the last item at the root level (not nested in folders)
      const lastItem = explorerTree.querySelector(':scope > li.tree-item:last-child > .tree-item-content');
      if (lastItem) {
        const rect = lastItem.getBoundingClientRect();
        const relativeTop = rect.bottom - containerRect.top + explorerContainer.scrollTop;
        dropIndicator.style.top = relativeTop + 'px';
        dropIndicator.classList.add('visible');
      }
    }
    // If over an item, let the item's own handler deal with it
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

  const isExternalFileDrop = e.dataTransfer.files && e.dataTransfer.files.length > 0;

  // Handle internal item drags
  if (!isExternalFileDrop && draggedItem) {
    const draggedItemId = parseInt(draggedItem.dataset.itemId);
    const targetContent = e.target.closest('.tree-item-content');

    if (!targetContent) {
      // Dropping in empty space - move to the end of the current list
      try {
        const draggedItemData = await getItemById(draggedItemId);
        if (!draggedItemData) {
          console.error('Could not find dragged item data');
          return;
        }

        // Get all items in the current list to find the last position
        const items = await window.electronAPI.getListItems(currentListId);
        const newPosition = items.length - (draggedItemData.parent_list_id === currentListId ? 1 : 0);

        // Call the moveItem API
        await window.electronAPI.moveItem({
          itemId: draggedItemId,
          newParentListId: currentListId,
          newPosition
        });

        // Refresh the tree
        await loadListItems(currentListId);
      } catch (error) {
        console.error('Error moving item:', error);
      }
    }
    // If over an item, let the item's own handler deal with it
    return;
  }

  // Handle external file drops
  if (!isExternalFileDrop) {
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
    showModal(`Unsupported file types (ignored):\n${results.unsupported.join('\n')}\n\nSupported formats: .mp3, .m4a, .ogg`);
  }

  // Show errors
  if (results.errors.length > 0) {
    console.error('Import errors:', results.errors);

    // Check if any errors are duplicate file errors
    const duplicateErrors = results.errors.filter(err =>
      err.error && err.error.includes('UNIQUE constraint')
    );
    const otherErrors = results.errors.filter(err =>
      !err.error || !err.error.includes('UNIQUE constraint')
    );

    if (duplicateErrors.length > 0) {
      const fileList = duplicateErrors.map(err => `  • ${err.file}`).join('\n');
      showModal(`The following file(s) are already in your library:\n\n${fileList}\n\nTo import them again, please rename the file(s) first.`);
    }

    if (otherErrors.length > 0) {
      showModal(`Errors importing ${otherErrors.length} file(s). Check console for details.`);
    }
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
    showModal(`Unsupported file types (ignored):\n${results.unsupported.join('\n')}\n\nSupported formats: .mp3, .m4a, .ogg`);
  }

  // Show errors
  if (results.errors.length > 0) {
    console.error('Import errors:', results.errors);

    // Check if any errors are duplicate file errors
    const duplicateErrors = results.errors.filter(err =>
      err.error && err.error.includes('UNIQUE constraint')
    );
    const otherErrors = results.errors.filter(err =>
      !err.error || !err.error.includes('UNIQUE constraint')
    );

    if (duplicateErrors.length > 0) {
      const fileList = duplicateErrors.map(err => `  • ${err.file}`).join('\n');
      showModal(`The following file(s) are already in your library:\n\n${fileList}\n\nTo import them again, please rename the file(s) first.`);
    }

    if (otherErrors.length > 0) {
      showModal(`Errors importing ${otherErrors.length} file(s). Check console for details.`);
    }
  }

  // Refresh the list if we're viewing Main Library
  if (currentListId === listId) {
    await loadListItems(currentListId);
  }
}

// Helper function to get item by ID
async function getItemById(itemId) {
  return await window.electronAPI.getItem(itemId);
}

// Initialize the app
initialize();
