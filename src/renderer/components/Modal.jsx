import { Show, createEffect, onCleanup } from 'solid-js';

/**
 * Generic Modal component
 */
export function Modal(props) {
  let overlayRef;

  // Handle Escape key to close
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && props.onClose) {
      props.onClose();
    }
  };

  // Handle click on overlay (outside modal) to close
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef && props.onClose) {
      props.onClose();
    }
  };

  // Add/remove keyboard listener when modal opens/closes
  createEffect(() => {
    if (props.open) {
      document.addEventListener('keydown', handleKeyDown);
    }
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <Show when={props.open}>
      <div
        ref={overlayRef}
        class="modal-overlay visible"
        onClick={handleOverlayClick}
      >
        <div class="modal-dialog">
          <Show when={props.title}>
            <div class="modal-title">{props.title}</div>
          </Show>
          <div class="modal-content" innerHTML={props.content}>
            {props.children}
          </div>
          <div class="modal-buttons">
            {props.buttons}
          </div>
        </div>
      </div>
    </Show>
  );
}

/**
 * Alert Modal - simple OK dialog
 */
export function AlertModal(props) {
  return (
    <Modal
      open={props.open}
      title={props.title}
      content={props.message}
      onClose={props.onClose}
      buttons={
        <button class="modal-btn" onClick={props.onClose}>
          OK
        </button>
      }
    />
  );
}

/**
 * Confirm Modal - Yes/No dialog
 */
export function ConfirmModal(props) {
  return (
    <Modal
      open={props.open}
      title={props.title}
      content={props.message}
      onClose={() => props.onResponse?.(false)}
      buttons={
        <>
          <button
            class="modal-btn modal-btn-secondary"
            onClick={() => props.onResponse?.(false)}
          >
            No
          </button>
          <button
            id="modalYesBtn"
            class="modal-btn"
            onClick={() => props.onResponse?.(true)}
          >
            Yes
          </button>
        </>
      }
    />
  );
}

/**
 * Rename Modal - input dialog
 */
export function RenameModal(props) {
  let inputRef;

  // Focus input when modal opens
  createEffect(() => {
    if (props.open && inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  });

  const handleSubmit = () => {
    props.onSubmit?.(inputRef?.value || '');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <Show when={props.open}>
      <div class="modal-overlay visible">
        <div class="modal-dialog rename-dialog">
          <div class="modal-title" id="renameModalTitle">
            {props.title || 'Rename'}
          </div>
          <div class="modal-content rename-content">
            <label for="renameInput">{props.label || 'Name:'}</label>
            <input
              ref={inputRef}
              type="text"
              id="renameInput"
              class="modal-input"
              value={props.value || ''}
              placeholder={props.placeholder || ''}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div class="modal-buttons">
            <button
              id="renameCancelBtn"
              class="modal-btn modal-btn-secondary"
              onClick={() => props.onCancel?.()}
            >
              Cancel
            </button>
            <button
              id="renameOkBtn"
              class="modal-btn"
              onClick={handleSubmit}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
