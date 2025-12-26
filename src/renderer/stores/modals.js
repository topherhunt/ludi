import { createSignal } from 'solid-js';

// Generic modal state
const [isModalOpen, setIsModalOpen] = createSignal(false);
const [modalTitle, setModalTitle] = createSignal('');
const [modalContent, setModalContent] = createSignal('');
const [modalType, setModalType] = createSignal('alert');  // 'alert' | 'confirm' | 'custom'
const [modalCallback, setModalCallback] = createSignal(null);

// Rename modal state
const [isRenameModalOpen, setIsRenameModalOpen] = createSignal(false);
const [renameModalTitle, setRenameModalTitle] = createSignal('');
const [renameModalValue, setRenameModalValue] = createSignal('');
const [renameModalCallback, setRenameModalCallback] = createSignal(null);

// Context menu state
const [isContextMenuOpen, setIsContextMenuOpen] = createSignal(false);
const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
const [contextMenuItems, setContextMenuItems] = createSignal([]);

/**
 * Show an alert modal
 * @param {string} title
 * @param {string} content
 */
function showAlert(title, content) {
  setModalTitle(title);
  setModalContent(content);
  setModalType('alert');
  setModalCallback(null);
  setIsModalOpen(true);
}

/**
 * Show a confirmation modal
 * @param {string} title
 * @param {string} content
 * @param {Function} onConfirm - Called when user clicks Yes
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false otherwise
 */
function showConfirm(title, content, onConfirm) {
  return new Promise((resolve) => {
    setModalTitle(title);
    setModalContent(content);
    setModalType('confirm');
    setModalCallback(() => (confirmed) => {
      closeModal();
      resolve(confirmed);
      if (confirmed && onConfirm) {
        onConfirm();
      }
    });
    setIsModalOpen(true);
  });
}

/**
 * Close the modal
 */
function closeModal() {
  setIsModalOpen(false);
  setModalTitle('');
  setModalContent('');
  setModalCallback(null);
}

/**
 * Handle modal confirmation
 * @param {boolean} confirmed
 */
function handleModalResponse(confirmed) {
  const callback = modalCallback();
  if (callback) {
    callback(confirmed);
  } else {
    closeModal();
  }
}

/**
 * Show rename modal
 * @param {string} title
 * @param {string} initialValue
 * @param {Function} onSubmit - Called with new value when user clicks OK
 * @returns {Promise<string|null>} - Resolves to new value or null if cancelled
 */
function showRenameModal(title, initialValue, onSubmit) {
  return new Promise((resolve) => {
    setRenameModalTitle(title);
    setRenameModalValue(initialValue);
    setRenameModalCallback(() => (value) => {
      closeRenameModal();
      resolve(value);
      if (value !== null && onSubmit) {
        onSubmit(value);
      }
    });
    setIsRenameModalOpen(true);
  });
}

/**
 * Close rename modal
 */
function closeRenameModal() {
  setIsRenameModalOpen(false);
  setRenameModalTitle('');
  setRenameModalValue('');
  setRenameModalCallback(null);
}

/**
 * Handle rename modal submission
 * @param {string|null} value - The new value, or null if cancelled
 */
function handleRenameSubmit(value) {
  const callback = renameModalCallback();
  if (callback) {
    callback(value);
  } else {
    closeRenameModal();
  }
}

/**
 * Show context menu
 * @param {number} x
 * @param {number} y
 * @param {Array<{ label: string, action: Function, disabled?: boolean, separator?: boolean }>} items
 */
function showContextMenu(x, y, items) {
  setContextMenuPosition({ x, y });
  setContextMenuItems(items);
  setIsContextMenuOpen(true);
}

/**
 * Close context menu
 */
function closeContextMenu() {
  setIsContextMenuOpen(false);
  setContextMenuItems([]);
}

/**
 * Check if any modal is open (used for blocking hotkeys)
 * @returns {boolean}
 */
function isAnyModalOpen() {
  return isModalOpen() || isRenameModalOpen();
}

/**
 * Close all modals
 */
function closeAllModals() {
  closeModal();
  closeRenameModal();
  closeContextMenu();
}

// State objects for components

/**
 * Get alert modal state
 * @returns {{ isOpen: boolean, message: string }}
 */
function alertModalState() {
  return {
    isOpen: isModalOpen() && modalType() === 'alert',
    message: modalContent(),
  };
}

/**
 * Get confirm modal state
 * @returns {{ isOpen: boolean, title: string, message: string, onConfirm: Function | null }}
 */
function confirmModalState() {
  return {
    isOpen: isModalOpen() && modalType() === 'confirm',
    title: modalTitle(),
    message: modalContent(),
    onConfirm: modalCallback(),
  };
}

/**
 * Get rename modal state
 * @returns {{ isOpen: boolean, defaultValue: string, onConfirm: Function | null }}
 */
function renameModalState() {
  return {
    isOpen: isRenameModalOpen(),
    defaultValue: renameModalValue(),
    onConfirm: renameModalCallback(),
  };
}

// Simpler modal APIs for components

/**
 * Show alert modal (simple API)
 * @param {string} message
 */
function showAlertModal(message) {
  showAlert('Alert', message);
}

/**
 * Hide alert modal
 */
function hideAlertModal() {
  if (modalType() === 'alert') {
    closeModal();
  }
}

/**
 * Show confirm modal (simple API with callback)
 * @param {string} title
 * @param {string} message
 * @param {Function} onConfirm
 */
function showConfirmModal(title, message, onConfirm) {
  setModalTitle(title);
  setModalContent(message);
  setModalType('confirm');
  setModalCallback(() => onConfirm);
  setIsModalOpen(true);
}

/**
 * Hide confirm modal
 */
function hideConfirmModal() {
  if (modalType() === 'confirm') {
    closeModal();
  }
}

/**
 * Hide rename modal (alias)
 */
function hideRenameModal() {
  closeRenameModal();
}

export {
  // Modal signals
  isModalOpen,
  modalTitle,
  modalContent,
  modalType,

  // Modal functions
  showAlert,
  showAlertModal,
  showConfirm,
  showConfirmModal,
  closeModal,
  handleModalResponse,
  hideAlertModal,
  hideConfirmModal,

  // Rename modal signals
  isRenameModalOpen,
  renameModalTitle,
  renameModalValue,
  setRenameModalValue,

  // Rename modal functions
  showRenameModal,
  closeRenameModal,
  hideRenameModal,
  handleRenameSubmit,

  // Context menu signals
  isContextMenuOpen,
  contextMenuPosition,
  contextMenuItems,

  // Context menu functions
  showContextMenu,
  closeContextMenu,

  // State objects for components
  alertModalState,
  confirmModalState,
  renameModalState,

  // Utility
  isAnyModalOpen,
  closeAllModals,
};
