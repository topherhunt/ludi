/**
 * Panning, zooming and lassoing the music map.
 *
 * The canvas here is deliberately not square (800x400), because a square one
 * hides the whole class of bugs where width is used where height was meant.
 */

import { describe, it, expect } from 'vitest';
import {
  worldToScreen,
  screenToWorld,
  zoomAt,
  panBy,
  clampView,
  nearestPoint,
  pointInPolygon,
  pointsInPolygon,
  INITIAL_VIEW,
  MIN_ZOOM,
  MAX_ZOOM,
  MAP_EXTENT,
} from '../../src/renderer/utils/map-geometry.js';

const SIZE = { width: 800, height: 400 };
const CENTER = { x: SIZE.width / 2, y: SIZE.height / 2 };

describe('worldToScreen', () => {
  it('puts the middle of the map in the middle of the canvas', () => {
    expect(worldToScreen({ x: 0, y: 0 }, INITIAL_VIEW, SIZE)).toEqual(CENTER);
  });

  it('fits the map to the smaller side of the canvas at zoom 1', () => {
    // The top of the map lands on the top edge; the right edge is left of the
    // canvas edge, because the extra width is spare room.
    expect(worldToScreen({ x: 0, y: MAP_EXTENT }, INITIAL_VIEW, SIZE).y).toBe(0);
    expect(worldToScreen({ x: MAP_EXTENT, y: 0 }, INITIAL_VIEW, SIZE).x).toBe(600);
  });

  it('draws world Y upwards, the opposite of canvas Y', () => {
    const up = worldToScreen({ x: 0, y: 0.5 }, INITIAL_VIEW, SIZE);
    expect(up.y).toBeLessThan(CENTER.y);
  });

  it('round-trips through screenToWorld', () => {
    const view = { centerX: 0.3, centerY: -0.2, zoom: 6 };
    const world = screenToWorld({ x: 137, y: 291 }, view, SIZE);
    const screen = worldToScreen(world, view, SIZE);
    expect(screen.x).toBeCloseTo(137, 9);
    expect(screen.y).toBeCloseTo(291, 9);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor under the cursor', () => {
    const cursor = { x: 700, y: 90 };
    const before = screenToWorld(cursor, INITIAL_VIEW, SIZE);

    const zoomed = zoomAt(INITIAL_VIEW, cursor, 2.5, SIZE);

    const after = screenToWorld(cursor, zoomed, SIZE);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomed.zoom).toBe(MIN_ZOOM * 2.5);
  });

  it('will not zoom out past the whole map or in past the limit', () => {
    expect(zoomAt(INITIAL_VIEW, CENTER, 0.1, SIZE).zoom).toBe(MIN_ZOOM);
    expect(zoomAt({ ...INITIAL_VIEW, zoom: MAX_ZOOM }, CENTER, 4, SIZE).zoom).toBe(MAX_ZOOM);
  });
});

describe('panBy', () => {
  it('moves the map with the drag, one pixel per pixel', () => {
    const view = { centerX: 0, centerY: 0, zoom: 4 };
    const song = { x: 0.1, y: 0.1 };
    const before = worldToScreen(song, view, SIZE);

    const panned = panBy(view, 30, -12, SIZE);

    const after = worldToScreen(song, panned, SIZE);
    expect(after.x).toBeCloseTo(before.x + 30, 9);
    expect(after.y).toBeCloseTo(before.y - 12, 9);
  });

  it('stops the map being dragged off the canvas entirely', () => {
    // Flinging the map left and down puts the far corner of it in the middle,
    // and no further, in either direction.
    expect(panBy(INITIAL_VIEW, -100000, 100000, SIZE))
      .toEqual({ centerX: MAP_EXTENT, centerY: MAP_EXTENT, zoom: MIN_ZOOM });
    expect(panBy(INITIAL_VIEW, 100000, -100000, SIZE))
      .toEqual({ centerX: -MAP_EXTENT, centerY: -MAP_EXTENT, zoom: MIN_ZOOM });
  });
});

describe('clampView', () => {
  it('holds the centre inside the map and the zoom inside its range', () => {
    expect(clampView({ centerX: 5, centerY: -5, zoom: 999 }))
      .toEqual({ centerX: MAP_EXTENT, centerY: -MAP_EXTENT, zoom: MAX_ZOOM });
  });
});

describe('nearestPoint', () => {
  const points = [
    { songId: 1, x: 0, y: 0 },
    { songId: 2, x: 0.02, y: 0 },
    { songId: 3, x: -0.9, y: 0.9 },
  ];

  it('picks the closest of two overlapping points, not the first', () => {
    const target = worldToScreen(points[1], INITIAL_VIEW, SIZE);
    const hit = nearestPoint(points, { x: target.x + 1, y: target.y }, INITIAL_VIEW, SIZE);
    expect(hit.songId).toBe(2);
  });

  it('returns nothing when the click lands on empty space', () => {
    expect(nearestPoint(points, { x: 780, y: 380 }, INITIAL_VIEW, SIZE)).toBe(null);
  });
});

describe('pointInPolygon', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it('knows inside from outside', () => {
    expect(pointInPolygon(square, { x: 5, y: 5 })).toBe(true);
    expect(pointInPolygon(square, { x: 15, y: 5 })).toBe(false);
  });

  it('handles a concave lasso, where the middle is outside', () => {
    // A "U": the gap between the two arms is not part of the selection.
    const u = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 8 },
      { x: 6, y: 8 }, { x: 6, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPolygon(u, { x: 2, y: 4 })).toBe(true);
    expect(pointInPolygon(u, { x: 5, y: 4 })).toBe(false);
    expect(pointInPolygon(u, { x: 5, y: 9 })).toBe(true);
  });
});

describe('pointsInPolygon', () => {
  const points = [
    { songId: 1, x: -0.5, y: 0.5 },
    { songId: 2, x: 0.5, y: 0.5 },
    { songId: 3, x: 0.5, y: -0.5 },
  ];

  it('selects only the songs the lasso encloses', () => {
    // A box over the top-left quadrant of the canvas.
    const lasso = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }];
    const selected = pointsInPolygon(points, lasso, INITIAL_VIEW, SIZE);
    expect(selected.map(point => point.songId)).toEqual([1]);
  });

  it('selects nothing from a lasso too small to have an inside', () => {
    expect(pointsInPolygon(points, [{ x: 0, y: 0 }, { x: 5, y: 5 }], INITIAL_VIEW, SIZE)).toEqual([]);
  });
});
