import { For, Show } from 'solid-js';

/**
 * A single rounded tag pill with a border in the tag's assigned color.
 *
 * A tag the analyzer invented (tag.is_auto) gets a small gear in its top-left
 * corner. Otherwise it looks and behaves exactly like a hand-made tag, which is
 * the point: an auto tag is a real tag you can rename, recolor, or remove.
 *
 * Props:
 *   tag        - { id, name, color, is_auto }
 *   variant    - 'solid' (default) | 'dashed' (applied to some but not all)
 *   selected   - highlight blue (edit-panel selection state)
 *   count      - songs carrying this tag in the current view (sidebar chips)
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
        'tag-pill-auto': !!props.tag.is_auto,
      }}
      style={{ '--tag-color': props.tag.color }}
      data-tag-id={props.tag.id}
      data-tag-name={props.tag.name}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      onMouseDown={props.onMouseDown}
    >
      <Show when={props.tag.is_auto}>
        <i class="bi bi-gear-fill tag-auto-marker qa-tag-auto" title="Added by the audio analyzer" />
      </Show>
      {props.tag.name}
      <Show when={props.count !== undefined}>
        <span class="tag-pill-count qa-tag-count">{props.count}</span>
      </Show>
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
