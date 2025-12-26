import { isDropIndicatorVisible, dropIndicatorPosition } from '../stores/dragdrop.js';

/**
 * Visual drop indicator for drag-and-drop operations
 */
export function DropIndicator() {
  return (
    <div
      id="dropIndicator"
      class="drop-indicator"
      classList={{ visible: isDropIndicatorVisible() }}
      style={{
        top: `${dropIndicatorPosition().top}px`,
        left: `${dropIndicatorPosition().left}px`,
        width: `${dropIndicatorPosition().width}px`,
      }}
    />
  );
}
