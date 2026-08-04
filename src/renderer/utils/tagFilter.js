/**
 * Adding and removing `tag=` terms in a search query.
 *
 * Clicking a sidebar chip narrows what you're already looking at rather than
 * replacing it, so a chip click has to edit the query string in place. The query
 * string stays the single source of truth for "what is being filtered" -- there
 * is no second list of active tags to keep in sync with the search box, which
 * means typing `tag=jazz` by hand lights the jazz chip for free.
 *
 * Only plain `tag=x` terms count. A negated one (`-tag=x`, `NOT tag=x`) is
 * excluded on purpose: the chip means "showing only this", and lighting it for a
 * query that hides the tag would say the opposite of what's happening.
 */

/**
 * Split a query into whitespace-separated terms, keeping a quoted value attached
 * to its field: `tag="hip hop" rock` is two terms, not three.
 */
function splitTerms(query) {
  const terms = [];
  let current = '';
  let inQuotes = false;

  for (const char of query || '') {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (/\s/.test(char) && !inQuotes) {
      if (current) terms.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) terms.push(current);
  return terms;
}

/** The tag name a term filters *for*, or null if it isn't a plain tag term. */
function tagNameOf(term) {
  const match = /^tag=(.*)$/i.exec(term);
  if (!match) return null;
  const value = match[1];
  const unquoted = /^"(.*)"$/.exec(value);
  return unquoted ? unquoted[1] : value;
}

/** Every tag currently being filtered for, in the order they appear. */
function tagTermsIn(query) {
  const terms = splitTerms(query);
  const names = [];
  terms.forEach((term, i) => {
    if (terms[i - 1] && terms[i - 1].toUpperCase() === 'NOT') return;
    const name = tagNameOf(term);
    if (name) names.push(name);
  });
  return names;
}

/** The query fragment for one tag, quoted if the name has a space in it. */
function tagTerm(name) {
  return name.includes(' ') ? `tag="${name}"` : `tag=${name}`;
}

/** `query` narrowed by one more tag. Already-present tags are left alone. */
function addTagTerm(query, name) {
  const existing = tagTermsIn(query).map(n => n.toLowerCase());
  if (existing.includes(name.toLowerCase())) return (query || '').trim();
  const trimmed = (query || '').trim();
  return trimmed ? `${trimmed} ${tagTerm(name)}` : tagTerm(name);
}

/**
 * `query` with one tag filter dropped. Returns '' when nothing is left, which
 * the caller reads as "stop searching" rather than "search for everything".
 */
function removeTagTerm(query, name) {
  const terms = splitTerms(query);
  const lower = name.toLowerCase();
  const kept = terms.filter((term, i) => {
    if (terms[i - 1] && terms[i - 1].toUpperCase() === 'NOT') return true;
    const termName = tagNameOf(term);
    return termName === null || termName.toLowerCase() !== lower;
  });
  return kept.join(' ').trim();
}

export { tagTermsIn, addTagTerm, removeTagTerm, tagTerm, splitTerms };
