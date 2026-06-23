/**
 * Search query parser and evaluator.
 *
 * Syntax:
 *   plain text     -- matches title/album/artist/folder names (case-insensitive substring)
 *   title=value    -- title contains value
 *   artist=value   -- artist contains value
 *   album=value    -- album contains value
 *   any=value      -- title/album/artist contains value
 *   track=7        -- track_number equals 7 (integer comparison)
 *   tag=name       -- always false (tags not yet implemented)
 *   A AND B        -- both must match
 *   A OR B         -- either must match
 *   (A OR B) AND C -- parentheses for grouping
 *   "quoted value" -- multi-word value (use in field or plain text)
 */

const FIELDS = ['title', 'artist', 'album', 'any', 'track', 'tag'];

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

    if (ch === '"') {
      tokens.push({ type: 'PLAIN', value: readQuoted() });
      continue;
    }

    const word = readUnquoted();
    if (!word) { i++; continue; }

    const upper = word.toUpperCase();
    if (upper === 'AND') { tokens.push({ type: 'AND' }); continue; }
    if (upper === 'OR')  { tokens.push({ type: 'OR' });  continue; }

    // Check for field=value syntax
    if (FIELDS.includes(upper.toLowerCase()) && i < input.length && input[i] === '=') {
      const field = word.toLowerCase();
      i++; // skip '='
      skipWS();
      const value = (i < input.length && input[i] === '"') ? readQuoted() : readUnquoted();
      tokens.push({ type: 'FIELD_COND', field, value });
      continue;
    }

    tokens.push({ type: 'PLAIN', value: word });
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}

function isAtomStart(tok) {
  return tok.type === 'PLAIN' || tok.type === 'FIELD_COND' || tok.type === 'LPAREN';
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
  let [left, cur] = parsePrimary(tokens, pos);
  while (true) {
    if (tokens[cur]?.type === 'AND') {
      const [right, next] = parsePrimary(tokens, cur + 1);
      left = { type: 'AND', left, right };
      cur = next;
    } else if (isAtomStart(tokens[cur])) {
      // Implicit AND for adjacent terms
      const [right, next] = parsePrimary(tokens, cur);
      left = { type: 'AND', left, right };
      cur = next;
    } else {
      break;
    }
  }
  return [left, cur];
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
    return [{ type: 'COND', field: tok.field, value: tok.value }, pos + 1];
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
 * Evaluate a parsed AST against a song's data.
 * @param {object|null} ast
 * @param {{ title: string, artist: string, album: string, track_number: number|null, ancestorFolderNames: string[] }} songData
 * @returns {boolean}
 */
export function evaluateSong(ast, songData) {
  if (!ast) return false;

  const { title, artist, album, track_number, ancestorFolderNames } = songData;

  switch (ast.type) {
    case 'OR':
      return evaluateSong(ast.left, songData) || evaluateSong(ast.right, songData);

    case 'AND':
      return evaluateSong(ast.left, songData) && evaluateSong(ast.right, songData);

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
      const { field, value } = ast;
      switch (field) {
        case 'title':  return contains(title, value);
        case 'artist': return contains(artist, value);
        case 'album':  return contains(album, value);
        case 'any':
          return contains(title, value) || contains(artist, value) || contains(album, value);
        case 'track': {
          const n = parseInt(value, 10);
          return !isNaN(n) && track_number === n;
        }
        case 'tag':
          return false; // tags not yet implemented
        default:
          return false;
      }
    }

    default:
      return false;
  }
}
