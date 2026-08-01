import { Show, For, createEffect, onCleanup } from 'solid-js';
import { duplicatePrompt, resolveDuplicatePrompt } from '../stores/playlistCopy.js';

/**
 * Asks what to do when songs being added to a playlist are already in it.
 * Driven entirely by the playlistCopy store, so it is rendered once (in App)
 * and every add-to-playlist path reuses it.
 */
export function DuplicateSongsModal() {
  // Escape cancels the whole operation (same as the Cancel button)
  createEffect(() => {
    if (!duplicatePrompt()) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') resolveDuplicatePrompt('cancel');
    };

    document.addEventListener('keydown', handleEscape);
    onCleanup(() => {
      document.removeEventListener('keydown', handleEscape);
    });
  });

  return (
    <Show when={duplicatePrompt()}>
      <div class="modal-overlay visible qa-duplicate-songs-modal">
        <div class="modal-dialog scan-results-dialog">
          <div class="modal-title">
            <i class="bi bi-files" style="margin-right: 8px;"></i>
            {duplicatePrompt().duplicates.length} of {duplicatePrompt().totalSongs} song
            {duplicatePrompt().totalSongs === 1 ? '' : 's'} already in "{duplicatePrompt().playlistTitle}"
          </div>
          <div class="modal-content">
            <p>Add them again as duplicates, or skip them?</p>
            <div class="skipped-files-list">
              <ul>
                <For each={duplicatePrompt().duplicates}>
                  {(song) => <li>{song.title}</li>}
                </For>
              </ul>
            </div>
          </div>
          <div class="modal-buttons">
            <button
              class="modal-btn modal-btn-secondary qa-dup-cancel"
              onClick={() => resolveDuplicatePrompt('cancel')}
            >
              Cancel
            </button>
            <button
              class="modal-btn modal-btn-secondary qa-dup-skip"
              onClick={() => resolveDuplicatePrompt('skip')}
            >
              Skip duplicates
            </button>
            <button
              class="modal-btn qa-dup-add"
              onClick={() => resolveDuplicatePrompt('add')}
            >
              Add duplicates
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
