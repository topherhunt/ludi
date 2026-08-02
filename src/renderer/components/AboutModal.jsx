import { Show, createEffect, onCleanup } from 'solid-js';

// Baked in at build time by Vite (see vite.config.js) -- a packaged .app has no
// .git to ask at runtime.
const VERSION = __APP_VERSION__;
const COMMIT = __APP_COMMIT__;

const README_URL = 'https://github.com/topherhunt/ludi/blob/main/README.md';

/**
 * About dialog, opened from "About Ludi" in the app menu.
 */
export function AboutModal(props) {
  createEffect(() => {
    if (!props.open) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') props.onClose();
    };

    document.addEventListener('keydown', handleEscape);
    onCleanup(() => document.removeEventListener('keydown', handleEscape));
  });

  // Links have to go through the shell: following an href in the window itself
  // would navigate the app away and leave no way back.
  const openReadme = (e) => {
    e.preventDefault();
    window.electronAPI.openExternal(README_URL);
  };

  return (
    <Show when={props.open}>
      <div class="modal-overlay visible" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="modal-dialog about-dialog qa-about-dialog">
          <div class="modal-title">About Ludi</div>
          <div class="modal-content about-content">
            <div class="about-tagline">Fast, intuitive, lightweight macOS music library &amp; player</div>
            <div class="about-build qa-about-build">
              Version {VERSION} &middot; build {COMMIT}
            </div>
            <div class="about-credit">Made with 💙 by Topher Hunt</div>
            <a class="about-link qa-about-readme" href={README_URL} onClick={openReadme}>
              Documentation &amp; source on GitHub
            </a>
          </div>
          <div class="modal-buttons">
            <button class="modal-btn qa-about-ok" onClick={() => props.onClose()}>OK</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
