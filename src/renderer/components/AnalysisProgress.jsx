import { createSignal, onMount, Show } from 'solid-js';
import { getAnalysisProgress, onAnalysisProgress } from '../utils/api.js';

/**
 * A strip at the bottom of the sidebar showing how far the analysis pass has
 * got. Analysis is started from Settings but takes hours, so the main window
 * needs its own read-out -- otherwise the only way to know whether it is still
 * going is to reopen Settings.
 *
 * Shown only while a pass is running; there is nothing useful to say the rest
 * of the time, and the strip would just eat sidebar height.
 */
export function AnalysisProgress() {
  const [progress, setProgress] = createSignal({ total: 0, analyzed: 0, pending: 0, failed: 0, running: false });

  onMount(async () => {
    setProgress(await getAnalysisProgress());
    onAnalysisProgress(setProgress);
  });

  // Of the songs this pass has to get through, how many are done.
  const done = () => progress().analyzed;
  const goal = () => progress().analyzed + progress().pending;
  const percent = () => (goal() === 0 ? 0 : Math.round((done() / goal()) * 100));

  return (
    <Show when={progress().running}>
      <div class="analysis-progress qa-analysis-progress" data-percent={percent()}>
        <div class="analysis-progress-label">
          <i class="bi bi-soundwave" />
          <span class="qa-analysis-progress-text">Analyzing {done()} of {goal()}</span>
          {/* A pass that is failing should say so on the first failure. Waiting
              until the end means hours spent watching a bar fill for nothing --
              Settings has the reason for each one. */}
          <Show when={progress().failed > 0}>
            <span class="analysis-progress-failed qa-analysis-failed-count">
              {progress().failed} failed
            </span>
          </Show>
        </div>
        <div class="analysis-progress-track">
          <div class="analysis-progress-fill" style={{ width: `${percent()}%` }} />
        </div>
      </div>
    </Show>
  );
}
