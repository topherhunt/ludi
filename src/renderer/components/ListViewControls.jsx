import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { GROUP_MODES, SORT_FIELDS } from '../utils/arrangeRows.js';
import {
  viewSettings,
  naturalSortLabel,
  setGroupBy,
  replaceSort,
  addSort,
  toggleSortDir,
  removeSort,
} from '../stores/listView.js';
import { activeViewKey } from '../stores/songList.js';
import { FloatingMenu } from './FloatingMenu.jsx';

const dirLabel = (dir) => (dir === 'asc' ? 'A-Z' : 'Z-A');

/**
 * The group-by and sort-by menus for the song list on screen. Changes are saved
 * for that list. The sort menu stays open while you adjust it; both close on a
 * click anywhere else.
 */
export function ListViewControls() {
  const [openMenu, setOpenMenu] = createSignal(null); // { name: 'group' | 'sort', x, y }
  let menuEl;

  const settings = () => viewSettings(activeViewKey());
  const fieldLabel = (field) => (field === 'natural' ? naturalSortLabel(activeViewKey()) : SORT_FIELDS[field].label);

  const sortSummary = () => {
    const [first, ...rest] = settings().sort;
    const direction = first.field === 'natural' && first.dir === 'asc' ? '' : ` ${dirLabel(first.dir)}`;
    return `${fieldLabel(first.field)}${direction}${rest.length > 0 ? ` +${rest.length}` : ''}`;
  };

  const unusedFields = () => Object.keys(SORT_FIELDS).filter((field) => !settings().sort.some((s) => s.field === field));

  const toggleMenu = (name, e) => {
    if (openMenu()?.name === name) return setOpenMenu(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setOpenMenu({ name, x: rect.left, y: rect.bottom + 4 });
  };

  // The buttons toggle their own menu, so a mousedown on one isn't "outside".
  const closeOnOutsideClick = (e) => {
    if (!menuEl.contains(e.target) && !e.target.closest('.list-view-btn')) setOpenMenu(null);
  };

  createEffect(() => {
    if (openMenu()) document.addEventListener('mousedown', closeOnOutsideClick);
    else document.removeEventListener('mousedown', closeOnOutsideClick);
  });
  onCleanup(() => document.removeEventListener('mousedown', closeOnOutsideClick));

  return (
    <div class="list-view-controls">
      <button class="list-view-btn qa-group-by-btn" onClick={(e) => toggleMenu('group', e)} title="Group by">
        <i class="bi bi-collection" />
        <span>{GROUP_MODES[settings().groupBy].label}</span>
      </button>
      <button class="list-view-btn qa-sort-btn" onClick={(e) => toggleMenu('sort', e)} title="Sort by">
        <i class="bi bi-sort-down" />
        <span>{sortSummary()}</span>
      </button>

      <Show when={openMenu()?.name === 'group'}>
        <FloatingMenu class="context-menu qa-group-menu" x={openMenu().x} y={openMenu().y} ref={(el) => (menuEl = el)}>
          <For each={Object.keys(GROUP_MODES)}>
            {(mode) => (
              <div
                class="context-menu-item qa-group-option"
                data-group={mode}
                onClick={() => {
                  setGroupBy(activeViewKey(), mode);
                  setOpenMenu(null);
                }}
              >
                <i class={`context-menu-icon bi ${settings().groupBy === mode ? 'bi-check2' : ''}`} />
                {GROUP_MODES[mode].label}
              </div>
            )}
          </For>
        </FloatingMenu>
      </Show>

      {/* Current fields first, each with its direction; then every other field,
          which replaces the sort on click or is added after it with "+". */}
      <Show when={openMenu()?.name === 'sort'}>
        <FloatingMenu class="context-menu sort-menu qa-sort-menu" x={openMenu().x} y={openMenu().y} ref={(el) => (menuEl = el)}>
          <For each={settings().sort}>
            {(sort) => (
              <div class="sort-menu-row qa-sort-current" data-field={sort.field}>
                <span class="sort-menu-label">{fieldLabel(sort.field)}</span>
                <button class="sort-menu-btn qa-sort-dir" onClick={() => toggleSortDir(activeViewKey(), sort.field)}>
                  {dirLabel(sort.dir)}
                </button>
                <Show when={settings().sort.length > 1}>
                  <button class="sort-menu-btn qa-sort-remove" title="Remove" onClick={() => removeSort(activeViewKey(), sort.field)}>
                    <i class="bi bi-x" />
                  </button>
                </Show>
              </div>
            )}
          </For>
          <Show when={unusedFields().length > 0}>
            <div class="context-menu-separator" />
          </Show>
          <For each={unusedFields()}>
            {(field) => (
              <div class="sort-menu-row">
                <span class="sort-menu-label sort-menu-option qa-sort-option" data-field={field} onClick={() => replaceSort(activeViewKey(), field)}>
                  {fieldLabel(field)}
                </span>
                <button class="sort-menu-btn qa-sort-add" data-field={field} title="Add as a further sort" onClick={() => addSort(activeViewKey(), field)}>
                  <i class="bi bi-plus" />
                </button>
              </div>
            )}
          </For>
        </FloatingMenu>
      </Show>
    </div>
  );
}
