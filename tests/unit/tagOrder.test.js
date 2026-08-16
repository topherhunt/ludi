/**
 * Sidebar chip order.
 *
 * The two halves of the tag list answer different questions -- "where is the tag
 * I named" for hand-applied ones, "what is this view made of" for the analyzer's
 * -- so they're sorted by different keys and never interleaved.
 */

import { describe, it, expect } from 'vitest';
import { sortTagsForSidebar } from '../../src/renderer/stores/tagFacets.js';

const manual = (name, count) => ({ id: name, name, count, is_auto: 0 });
const auto = (name, count) => ({ id: name, name, count, is_auto: 1 });

const order = (tags) => sortTagsForSidebar(tags).map(t => t.name);

describe('sortTagsForSidebar', () => {
  it('puts hand-applied tags first, alphabetically, whatever their counts', () => {
    expect(order([manual('zeta', 90), manual('Alpha', 1), manual('mid', 50)]))
      .toEqual(['Alpha', 'mid', 'zeta']);
  });

  it('sorts auto tags by how much of the view carries them, commonest first', () => {
    expect(order([auto('rock', 3), auto('ambient', 40), auto('jazz', 12)]))
      .toEqual(['ambient', 'jazz', 'rock']);
  });

  it('keeps the analyzer\'s tags below yours even when they are far more common', () => {
    expect(order([auto('ambient', 400), manual('fav', 2)])).toEqual(['fav', 'ambient']);
  });

  it('breaks an auto-tag count tie alphabetically, so the order is stable', () => {
    expect(order([auto('rock', 5), auto('ambient', 5)])).toEqual(['ambient', 'rock']);
  });

  it('does not mutate the list it was given', () => {
    const tags = [auto('rock', 1), manual('fav', 1)];
    sortTagsForSidebar(tags);
    expect(tags.map(t => t.name)).toEqual(['rock', 'fav']);
  });
});
