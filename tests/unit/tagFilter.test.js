/**
 * Editing `tag=` terms in a search query.
 *
 * The sidebar chips are a view onto the query string rather than a separate
 * filter list, so every click round-trips through these functions. The cases
 * that matter are the ones where a naive substring edit would corrupt the query:
 * multi-word tag names, negation, and a tag term sitting next to plain text.
 */

import { describe, it, expect } from 'vitest';
import { tagTermsIn, addTagTerm, removeTagTerm, splitTerms } from '../../src/renderer/utils/tagFilter.js';

describe('splitTerms', () => {
  it('keeps a quoted value attached to its field', () => {
    expect(splitTerms('tag="hip hop" rock')).toEqual(['tag="hip hop"', 'rock']);
  });

  it('treats runs of whitespace as one break', () => {
    expect(splitTerms('  tag=a   tag=b ')).toEqual(['tag=a', 'tag=b']);
  });
});

describe('tagTermsIn', () => {
  it('finds every tag being filtered for', () => {
    expect(tagTermsIn('tag=jazz tag=live')).toEqual(['jazz', 'live']);
  });

  it('unquotes a multi-word tag name', () => {
    expect(tagTermsIn('tag="hip hop"')).toEqual(['hip hop']);
  });

  it('ignores terms that are not tag filters', () => {
    expect(tagTermsIn('miles artist=davis tag=jazz')).toEqual(['jazz']);
  });

  it('does not count a tag the query is excluding', () => {
    // The chip means "showing only this". Lighting it for -tag=live would say
    // the opposite of what the query does.
    expect(tagTermsIn('-tag=live')).toEqual([]);
    expect(tagTermsIn('NOT tag=live')).toEqual([]);
    expect(tagTermsIn('tag=jazz NOT tag=live')).toEqual(['jazz']);
  });

  it('finds nothing in an empty query', () => {
    expect(tagTermsIn('')).toEqual([]);
    expect(tagTermsIn(null)).toEqual([]);
  });
});

describe('addTagTerm', () => {
  it('starts a query when there is nothing to narrow yet', () => {
    expect(addTagTerm('', 'jazz')).toBe('tag=jazz');
  });

  it('narrows an existing filter rather than replacing it', () => {
    expect(addTagTerm('tag=jazz', 'live')).toBe('tag=jazz tag=live');
  });

  it('narrows a typed search without disturbing it', () => {
    expect(addTagTerm('miles artist=davis', 'jazz')).toBe('miles artist=davis tag=jazz');
  });

  it('quotes a tag name containing a space', () => {
    expect(addTagTerm('', 'hip hop')).toBe('tag="hip hop"');
  });

  it('leaves the query alone when the tag is already a filter', () => {
    expect(addTagTerm('tag=jazz tag=live', 'Jazz')).toBe('tag=jazz tag=live');
  });
});

describe('removeTagTerm', () => {
  it('drops one filter and keeps the rest', () => {
    expect(removeTagTerm('tag=jazz tag=live', 'jazz')).toBe('tag=live');
  });

  it('returns an empty query when the last filter is removed', () => {
    // The caller reads '' as "stop searching", not "match everything".
    expect(removeTagTerm('tag=jazz', 'jazz')).toBe('');
  });

  it('matches the tag name case-insensitively', () => {
    expect(removeTagTerm('tag=Jazz tag=live', 'jazz')).toBe('tag=live');
  });

  it('removes a quoted multi-word tag', () => {
    expect(removeTagTerm('tag="hip hop" tag=live', 'hip hop')).toBe('tag=live');
  });

  it('leaves the rest of a typed search intact', () => {
    expect(removeTagTerm('miles artist=davis tag=jazz', 'jazz')).toBe('miles artist=davis');
  });

  it('leaves an exclusion of the same tag in place', () => {
    // -tag=live was never one of the lit chips, so removing the "live" filter
    // has nothing to do with it.
    expect(removeTagTerm('tag=jazz NOT tag=live', 'live')).toBe('tag=jazz NOT tag=live');
  });
});
