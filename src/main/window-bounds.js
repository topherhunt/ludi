const DEFAULT_SIZE = { width: 1200, height: 800 };

// How much of the window has to land on a screen to count as reachable.
const MIN_VISIBLE = { width: 200, height: 100 };

// Where to open the main window: where it was last time, unless that is off
// every screen now (a monitor unplugged since), in which case at its last size,
// centered. `saved` is { x, y, width, height } or null on a first launch;
// `workAreas` are the connected displays' work areas.
function restoredBounds(saved, workAreas) {
  if (saved === null) return DEFAULT_SIZE;
  const onScreen = workAreas.some((area) =>
    Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x) >= MIN_VISIBLE.width
    && Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y) >= MIN_VISIBLE.height);
  return onScreen ? saved : { width: saved.width, height: saved.height };
}

module.exports = { restoredBounds, DEFAULT_SIZE };
