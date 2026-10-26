import { createSignal, createMemo, Show, For } from 'solid-js';
import { TagPill } from './TagPill.jsx';
import {
  tags,
  createTagWithColor,
  bumpLibraryVersion,
  refreshTags,
  showAiTags,
  isYourTag,
} from '../stores/tags.js';
import { addTagToSongs, removeTagFromSongs } from '../utils/api.js';
import { isSearching, searchQuery, runSearch } from '../stores/search.js';

/**
 * Multi-select tag input for the song edit panel.
 *
 * Props:
 *   songs - accessor returning the array of selected song metas
 *           (each { id, tags: [{id,name,color,position,source}] })
 *
 * Tags only the analyzer applied are left out unless "Show AI tags" is on, and
 * the autocomplete offers only your own tags -- though typing an analyzer tag's
 * exact name offers it too, so applying it by hand reuses it.
 *
 * Applied tags render as pills in position order. A pill is solid-bordered when
 * every selected song has the tag, dashed when only some do. Click a pill to
 * select it (blue), then Backspace to remove it from all selected songs, or
 * Left/Right to move between pills. Click into the input to type; an autocomplete
 * of tags appears (with an inline "Create" option), and picking one applies it
 * to all selected songs.
 */
export function TagEditor(props) {
  const [text, setText] = createSignal('');
  const [selectedPillId, setSelectedPillId] = createSignal(null);
  const [inputFocused, setInputFocused] = createSignal(false);
  let inputRef;
  let containerRef;

  const songIds = () => props.songs().map(s => s.id);
  const songCount = () => props.songs().length;

  const shownTagsOf = (song) =>
    (song.tags || []).filter(tag => showAiTags() || tag.source !== 'auto');

  // tagId -> number of selected songs that have it
  const tagCounts = createMemo(() => {
    const counts = new Map();
    for (const song of props.songs()) {
      for (const tag of shownTagsOf(song)) {
        counts.set(tag.id, (counts.get(tag.id) || 0) + 1);
      }
    }
    return counts;
  });

  // Unique applied tags, sorted by position. The gear marks a tag no selected
  // song carries by hand.
  const appliedTags = createMemo(() => {
    const byId = new Map();
    const manualIds = new Set();
    for (const song of props.songs()) {
      for (const tag of shownTagsOf(song)) {
        if (!byId.has(tag.id)) byId.set(tag.id, tag);
        if (tag.source === 'manual') manualIds.add(tag.id);
      }
    }
    return Array.from(byId.values())
      .map(tag => ({ ...tag, is_auto: !manualIds.has(tag.id) }))
      .sort((a, b) => a.position - b.position);
  });

  const isAppliedToAll = (tagId) => tagCounts().get(tagId) === songCount();

  const appliedToAllIds = createMemo(() =>
    new Set(appliedTags().filter(t => isAppliedToAll(t.id)).map(t => t.id))
  );

  // Autocomplete suggestions: your tags not already on every selected song,
  // filtered by the typed text, plus any tag whose name was typed exactly.
  const suggestions = createMemo(() => {
    const t = text().trim().toLowerCase();
    const excluded = appliedToAllIds();
    let list = tags().filter(tag => !excluded.has(tag.id));
    if (t) {
      list = list.filter(tag => tag.name.toLowerCase().includes(t)
        && (isYourTag(tag) || tag.name.toLowerCase() === t));
    } else {
      list = list.filter(isYourTag);
    }
    return list;
  });

  const showCreate = createMemo(() => {
    const t = text().trim();
    return t.length > 0 && !tags().some(tag => tag.name.toLowerCase() === t.toLowerCase());
  });

  const dropdownVisible = createMemo(() =>
    inputFocused() && (suggestions().length > 0 || showCreate())
  );

  // Refresh song-list views, and which tags count as yours, after a membership
  // change.
  const refresh = () => {
    refreshTags();
    bumpLibraryVersion();
    if (isSearching()) runSearch(searchQuery());
  };

  const focusInput = () => {
    setSelectedPillId(null);
    inputRef?.focus();
  };

  const applyTag = async (tag) => {
    await addTagToSongs(tag.id, songIds());
    setText('');
    refresh();
    inputRef?.focus();
  };

  const createAndApply = async (name) => {
    const tag = await createTagWithColor(name);
    await addTagToSongs(tag.id, songIds());
    setText('');
    refresh();
    inputRef?.focus();
  };

  const removeTag = async (tagId) => {
    await removeTagFromSongs(tagId, songIds());
    refresh();
  };

  // Enter in the input: apply an exact match, else the first suggestion, else create.
  const applyTyped = async () => {
    const t = text().trim();
    if (!t) return;
    const exact = tags().find(tag => tag.name.toLowerCase() === t.toLowerCase());
    if (exact) { await applyTag(exact); return; }
    if (suggestions().length > 0) { await applyTag(suggestions()[0]); return; }
    await createAndApply(t);
  };

  const selectPill = (tagId) => {
    setSelectedPillId(tagId);
    containerRef?.focus();
  };

  // Pill navigation keys (fired while the container holds focus after a pill click)
  const handleContainerKeyDown = (e) => {
    const selId = selectedPillId();
    if (selId === null) return;
    const pills = appliedTags();
    const idx = pills.findIndex(t => t.id === selId);
    if (idx === -1) { setSelectedPillId(null); return; }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const nextSel = pills[idx + 1]?.id ?? pills[idx - 1]?.id ?? null;
      removeTag(selId);
      setSelectedPillId(nextSel);
      if (nextSel === null) focusInput();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (idx > 0) setSelectedPillId(pills[idx - 1].id);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (idx < pills.length - 1) setSelectedPillId(pills[idx + 1].id);
      else focusInput();
    } else if (e.key === 'Escape') {
      setSelectedPillId(null);
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyTyped();
    } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft')
      && text() === '' && e.currentTarget.selectionStart === 0) {
      // Jump back into the pills from the empty caret
      const pills = appliedTags();
      if (pills.length > 0) {
        e.preventDefault();
        selectPill(pills[pills.length - 1].id);
      }
    }
  };

  return (
    <div
      class="tag-editor"
      tabindex="-1"
      ref={containerRef}
      onKeyDown={handleContainerKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) focusInput(); }}
    >
      <div class="tag-editor-pills qa-tag-editor-pills">
        <For each={appliedTags()}>
          {(tag) => (
            <TagPill
              tag={tag}
              variant={isAppliedToAll(tag.id) ? 'solid' : 'dashed'}
              selected={selectedPillId() === tag.id}
              onMouseDown={(e) => { e.preventDefault(); selectPill(tag.id); }}
            />
          )}
        </For>
        <input
          ref={inputRef}
          class="tag-editor-input qa-tag-input"
          type="text"
          spellcheck={false}
          value={text()}
          placeholder={appliedTags().length === 0 ? 'Add tags...' : ''}
          onInput={(e) => setText(e.currentTarget.value)}
          onFocus={() => { setInputFocused(true); setSelectedPillId(null); }}
          onBlur={() => setTimeout(() => setInputFocused(false), 120)}
          onKeyDown={handleInputKeyDown}
        />
      </div>

      <Show when={dropdownVisible()}>
        <div class="tag-autocomplete qa-tag-autocomplete">
          <For each={suggestions()}>
            {(tag) => (
              <div
                class="tag-autocomplete-option qa-tag-option"
                onMouseDown={(e) => { e.preventDefault(); applyTag(tag); }}
              >
                <span class="tag-swatch-dot" style={{ 'background-color': tag.color }} />
                {tag.name}
              </div>
            )}
          </For>
          <Show when={showCreate()}>
            <div
              class="tag-autocomplete-option tag-autocomplete-create qa-tag-create"
              onMouseDown={(e) => { e.preventDefault(); createAndApply(text().trim()); }}
            >
              <i class="bi bi-plus-circle" /> Create "{text().trim()}"
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
