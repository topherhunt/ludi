// DEPRECATED (folders): song lists no longer show folders, so nothing can select
// one to rename. TODO: delete with the rest of the folder code (see TASKS.md).
import { Show, createSignal, createEffect, onCleanup } from 'solid-js';

/**
 * Batch-rename modal: find/replace across multiple selected folders.
 *
 * Props:
 *   open: boolean
 *   folderCount: number
 *   onApply: ({ pattern, mode, replacement }) => void   // mode: 'exact' | 'regex'
 *   onCancel: () => void
 */
export function BatchRenameModal(props) {
  let patternRef, replaceRef;
  const [mode, setMode] = createSignal('exact');

  // Focus the pattern field when the modal opens.
  createEffect(() => {
    if (props.open && patternRef) {
      patternRef.focus();
    }
  });

  // Escape cancels.
  createEffect(() => {
    if (!props.open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') props.onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  const submit = () => {
    props.onApply?.({
      pattern: patternRef?.value || '',
      mode: mode(),
      replacement: replaceRef?.value || '',
    });
  };

  const onEnter = (e) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <Show when={props.open}>
      <div class="modal-overlay visible">
        <div class="modal-dialog rename-dialog">
          <div class="modal-title">
            <i class="bi bi-pencil-square" style="margin-right: 8px;"></i>
            Rename {props.folderCount} folder{props.folderCount === 1 ? '' : 's'}
          </div>
          <div class="modal-content rename-content batch-rename-content">
            <label>Find:</label>
            <select
              class="modal-input qa-batch-mode"
              value={mode()}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="exact">Exact match</option>
              <option value="regex">Regex</option>
            </select>
            <input
              ref={patternRef}
              type="text"
              class="modal-input qa-batch-pattern"
              placeholder={mode() === 'regex' ? 'regex to match' : 'text to match'}
              onKeyDown={onEnter}
            />
            <label>Replace with:</label>
            <input
              ref={replaceRef}
              type="text"
              class="modal-input qa-batch-replace"
              placeholder="replacement"
              onKeyDown={onEnter}
            />
          </div>
          <div class="modal-buttons">
            <button class="modal-btn modal-btn-secondary" onClick={() => props.onCancel?.()}>
              Cancel
            </button>
            <button class="modal-btn qa-batch-apply" onClick={submit}>
              Rename
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
