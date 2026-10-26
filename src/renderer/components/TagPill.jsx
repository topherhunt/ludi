import { For, Show } from 'solid-js';

/**
 * A single rounded tag pill with a border in the tag's assigned color.
 *
 * A tag marked is_auto gets a small gear in its top-left corner: the analyzer's
 * rather than yours. Callers decide what that means where they draw it (the
 * sidebar: a tag you neither made nor applied; the edit panel: applied only by
 * the analyzer). Otherwise it looks and behaves exactly like a hand-made tag.
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

/**
 * Read-only pills for the song-list Tags column. Rows show only the tags you
 * applied, so none gets a gear, even one the analyzer first created; its own are
 * in the sidebar and edit panel, behind "Show AI tags".
 */
export function TagPillList(props) {
  return (
    <For each={(props.tags || []).filter(tag => tag.source !== 'auto')}>
      {(tag) => <TagPill tag={{ ...tag, is_auto: 0 }} />}
    </For>
  );
}
