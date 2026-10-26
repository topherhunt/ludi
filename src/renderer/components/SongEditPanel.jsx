import { createResource, createMemo, createRenderEffect, Show } from 'solid-js';
import { selectedItems } from '../stores/navigation.js';
import { libraryVersion, bumpLibraryVersion, showAiTags, toggleShowAiTags } from '../stores/tags.js';
import { showSimilarTo } from '../stores/similar.js';
import { getAllListItems, updateSong } from '../utils/api.js';
import { formatTime } from '../utils/format.js';
import { TagEditor } from './TagEditor.jsx';

/**
 * Resolve the current selection (list_item ids) to the distinct set of songs it
 * covers. Selecting a folder counts every contained song (recursively). Returns
 * an array of song metas: { id, title, artist, album, track_number, tags }.
 */
function resolveSelectedSongs(allItems, selectedIds) {
  const itemsById = new Map();
  const childrenByParent = new Map();
  for (const it of allItems) {
    itemsById.set(it.id, it);
    if (!childrenByParent.has(it.parent_list_id)) childrenByParent.set(it.parent_list_id, []);
    childrenByParent.get(it.parent_list_id).push(it);
  }

  const songIds = new Set();
  const collectFolder = (listId) => {
    for (const child of (childrenByParent.get(listId) || [])) {
      if (child.song_id !== null) songIds.add(child.song_id);
      else if (child.list_id !== null) collectFolder(child.list_id);
    }
  };
  for (const id of selectedIds) {
    const row = itemsById.get(id);
    if (!row) continue;
    if (row.song_id !== null) songIds.add(row.song_id);
    else if (row.list_id !== null) collectFolder(row.list_id);
  }

  const metaById = new Map();
  for (const it of allItems) {
    if (it.song_id !== null && songIds.has(it.song_id) && !metaById.has(it.song_id)) {
      metaById.set(it.song_id, {
        id: it.song_id,
        title: it.song_title || '',
        artist: it.artist || '',
        album: it.album || '',
        track_number: it.track_number,
        duration_seconds: it.duration_seconds,
        tags: it.tags || [],
      });
    }
  }
  return Array.from(metaById.values());
}

// Every save refreshes the panel, which rewrites each field from the database;
// the one being typed in is left alone, or a save landing mid-typing would wipe it.
function bindValue(input, value) {
  createRenderEffect(() => {
    const next = value();
    if (document.activeElement !== input) input.value = next;
  });
}

export function SongEditPanel() {
  const [songs] = createResource(
    () => [Array.from(selectedItems()), libraryVersion()],
    async ([selectedIds]) => {
      if (selectedIds.length === 0) return [];
      const allItems = await getAllListItems();
      return resolveSelectedSongs(allItems, selectedIds);
    }
  );

  const songList = () => songs() || [];
  const count = () => songList().length;
  const single = () => count() === 1;

  const heading = createMemo(() => {
    if (single()) return `Edit ${songList()[0].title}`;
    return `Edit ${count()} songs`;
  });

  // How long the selection would take to play. A song imported without duration
  // metadata contributes nothing rather than breaking the sum.
  const totalPlaytime = createMemo(() =>
    songList().reduce((total, s) => total + (s.duration_seconds || 0), 0)
  );

  // Shared value across the selection, or null when the songs disagree (mixed).
  const commonValue = (field) => {
    const values = new Set(songList().map(s => s[field] ?? ''));
    return values.size === 1 ? songList()[0][field] : null;
  };

  const refresh = () => bumpLibraryVersion();

  const hasAiTags = createMemo(() =>
    songList().some(s => s.tags.some(tag => tag.source === 'auto'))
  );

  // Seeds from every song the panel is editing, folder contents included.
  const findSimilar = () =>
    showSimilarTo(songList().map(s => ({ songId: s.id, title: s.title })));

  const commitField = async (field, rawValue) => {
    const value = field === 'track_number'
      ? (rawValue.trim() === '' ? null : parseInt(rawValue, 10))
      : rawValue;
    if (field === 'track_number' && value !== null && Number.isNaN(value)) return;
    await Promise.all(songList().map(s => updateSong(s.id, { [field]: value })));
    refresh();
  };

  const commitOnChange = (field) => (e) => commitField(field, e.currentTarget.value);
  const blurOnEnter = (e) => { if (e.key === 'Enter') e.currentTarget.blur(); };

  // A metadata field shown for the multi-song case: dimmed "<multiple>" when the
  // selected songs disagree, otherwise the shared value.
  const sharedField = (field) => {
    const common = commonValue(field);
    return {
      value: common ?? '',
      isMultiple: common === null,
    };
  };

  return (
    <Show when={count() > 0}>
      <div class="song-edit-panel qa-song-edit-panel">
        <div class="song-edit-divider" />
        <div class="song-edit-heading qa-song-edit-heading">{heading()}</div>
        <Show when={!single()}>
          <div class="song-edit-subheading qa-song-edit-playtime">
            {formatTime(totalPlaytime())} total
          </div>
        </Show>

        <Show when={single()}>
          <label class="song-edit-field">
            <span class="song-edit-label">Title</span>
            <input
              class="song-edit-input qa-edit-title"
              type="text"
              spellcheck={false}
              ref={(el) => bindValue(el, () => songList()[0].title)}
              onChange={commitOnChange('title')}
              onKeyDown={blurOnEnter}
            />
          </label>
          <label class="song-edit-field">
            <span class="song-edit-label">Track #</span>
            <input
              class="song-edit-input qa-edit-track"
              type="text"
              spellcheck={false}
              ref={(el) => bindValue(el, () => songList()[0].track_number ?? '')}
              onChange={commitOnChange('track_number')}
              onKeyDown={blurOnEnter}
            />
          </label>
        </Show>

        <label class="song-edit-field">
          <span class="song-edit-label">Artist</span>
          <input
            class="song-edit-input qa-edit-artist"
            classList={{ 'is-multiple': sharedField('artist').isMultiple }}
            type="text"
            spellcheck={false}
            ref={(el) => bindValue(el, () => sharedField('artist').value)}
            placeholder={sharedField('artist').isMultiple ? '<multiple>' : ''}
            onChange={commitOnChange('artist')}
            onKeyDown={blurOnEnter}
          />
        </label>
        <label class="song-edit-field">
          <span class="song-edit-label">Album</span>
          <input
            class="song-edit-input qa-edit-album"
            classList={{ 'is-multiple': sharedField('album').isMultiple }}
            type="text"
            spellcheck={false}
            ref={(el) => bindValue(el, () => sharedField('album').value)}
            placeholder={sharedField('album').isMultiple ? '<multiple>' : ''}
            onChange={commitOnChange('album')}
            onKeyDown={blurOnEnter}
          />
        </label>

        <div class="song-edit-field song-edit-field-tags">
          <span class="song-edit-label">Tags</span>
          <TagEditor songs={songList} />
        </div>
        <div class="song-edit-links">
          <Show when={hasAiTags()}>
            <span class="text-link qa-toggle-ai-tags" onClick={toggleShowAiTags}>
              {showAiTags() ? 'Hide AI tags' : 'Show AI tags'}
            </span>
          </Show>
          <span class="text-link qa-panel-find-similar" onClick={findSimilar}>
            {single() ? 'Find similar songs' : `Find songs like these ${count()}`}
          </span>
        </div>
      </div>
    </Show>
  );
}
