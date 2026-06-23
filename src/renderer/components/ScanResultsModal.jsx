import { Show, For, createEffect, onCleanup } from 'solid-js';

/**
 * Modal listing audio files found in the library folder that aren't yet in the
 * database. Lets the user import them all (in place) or cancel.
 *
 * Props:
 *   open: boolean
 *   files: string[]  - library-relative paths, already sorted
 *   onImportAll: () => void
 *   onCancel: () => void
 */
export function ScanResultsModal(props) {
  // Escape closes the modal (same as Cancel)
  createEffect(() => {
    if (!props.open) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        props.onCancel?.();
      }
    };

    document.addEventListener('keydown', handleEscape);
    onCleanup(() => {
      document.removeEventListener('keydown', handleEscape);
    });
  });

  return (
    <Show when={props.open}>
      <div class="modal-overlay visible">
        <div class="modal-dialog scan-results-dialog">
          <div class="modal-title">
            <i class="bi bi-search" style="margin-right: 8px;"></i>
            Found {props.files.length} new file{props.files.length === 1 ? '' : 's'}
          </div>
          <div class="modal-content">
            <p>These audio files are in your library folder but not yet in your library. Import them in place?</p>
            <div class="skipped-files-list">
              <ul>
                <For each={props.files}>
                  {(file) => <li>{file}</li>}
                </For>
              </ul>
            </div>
          </div>
          <div class="modal-buttons">
            <button
              class="modal-btn modal-btn-secondary qa-scan-cancel"
              onClick={() => props.onCancel?.()}
            >
              Cancel
            </button>
            <button
              class="modal-btn qa-scan-import-all"
              onClick={() => props.onImportAll?.()}
            >
              Import all into database
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
