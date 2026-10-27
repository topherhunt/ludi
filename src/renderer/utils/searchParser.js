/**
 * Search query parser and evaluator.
 *
 * Syntax:
 *   plain text     -- matches title/album/artist/folder names (case-insensitive substring)
 *   title=value    -- title contains value
 *   artist=value   -- artist contains value
 *   album=value    -- album contains value
 *   genre=value    -- genre contains value (`genre=none` for no genre)
 *   any=value      -- title/album/artist contains value
 *   track=7        -- track_number equals 7 (integer comparison)
 *   tag=name       -- song has a tag named exactly `name` (case-insensitive)
 *   rating=4       -- star rating is exactly 4
 *   rating>=4      -- star rating is 4 or more (also > < <= on rating and track)
 *   rating=none    -- song has never been rated (`rating=any` for the converse)
 *   plays>=5       -- played at least 5 times (`plays=0` for never played)
 *   lastplayed>=2026-01-01 -- last played on or after that day (also > < <= =)
 *   added>=2026-01-01      -- added to the library on or after that day (same operators)
 *   A AND B        -- both must match
 *   A OR B         -- either must match
 *   NOT A          -- A must not match (also `-A` shorthand, e.g. -tag=fav)
 *   (A OR B) AND C -- parentheses for grouping
 *   "quoted value" -- multi-word value (use in field or plain text)
 */

const FIELDS = ['title', 'artist', 'album', 'genre', 'any', 'track', 'tag', 'rating', 'plays', 'lastplayed', 'added'];

// Fields that hold a number or a date and so accept the ordering operators.
// Restricting them keeps `artist>=x` from parsing into something with no
// sensible meaning.
const ORDERED_FIELDS = ['track', 'rating', 'plays', 'lastplayed', 'added'];

const FIELD_OP_RE = new RegExp(`^(${FIELDS.join('|')})(>=|<=|>|<|=)`, 'i');

/**
 * At position `i`, match a field name immediately followed by a comparison
 * operator (`artist=Davis`, `rating>=4`). Returns {field, op, length} or null.
 *
 * Matching the operator here rather than teaching readUnquoted to stop on `<`
 * and `>` means those characters stay ordinary text everywhere else, so a plain
 * search for "<3" still works.
 */
function matchFieldOperator(input, i) {
  const m = FIELD_OP_RE.exec(input.slice(i));
  if (!m) return null;
  const field = m[1].toLowerCase();
  const op = m[2];
  if (op !== '=' && !ORDERED_FIELDS.includes(field)) return null;
  return { field, op, length: m[0].length };
}

function tokenize(input) {
  const tokens = [];
  let i = 0;

  const skipWS = () => {
    while (i < input.length && /\s/.test(input[i])) i++;
  };

  const readQuoted = () => {
    i++; // skip opening "
    let s = '';
    while (i < input.length && input[i] !== '"') s += input[i++];
    if (i < input.length) i++; // skip closing "
    return s;
  };

  // Read unquoted token -- stops at whitespace, parens, quotes, or '='
  const readUnquoted = () => {
    let s = '';
    while (i < input.length && !/[\s()"=]/.test(input[i])) s += input[i++];
    return s;
  };

  while (i < input.length) {
    skipWS();
    if (i >= input.length) break;

    const ch = input[i];

    if (ch === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }

    // Leading '-' is shorthand for NOT (e.g. -tag=fav). Internal hyphens in a
    // word (hip-hop, low-e) are unaffected -- this only fires at a token boundary.
    if (ch === '-') { tokens.push({ type: 'NOT' }); i++; continue; }

    if (ch === '"') {
      tokens.push({ type: 'PLAIN', value: readQuoted() });
      continue;
    }

    // field<op>value, checked before the plain word read so operator characters
    // never end up inside a search term.
    const cond = matchFieldOperator(input, i);
    if (cond) {
      i += cond.length;
      skipWS();
      const value = (i < input.length && input[i] === '"') ? readQuoted() : readUnquoted();
      tokens.push({ type: 'FIELD_COND', field: cond.field, op: cond.op, value });
      continue;
    }

    const word = readUnquoted();
    if (!word) { i++; continue; }

    const upper = word.toUpperCase();
    if (upper === 'AND') { tokens.push({ type: 'AND' }); continue; }
    if (upper === 'OR')  { tokens.push({ type: 'OR' });  continue; }
    if (upper === 'NOT') { tokens.push({ type: 'NOT' }); continue; }

    tokens.push({ type: 'PLAIN', value: word });
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}

function isAtomStart(tok) {
  return tok.type === 'PLAIN' || tok.type === 'FIELD_COND' || tok.type === 'LPAREN'
    || tok.type === 'NOT';
}

function parseExpr(tokens, pos) {
  return parseOr(tokens, pos);
}

function parseOr(tokens, pos) {
  let [left, cur] = parseAnd(tokens, pos);
  while (tokens[cur]?.type === 'OR') {
    const [right, next] = parseAnd(tokens, cur + 1);
    left = { type: 'OR', left, right };
    cur = next;
  }
  return [left, cur];
}

function parseAnd(tokens, pos) {
  let [left, cur] = parseNot(tokens, pos);
  while (true) {
    if (tokens[cur]?.type === 'AND') {
      const [right, next] = parseNot(tokens, cur + 1);
      left = { type: 'AND', left, right };
      cur = next;
    } else if (isAtomStart(tokens[cur])) {
      // Implicit AND for adjacent terms
      const [right, next] = parseNot(tokens, cur);
      left = { type: 'AND', left, right };
      cur = next;
    } else {
      break;
    }
  }
  return [left, cur];
}

// NOT binds tighter than AND/OR. Consecutive NOTs are allowed.
function parseNot(tokens, pos) {
  if (tokens[pos]?.type === 'NOT') {
    const [child, next] = parseNot(tokens, pos + 1);
    return [{ type: 'NOT', child }, next];
  }
  return parsePrimary(tokens, pos);
}

function parsePrimary(tokens, pos) {
  const tok = tokens[pos];
  if (!tok) return [{ type: 'PLAIN', value: '' }, pos];

  if (tok.type === 'LPAREN') {
    const [expr, next] = parseExpr(tokens, pos + 1);
    const afterParen = tokens[next]?.type === 'RPAREN' ? next + 1 : next;
    return [expr, afterParen];
  }

  if (tok.type === 'FIELD_COND') {
    return [{ type: 'COND', field: tok.field, op: tok.op, value: tok.value }, pos + 1];
  }

  if (tok.type === 'PLAIN') {
    return [{ type: 'PLAIN', value: tok.value }, pos + 1];
  }

  // Unexpected token (OR/AND at wrong position) -- skip
  return [{ type: 'PLAIN', value: '' }, pos + 1];
}

/**
 * Parse a query string into an AST.
 * @param {string} query
 * @returns {object|null} AST node, or null for empty query
 */
export function parseQuery(query) {
  if (!query || !query.trim()) return null;
  const tokens = tokenize(query.trim());
  const [ast] = parseExpr(tokens, 0);
  return ast;
}

/**
 * Returns true if the query has no searchable terms -- only reserved operators
 * like AND/OR or bare parentheses. In that case the search would always return
 * zero results, which is better reported as a syntax error than "no results".
 * @param {string} query
 * @returns {boolean}
 */
export function isInvalidQuery(query) {
  if (!query || !query.trim()) return false;
  const tokens = tokenize(query.trim());
  return !tokens.some(t => t.type === 'PLAIN' || t.type === 'FIELD_COND');
}

const contains = (haystack, needle) =>
  (haystack || '').toLowerCase().includes(needle.toLowerCase());

/**
 * Ordering comparison against a numeric field.
 *
 * An unset field matches nothing, whatever the operator: `rating<3` sweeping in
 * every song you have never rated would be a nasty surprise, and it is the same
 * surprise in the other direction as `rating>=4` doing it. Songs with no rating
 * are reached deliberately with `rating=none`.
 */
function compareNumeric(actual, op, rawValue) {
  const n = parseInt(rawValue, 10);
  if (isNaN(n)) return false;
  if (actual === null || actual === undefined) return false;
  switch (op) {
    case '>':  return actual > n;
    case '<':  return actual < n;
    case '>=': return actual >= n;
    case '<=': return actual <= n;
    default:   return actual === n;
  }
}

/**
 * Ordering comparison against a stored ISO timestamp, by calendar day.
 *
 * Both sides are cut to `YYYY-MM-DD` before comparing, so "last played on or
 * before Jan 1" includes the song played at 3pm that day rather than only one
 * played exactly at midnight.
 *
 * A song that has never been played matches nothing, for the same reason an
 * unrated song doesn't answer `rating<3`. Reach those with `plays=0`.
 */
function compareDate(actual, op, rawValue) {
  const day = rawValue.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  if (!actual) return false;
  const actualDay = actual.slice(0, 10);
  switch (op) {
    case '>':  return actualDay > day;
    case '<':  return actualDay < day;
    case '>=': return actualDay >= day;
    case '<=': return actualDay <= day;
    default:   return actualDay === day;
  }
}

/**
 * Evaluate a parsed AST against a song's data.
 * @param {object|null} ast
 * @param {{ title: string, artist: string, album: string, genre: string, track_number: number|null, rating: number|null, play_count: number, last_played_at: string|null, date_added: string, ancestorFolderNames: string[], tags: string[] }} songData
 * @returns {boolean}
 */
export function evaluateSong(ast, songData) {
  if (!ast) return false;

  const { title, artist, album, genre, track_number, rating, play_count, last_played_at,
          date_added, ancestorFolderNames, tags } = songData;

  switch (ast.type) {
    case 'OR':
      return evaluateSong(ast.left, songData) || evaluateSong(ast.right, songData);

    case 'AND':
      return evaluateSong(ast.left, songData) && evaluateSong(ast.right, songData);

    case 'NOT':
      return !evaluateSong(ast.child, songData);

    case 'PLAIN': {
      const q = ast.value;
      if (!q) return false;
      return (
        contains(title, q) ||
        contains(artist, q) ||
        contains(album, q) ||
        (ancestorFolderNames || []).some(f => contains(f, q))
      );
    }

    case 'COND': {
      const { field, value, op = '=' } = ast;
      switch (field) {
        case 'title':  return contains(title, value);
        case 'artist': return contains(artist, value);
        case 'album':  return contains(album, value);
        case 'genre':
          if (value.toLowerCase() === 'none') return !genre;
          return contains(genre, value);
        case 'any':
          return contains(title, value) || contains(artist, value) || contains(album, value);
        case 'track':
          return compareNumeric(track_number, op, value);
        case 'rating': {
          // `none`/`any` are the only way to reach the unrated, since the
          // ordering operators deliberately skip them.
          const isUnrated = rating === null || rating === undefined;
          if (value.toLowerCase() === 'none') return isUnrated;
          if (value.toLowerCase() === 'any')  return !isUnrated;
          return compareNumeric(rating, op, value);
        }
        case 'plays':
          return compareNumeric(play_count, op, value);
        case 'lastplayed':
          return compareDate(last_played_at, op, value);
        case 'added':
          return compareDate(date_added, op, value);
        case 'tag':
          // Exact (case-insensitive) tag-name match. `tags` is an array of the
          // song's tag names.
          return (tags || []).some(t => t.toLowerCase() === value.toLowerCase());
        default:
          return false;
      }
    }

    default:
      return false;
  }
}
