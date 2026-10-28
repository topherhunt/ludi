/**
 * Format seconds as M:SS, or H:MM:SS once it runs to an hour or more.
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time string (e.g., "3:45", "1:04:09")
 */
export function formatTime(seconds) {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) {
    return '0:00';
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const padded = secs.toString().padStart(2, '0');

  if (hours === 0) return `${mins}:${padded}`;
  return `${hours}:${mins.toString().padStart(2, '0')}:${padded}`;
}

/** A timestamp (ISO, UTC) as the local calendar date, YYYY-MM-DD. */
export function formatLocalDate(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Format a file size in bytes to human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/**
 * Pluralize a word based on count
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural] - Optional plural form (defaults to singular + 's')
 * @returns {string}
 */
export function pluralize(count, singular, plural) {
  return count === 1 ? singular : (plural || `${singular}s`);
}

/**
 * Format item count for display (e.g., "5 items", "1 item")
 * @param {number} count
 * @returns {string}
 */
export function formatItemCount(count) {
  return `${count} ${pluralize(count, 'item')}`;
}

/** Modal bodies are set via innerHTML, so anything from a file has to be escaped. */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
