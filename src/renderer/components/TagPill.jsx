import { For } from 'solid-js';

/**
 * A single rounded tag pill with a border in the tag's assigned color.
 *
 * Props:
 *   tag        - { id, name, color }
 *   variant    - 'solid' (default) | 'dashed' (applied to some but not all)
 *   selected   - highlight blue (edit-panel selection state)
 *   onClick, onContextMenu, onMouseDown - optional handlers
 */
export function TagPill(props) {
  return (
    <span
      class="tag-pill"
      classList={{
        'tag-pill-dashed': props.variant === 'dashed',
        'tag-pill-selected': props.selected,
        'tag-pill-active': props.active,
      }}
      style={{ '--tag-color': props.tag.color }}
      data-tag-id={props.tag.id}
      data-tag-name={props.tag.name}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      onMouseDown={props.onMouseDown}
    >
      {props.tag.name}
    </span>
  );
}

/** Renders a read-only list of tag pills (used in the song-list Tags column). */
export function TagPillList(props) {
  return (
    <For each={props.tags || []}>
      {(tag) => <TagPill tag={tag} />}
    </For>
  );
}
