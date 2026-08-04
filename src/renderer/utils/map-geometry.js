/**
 * The maths behind panning, zooming and lassoing the music map.
 *
 * Two coordinate systems meet here. WORLD coordinates are what the projection
 * produced: the whole library fits in [-1, 1] on both axes, and they never
 * change while you look at the map. SCREEN coordinates are pixels in the canvas,
 * and depend on the canvas size and on where you have panned and zoomed to.
 *
 * The view is {centerX, centerY, zoom}: which world point sits in the middle of
 * the canvas, and how many times bigger than "the whole map fits" it is drawn.
 *
 * Kept separate from the component because this is where the bugs would be --
 * zooming towards the pointer and hit-testing a click are both easy to get
 * subtly wrong and impossible to eyeball.
 */

// Mirrors MAP_EXTENT in src/main/map-projection.js: coordinates come back inside
// [-1, 1], so at zoom 1 the map exactly fills the smaller canvas dimension.
export const MAP_EXTENT = 1;

// Below 1 you would be looking at empty space around a shrinking map; above 40
// the points are further apart than the screen and panning stops making sense.
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 40;

// How close to a point a click has to land, in pixels, to count as hitting it.
export const HIT_RADIUS = 8;

export const INITIAL_VIEW = { centerX: 0, centerY: 0, zoom: MIN_ZOOM };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Pixels per world unit at zoom 1, so the map just fits the canvas. */
function baseScale(size) {
  return Math.min(size.width, size.height) / 2 / MAP_EXTENT;
}

/**
 * Keep the view somewhere useful: the centre stays within the map's own box, so
 * a stray drag can't fling the library off the edge of the canvas.
 */
export function clampView(view) {
  return {
    centerX: clamp(view.centerX, -MAP_EXTENT, MAP_EXTENT),
    centerY: clamp(view.centerY, -MAP_EXTENT, MAP_EXTENT),
    zoom: clamp(view.zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

/** World point -> canvas pixel. Y is flipped: world Y goes up, canvas Y goes down. */
export function worldToScreen(point, view, size) {
  const scale = baseScale(size) * view.zoom;
  return {
    x: size.width / 2 + (point.x - view.centerX) * scale,
    y: size.height / 2 - (point.y - view.centerY) * scale,
  };
}

/** Canvas pixel -> world point. The exact inverse of worldToScreen. */
export function screenToWorld(point, view, size) {
  const scale = baseScale(size) * view.zoom;
  return {
    x: view.centerX + (point.x - size.width / 2) / scale,
    y: view.centerY - (point.y - size.height / 2) / scale,
  };
}

/**
 * Zoom by `factor` while keeping whatever is under the pointer under the
 * pointer. Zooming around the canvas centre instead would send the thing you
 * were looking at sliding off the screen.
 */
export function zoomAt(view, screenPoint, factor, size) {
  const anchor = screenToWorld(screenPoint, view, size);
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const scale = baseScale(size) * zoom;
  return clampView({
    centerX: anchor.x - (screenPoint.x - size.width / 2) / scale,
    centerY: anchor.y + (screenPoint.y - size.height / 2) / scale,
    zoom,
  });
}

/** Drag the map by a screen-pixel delta. */
export function panBy(view, dx, dy, size) {
  const scale = baseScale(size) * view.zoom;
  return clampView({
    centerX: view.centerX - dx / scale,
    centerY: view.centerY + dy / scale,
    zoom: view.zoom,
  });
}

/**
 * The point nearest a click, or null if the click landed on empty space.
 *
 * Nearest rather than first-within-range: where points overlap, clicking picks
 * the one whose centre you were actually closest to.
 */
export function nearestPoint(points, screenPoint, view, size, radius = HIT_RADIUS) {
  let best = null;
  let bestDistance = radius;
  for (const point of points) {
    const screen = worldToScreen(point, view, size);
    const distance = Math.hypot(screen.x - screenPoint.x, screen.y - screenPoint.y);
    if (distance <= bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Is a screen point inside a lasso? Ray casting: count how many times a ray
 * heading off to the right crosses the outline, and an odd number means inside.
 */
export function pointInPolygon(polygon, point) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = (a.y > point.y) !== (b.y > point.y);
    if (!straddles) continue;
    const crossingX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

/** Every point the lasso encloses, in the order they were given. */
export function pointsInPolygon(points, polygon, view, size) {
  if (polygon.length < 3) return [];
  return points.filter(point => pointInPolygon(polygon, worldToScreen(point, view, size)));
}
