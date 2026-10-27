import { createSignal, createResource, onMount, onCleanup, Show, For } from 'solid-js';
import { AlertModal, ConfirmModal } from './Modal.jsx';
import { ScanResultsModal } from './ScanResultsModal.jsx';
import {
  showAlert,
  alertModalState,
  hideAlertModal,
  showConfirmModal,
  confirmModalState,
  hideConfirmModal,
} from '../stores/modals.js';
import { COLUMNS, columnVisibility, columnWidths, setAllColumnVisibility } from '../stores/columns.js';

/** Modal bodies are set via innerHTML, so anything from a file has to be escaped. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Settings window component
 */
export function Settings() {
  // Settings state
  const [databasePath, setDatabasePath] = createSignal('');
  const [libraryPath, setLibraryPath] = createSignal('');

  // Column visibility as edited here, applied on Save
  const [colVisibility, setColVisibility] = createSignal({ ...columnVisibility() });

  // Library scan state
  const [scanning, setScanning] = createSignal(false);
  const [scanModalOpen, setScanModalOpen] = createSignal(false);
  const [scannedFiles, setScannedFiles] = createSignal([]);

  // Audio analysis state. Main pushes progress on every finished song, so this
  // is a live figure rather than something we poll for.
  const [analysis, setAnalysis] = createSignal({ total: 0, analyzed: 0, pending: 0, failed: 0, running: false });
  const [failures, setFailures] = createSignal([]);

  // Swinsian ratings and tags import. `busy` covers the read+match pass, which happens
  // before anything is written.
  const [ratingImport, setRatingImport] = createSignal({ busy: false });
  // Swinsian date added and genre import: '' when idle, else the button's busy label.
  const [detailsImport, setDetailsImport] = createSignal('');

  // Load settings on mount
  onMount(async () => {
    // Load app settings
    const settings = await window.electronAPI?.getSettings?.() || {};
    setDatabasePath(settings.database_path || '');
    setLibraryPath(settings.library_path || '');


    setAnalysis(await window.electronAPI.getAnalysisProgress());
    window.electronAPI.onAnalysisProgress(async (progress) => {
      setAnalysis(progress);
      // An open failure list keeps up with the pass rather than freezing at
      // whatever it said when it was opened.
      if (failures().length > 0) setFailures(await window.electronAPI.getFailedAnalyses());
    });
    window.electronAPI.onAnalysisComplete(({ tags }) => {
      const summary = tags.skipped
        ? `<p>Analysis finished, but tags weren't generated: ${tags.skipped}.</p>`
        : `<p>Analyzed your library and applied <strong>${tags.assignments}</strong> tags across <strong>${tags.tags}</strong> categories.</p>`;
      showAlert('<i class="bi bi-soundwave" style="margin-right: 8px;"></i>Analysis Complete', summary);
    });
    window.electronAPI.onAnalysisError(({ message }) => {
      showAlert(
        '<i class="bi bi-exclamation-triangle" style="margin-right: 8px;"></i>Analysis Failed',
        `<p>The analyzer could not start.</p><pre class="skipped-files-list">${message}</pre>`
      );
    });
  });

  // Handle browse button
  const handleBrowse = async () => {
    const result = await window.electronAPI?.selectDirectory?.();
    if (result) {
      setLibraryPath(result);
    }
  };

  // Show database path in Finder
  const handleShowDbInFinder = () => {
    window.electronAPI?.showInFinder?.(databasePath());
  };

  // Show library path in Finder
  const handleShowLibraryInFinder = () => {
    window.electronAPI?.showInFinder?.(libraryPath());
  };

  // Scan the library folder for audio files not yet in the database
  const handleScan = async () => {
    setScanning(true);
    try {
      const files = await window.electronAPI?.scanLibraryForNewFiles?.() || [];
      if (files.length === 0) {
        showAlert(
          '<i class="bi bi-search" style="margin-right: 8px;"></i>Scan Complete',
          '<p>No new files found in your library folder.</p>'
        );
      } else {
        setScannedFiles(files);
        setScanModalOpen(true);
      }
    } finally {
      setScanning(false);
    }
  };

  // Import all scanned files in place, then show a summary
  const handleImportAll = async () => {
    const files = scannedFiles();
    setScanModalOpen(false);

    const result = await window.electronAPI?.ingestFilesInPlace?.(files) || { imported: [], errors: [] };
    const imported = result.imported || [];
    const errors = result.errors || [];

    let html = `<p>Imported ${imported.length} file${imported.length === 1 ? '' : 's'} into your library.</p>`;
    if (imported.length > 0) {
      const list = imported.map(s => `<li>${s.file_path}</li>`).join('');
      html += `<div class="skipped-files-list"><ul>${list}</ul></div>`;
    }
    if (errors.length > 0) {
      const list = errors.map(e => `<li>${e.file}: ${e.error}</li>`).join('');
      html += `<p>${errors.length} file${errors.length === 1 ? '' : 's'} could not be imported:</p>`;
      html += `<div class="skipped-files-list"><ul>${list}</ul></div>`;
    }

    setScannedFiles([]);
    showAlert(
      '<i class="bi bi-check-circle" style="margin-right: 8px;"></i>Import Summary',
      html,
      'scan-results-dialog'
    );
  };

  // Pick a Swinsian library, show what importing it would change, and only
  // write once the counts have been approved. The preview pass never writes.
  const handleChooseRatingsFile = async () => {
    const dbPath = await window.electronAPI?.chooseSwinsianLibrary?.();
    if (!dbPath) return;

    setRatingImport({ busy: true });
    let preview;
    try {
      preview = await window.electronAPI.previewSwinsianRatings(dbPath);
    } catch (e) {
      setRatingImport({ busy: false });
      showAlert(
        '<i class="bi bi-exclamation-triangle" style="margin-right: 8px;"></i>Could Not Read That Library',
        `<p>${e.message}</p>`
      );
      return;
    }
    setRatingImport({ busy: false });

    if (preview.songsToRate === 0 && preview.songsToTag === 0) {
      showAlert(
        '<i class="bi bi-star" style="margin-right: 8px;"></i>Nothing to Import',
        `<p>Found ${preview.foundTracks} rated or tagged track${preview.foundTracks === 1 ? '' : 's'} in that library,`
        + ` but none of them matched a song in your Ludi library.</p>`
      );
      return;
    }

    const scaleNote = preview.scaleMax > 5
      ? `<p>Its ratings run 0-${preview.scaleMax}, so they'll be converted to 1-5 stars.</p>`
      : '';
    const overwriteNote = preview.overwrites > 0
      ? `<p><strong>${preview.overwrites}</strong> song${preview.overwrites === 1 ? '' : 's'}`
        + ` already ${preview.overwrites === 1 ? 'has' : 'have'} a different rating here and will be overwritten.</p>`
      : '';
    // Titles and tag names come from a foreign database and land in innerHTML, so escape them.
    const tagNote = preview.songsToTag > 0
      ? `<p><strong>${preview.songsToTag}</strong> song${preview.songsToTag === 1 ? '' : 's'} here will be tagged`
        + ` (existing tags are kept):</p>`
        + `<div class="skipped-files-list"><ul>`
        + preview.tagCounts.map(t => `<li>${escapeHtml(t.name)}: ${t.songs}</li>`).join('')
        + `</ul></div>`
      : '';
    const shown = preview.unmatched.slice(0, 200);
    const more = preview.unmatched.length - shown.length;
    const unmatchedNote = preview.unmatched.length > 0
      ? `<p>${preview.unmatched.length} track${preview.unmatched.length === 1 ? '' : 's'} had no match here:</p>`
        + `<div class="skipped-files-list"><ul>${shown.map(t => `<li>${escapeHtml(t)}</li>`).join('')}`
        + (more > 0 ? `<li>...and ${more} more</li>` : '')
        + `</ul></div>`
      : '';

    showConfirmModal(
      'Import Ratings and Tags',
      `<p>Found <strong>${preview.foundTracks}</strong> rated or tagged tracks`
      + ` (${preview.matchedByFilename} matched by filename, ${preview.matchedByTitle} by title). `
      + `<strong>${preview.songsToRate}</strong> song${preview.songsToRate === 1 ? '' : 's'} here will be rated.</p>`
      + scaleNote + overwriteNote + tagNote + unmatchedNote
      + `<p>Import them?</p>`,
      async () => {
        const result = await window.electronAPI.applySwinsianRatings(dbPath);
        showAlert(
          '<i class="bi bi-star-fill" style="margin-right: 8px;"></i>Ratings and Tags Imported',
          `<p>Rated <strong>${result.songsRated}</strong> song${result.songsRated === 1 ? '' : 's'}`
          + ` and tagged <strong>${result.songsTagged}</strong>.</p>`
        );
      }
    );
  };

  // Same preview-then-approve flow as the ratings import, for date added and genre.
  const handleImportDetails = async () => {
    const dbPath = await window.electronAPI.chooseSwinsianLibrary();
    if (!dbPath) return;

    setDetailsImport('Reading...');
    let preview;
    try {
      preview = await window.electronAPI.previewSwinsianDetails(dbPath);
    } catch (e) {
      setDetailsImport('');
      showAlert(
        '<i class="bi bi-exclamation-triangle" style="margin-right: 8px;"></i>Could Not Read That Library',
        `<p>${escapeHtml(e.message)}</p>`
      );
      return;
    }
    setDetailsImport('');

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (preview.songsToDate === 0 && preview.songsToGenre === 0) {
      showAlert(
        '<i class="bi bi-calendar" style="margin-right: 8px;"></i>Nothing to Import',
        `<p>Matched ${plural(preview.matched, 'track')} of ${preview.foundTracks}, but every date and genre here already agrees.</p>`
      );
      return;
    }

    // Genres and titles come from a foreign database and land in innerHTML, so escape them.
    const list = (items) => `<div class="skipped-files-list"><ul>${items.join('')}</ul></div>`;
    const dateNote = preview.songsToDate > 0
      ? `<p><strong>${plural(preview.songsToDate, 'song')}</strong> will get a new date added`
        + ` (the earlier of Swinsian's date added and the file's creation date), by year:</p>`
        + list(preview.yearCounts.map(y => `<li>${y.value}: ${y.songs}</li>`))
      : '';
    const genreNote = preview.songsToGenre > 0
      ? `<p><strong>${plural(preview.songsToGenre, 'song')}</strong> with no genre here will get one,`
        + ` written to the file too (genres already set here are kept):</p>`
        + list(preview.genreCounts.map(g => `<li>${escapeHtml(g.value)}: ${g.songs}</li>`))
      : '';
    const shown = preview.unmatched.slice(0, 200);
    const more = preview.unmatched.length - shown.length;
    const unmatchedNote = preview.unmatched.length > 0
      ? `<p>${plural(preview.unmatched.length, 'track')} had no match here:</p>`
        + list([...shown.map(t => `<li>${escapeHtml(t)}</li>`), ...(more > 0 ? [`<li>...and ${more} more</li>`] : [])])
      : '';

    showConfirmModal(
      'Import Date Added and Genre',
      `<p>Matched <strong>${preview.matched}</strong> of ${preview.foundTracks} tracks.</p>`
      + dateNote + genreNote + unmatchedNote + `<p>Import them?</p>`,
      async () => {
        setDetailsImport('Importing...');
        const result = await window.electronAPI.applySwinsianDetails(dbPath);
        setDetailsImport('');
        const failedNote = result.failed.length > 0
          ? `<p>${plural(result.failed.length, 'file')} could not be written, so kept no genre:</p>`
            + list(result.failed.map(f => `<li>${escapeHtml(f.file)}: ${escapeHtml(f.error)}</li>`))
          : '';
        showAlert(
          '<i class="bi bi-calendar-check" style="margin-right: 8px;"></i>Date Added and Genre Imported',
          `<p>Dated <strong>${plural(result.songsDated, 'song')}</strong>`
          + ` and set the genre of <strong>${result.songsGenred}</strong>.</p>` + failedNote
        );
      }
    );
  };

  // Start / stop the audio analysis pass
  const handleAnalyze = async () => {
    setAnalysis(await window.electronAPI.startAnalysis());
  };

  const handleStopAnalysis = async () => {
    setAnalysis(await window.electronAPI.stopAnalysis());
  };

  const handleRetryFailed = async () => {
    setFailures([]);
    setAnalysis(await window.electronAPI.retryFailedAnalyses());
  };

  // Which songs failed, and why. Fetched on demand rather than pushed with the
  // progress counts, since it is only ever a click away from being irrelevant.
  const handleShowFailures = async () => {
    if (failures().length > 0) { setFailures([]); return; }
    setFailures(await window.electronAPI.getFailedAnalyses());
  };

  // Cancel the scan results modal without importing
  const handleCancelScan = () => {
    setScanModalOpen(false);
    setScannedFiles([]);
  };

  // Handle cancel button
  const handleCancel = () => {
    window.electronAPI?.closeSettings?.();
  };

  // Handle save button
  const handleSave = async () => {
    // Save app settings
    const newSettings = {
      library_path: libraryPath(),
    };

    setAllColumnVisibility(colVisibility());
    await window.electronAPI?.notifyColumnSettingsChanged?.({ visibility: columnVisibility(), widths: columnWidths() });

    await window.electronAPI?.saveSettings?.(newSettings);
    window.electronAPI?.closeSettings?.();
  };

  // Handle Escape key to save and close
  onMount(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        // Let an open modal handle Escape itself instead of closing Settings.
        if (scanModalOpen() || alertModalState().isOpen) return;
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <div class="settings-container">
      <header class="settings-header">
        <h1>Settings</h1>
      </header>

      <div class="settings-content">
        <div class="setting-item">
          <label class="setting-label">Database path</label>
          <div class="setting-description">
            Location where Ludi stores your library database
          </div>
          <input
            type="text"
            id="databasePath"
            class="setting-input"
            value={databasePath()}
            readonly
          />
          <button class="browse-btn" onClick={handleShowDbInFinder}>
            Show in Finder
          </button>
        </div>

        <div class="setting-item">
          <label class="setting-label">Library path</label>
          <div class="setting-description">
            Location where audio files are stored
          </div>
          <input
            type="text"
            id="libraryPath"
            class="setting-input"
            value={libraryPath()}
            onInput={(e) => setLibraryPath(e.target.value)}
          />
          <div class="button-row">
            <button id="browseBtn" class="browse-btn" onClick={handleBrowse}>
              Browse...
            </button>
            <button class="browse-btn" onClick={handleShowLibraryInFinder}>
              Show in Finder
            </button>
          </div>
        </div>

        <div class="setting-item">
          <label class="setting-label">Library scan</label>
          <div class="setting-description">
            Find audio files in your library folder that aren't in your library yet, and import them in place.
          </div>
          <button
            class="browse-btn qa-scan-library"
            onClick={handleScan}
            disabled={scanning()}
          >
            {scanning() ? 'Scanning...' : 'Scan for new music files in library folder'}
          </button>
        </div>

        <div class="setting-item">
          <label class="setting-label">Audio analysis</label>
          <div class="setting-description">
            Listen to every song and work out what it sounds like, so Ludi can find similar
            songs and tag your library automatically. This runs in the background and can take
            a few hours for a large library -- you can keep using Ludi, and quitting partway
            through picks up where it left off.
          </div>

          <div class="analysis-status qa-analysis-status">
            <Show
              when={analysis().running}
              fallback={
                <span>{analysis().analyzed} of {analysis().total} songs analyzed</span>
              }
            >
              <span>
                Analyzing... {analysis().analyzed} of {analysis().total} done,
                {' '}{analysis().pending} to go
              </span>
            </Show>
            {/* Outside the Show on purpose: a pass that is failing every song
                should say so on the first one, not hours later when it ends. */}
            <Show when={analysis().failed > 0}>
              {' '}&middot;{' '}
              <button class="analysis-failed qa-show-failures" onClick={handleShowFailures}>
                {analysis().failed} failed
              </button>
            </Show>
          </div>

          <Show when={failures().length > 0}>
            <div class="skipped-files-list qa-failure-list">
              <ul>
                <For each={failures()}>
                  {(failure) => (
                    <li class="qa-failure-row" data-song-id={failure.song_id}>
                      <strong>{failure.title}</strong>
                      {failure.artist ? ` -- ${failure.artist}` : ''}: {failure.error}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>

          <div class="button-row">
            <Show
              when={analysis().running}
              fallback={
                <button
                  class="browse-btn qa-analyze-library"
                  onClick={handleAnalyze}
                  disabled={analysis().total === 0}
                >
                  {analysis().analyzed === 0 ? 'Analyze my library' : 'Analyze new songs'}
                </button>
              }
            >
              <button class="browse-btn qa-stop-analysis" onClick={handleStopAnalysis}>
                Stop analyzing
              </button>
            </Show>
            <Show when={analysis().failed > 0 && !analysis().running}>
              <button class="browse-btn qa-retry-analysis" onClick={handleRetryFailed}>
                Retry {analysis().failed} failed
              </button>
            </Show>
          </div>
        </div>

        <div class="setting-item">
          <label class="setting-label">Import star ratings and tags</label>
          <div class="setting-description">
            Read the star ratings, and the space-separated tags in the Grouping field,
            out of a Swinsian library and apply them to matching songs here. Songs are
            matched on filename first, then title. Tags are only added, never removed.
            Nothing is written until you've seen what it would change.
          </div>
          <div class="button-row">
            <button
              class="browse-btn qa-import-ratings"
              onClick={handleChooseRatingsFile}
              disabled={ratingImport().busy}
            >
              {ratingImport().busy ? 'Reading...' : 'Import from Swinsian...'}
            </button>
          </div>
        </div>

        <div class="setting-item">
          <label class="setting-label">Import date added and genre</label>
          <div class="setting-description">
            Read each track's date added and genre out of a Swinsian library and apply
            them to matching songs here, matched the same way. Dates are replaced; a
            genre only fills a song that has none. Nothing is written until you've seen
            what it would change.
          </div>
          <div class="button-row">
            <button
              class="browse-btn qa-import-details"
              onClick={handleImportDetails}
              disabled={detailsImport() !== ''}
            >
              {detailsImport() || 'Import from Swinsian...'}
            </button>
          </div>
        </div>

        <div class="setting-item">
          <label class="setting-label">Visible columns</label>
          <div class="setting-description">
            Choose which columns to display in the playlist view
          </div>
          <div class="checkbox-group">
            <For each={COLUMNS}>
              {(column) => (
                <label class="checkbox-label">
                  <input
                    type="checkbox"
                    class={`qa-setting-column-${column.key}`}
                    checked={colVisibility()[column.key]}
                    onChange={(e) => setColVisibility({ ...colVisibility(), [column.key]: e.target.checked })}
                  />
                  {` ${column.menuLabel || column.label}`}
                </label>
              )}
            </For>
          </div>
        </div>
      </div>

      <footer class="settings-footer">
        <button id="cancelBtn" class="btn btn-secondary" onClick={handleCancel}>
          Cancel
        </button>
        <button id="saveBtn" class="btn btn-primary" onClick={handleSave}>
          Save
        </button>
      </footer>

      {/* Scan results modal (lists files to import in place) */}
      <ScanResultsModal
        open={scanModalOpen()}
        files={scannedFiles()}
        onImportAll={handleImportAll}
        onCancel={handleCancelScan}
      />

      {/* Alert modal host (no-files-found and import summary) */}
      <Show when={alertModalState().isOpen}>
        <AlertModal
          open={true}
          title={alertModalState().title}
          message={alertModalState().message}
          dialogClass={alertModalState().dialogClass}
          onClose={hideAlertModal}
        />
      </Show>

      {/* Confirm modal host (ratings import preview) */}
      <Show when={confirmModalState().isOpen}>
        <ConfirmModal
          open={true}
          title={confirmModalState().title}
          message={confirmModalState().message}
          onResponse={(confirmed) => {
            const onConfirm = confirmModalState().onConfirm;
            hideConfirmModal();
            if (confirmed) onConfirm?.();
          }}
        />
      </Show>
    </div>
  );
}
