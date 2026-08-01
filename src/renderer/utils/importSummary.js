import { showAlert } from '../stores/modals.js';

/**
 * Show the "Import Summary" alert for files an import skipped -- unsupported
 * file types and songs already in the library. Does nothing when everything
 * imported cleanly. Shared by every OS-file drop target.
 *
 * @param {{ unsupported?: string[], errors?: Array<{file: string, error: string}> }} result
 */
export function showImportSummary(result) {
  const skipped = result?.errors?.filter((e) => e.error?.includes('already exists')) || [];
  const unsupported = result?.unsupported || [];
  if (skipped.length === 0 && unsupported.length === 0) return;

  let dialogHtml = '';

  if (unsupported.length > 0) {
    const unsupportedListHtml = unsupported.map((f) => `<li>${f}</li>`).join('');
    dialogHtml += `
      <p>Skipped ${unsupported.length} unsupported file(s):</p>
      <div class="skipped-files-list"><ul>${unsupportedListHtml}</ul></div>
    `;
  }

  if (skipped.length > 0) {
    const skippedListHtml = skipped.map((e) => `<li>${e.file}</li>`).join('');
    dialogHtml += `
      <p>Skipped ${skipped.length} song(s) already in library:</p>
      <div class="skipped-files-list"><ul>${skippedListHtml}</ul></div>
    `;
  }

  showAlert(
    '<i class="bi bi-info-circle" style="margin-right: 8px;"></i>Import Summary',
    dialogHtml
  );
}
