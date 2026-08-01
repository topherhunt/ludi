import { createSignal, createRoot } from 'solid-js';
import { previewCopyToList, copyItemsToList } from '../utils/api.js';

// The pending "these songs are already in the playlist" question, or null.
// { playlistTitle, duplicates, totalSongs, resolve } -- `resolve` settles the
// promise handed back by askAboutDuplicates.
const { duplicatePrompt, setDuplicatePrompt } = createRoot(() => {
  const [duplicatePrompt, setDuplicatePrompt] = createSignal(null);
  return { duplicatePrompt, setDuplicatePrompt };
});

// Resolves to 'add' | 'skip' | 'cancel' once the user answers the modal.
function askAboutDuplicates(playlistTitle, duplicates, totalSongs) {
  return new Promise((resolve) => {
    setDuplicatePrompt({ playlistTitle, duplicates, totalSongs, resolve });
  });
}

// Called by DuplicateSongsModal's buttons.
function resolveDuplicatePrompt(choice) {
  const prompt = duplicatePrompt();
  if (!prompt) return;
  setDuplicatePrompt(null);
  prompt.resolve(choice);
}

/**
 * Copy list items into a playlist, asking first if any of their songs are
 * already there. Every path that adds to a playlist (sidebar drop of tree
 * items, OS-file drop) goes through this, so the dialog behaves identically
 * for all of them.
 *
 * @returns {Promise<number>} songs added (0 if cancelled)
 */
async function copyIntoPlaylist(itemIds, targetListId, playlistTitle) {
  if (itemIds.length === 0) return 0;

  const { totalSongs, duplicates } = await previewCopyToList(itemIds, targetListId);

  let skipSongIds = [];
  if (duplicates.length > 0) {
    const choice = await askAboutDuplicates(playlistTitle, duplicates, totalSongs);
    if (choice === 'cancel') return 0;
    if (choice === 'skip') skipSongIds = duplicates.map((d) => d.song_id);
  }

  return await copyItemsToList(itemIds, targetListId, skipSongIds);
}

export { duplicatePrompt, resolveDuplicatePrompt, copyIntoPlaylist };
