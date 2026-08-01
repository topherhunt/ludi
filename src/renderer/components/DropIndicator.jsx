import { isDropIndicatorVisible, dropIndicatorPosition, dropIndicatorScope } from '../stores/dragdrop.js';

/**
 * Visual drop indicator for drag-and-drop operations.
 *
 * One instance is rendered per drop surface (the tree, the sidebar) but they all
 * read the same position signals, so `scope` decides which instance shows for
 * the drag in progress. Coordinates are relative to the instance's own
 * positioned container.
 */
export function DropIndicator(props) {
  const scope = () => props.scope ?? 'tree';
  return (
    <div
      id={scope() === 'tree' ? 'dropIndicator' : `dropIndicator-${scope()}`}
      class="drop-indicator"
      classList={{ visible: isDropIndicatorVisible() && dropIndicatorScope() === scope() }}
      style={{
        top: `${dropIndicatorPosition().top}px`,
        left: `${dropIndicatorPosition().left}px`,
        width: `${dropIndicatorPosition().width}px`,
      }}
    />
  );
}
