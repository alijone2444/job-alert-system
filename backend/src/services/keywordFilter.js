/**
 * Boolean keyword filter — LinkedIn-style search syntax.
 *
 * Supports:
 *   - AND / && / (space between terms = implicit AND)
 *   - OR  / || / /
 *   - NOT / -term
 *   - "quoted phrases"
 *   - ( grouping )
 *
 * Examples:
 *   react native
 *   "react native" OR flutter OR "react js"
 *   (react native OR flutter) AND developer NOT senior
 *   react native / flutter / expo
 *   "mobile developer" -intern
 *
 * Matching is case-insensitive substring matching against a haystack string.
 */

/* ---------------------------------- lexer --------------------------------- */

function tokenize(input) {
  const tokens = [];
  const n = input.length;
  let i = 0;

  while (i < n) {
    const c = input[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (c === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }

    if (c === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }

    if (c === '/') {
      tokens.push({ type: 'OR' });
      i++;
      continue;
    }

    // Quoted phrase
    if (c === '"' || c === '“' || c === '”') {
      let j = i + 1;
      let buf = '';
      while (j < n && input[j] !== '"' && input[j] !== '“' && input[j] !== '”') {
        buf += input[j];
        j++;
      }
      tokens.push({ type: 'TERM', value: buf.trim().toLowerCase() });
      i = j < n ? j + 1 : j;
      continue;
    }

    // Bare word — read until whitespace or a special char
    let j = i;
    let buf = '';
    while (j < n && !/[\s()"/“”]/.test(input[j])) {
      buf += input[j];
      j++;
    }
    i = j;

    const upper = buf.toUpperCase();
    if (upper === 'AND' || upper === '&&') {
      tokens.push({ type: 'AND' });
    } else if (upper === 'OR' || upper === '||') {
      tokens.push({ type: 'OR' });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT' });
    } else if (buf.startsWith('-') && buf.length > 1) {
      // "-term" => NOT term
      tokens.push({ type: 'NOT' });
      tokens.push({ type: 'TERM', value: buf.slice(1).toLowerCase() });
    } else {
      tokens.push({ type: 'TERM', value: buf.toLowerCase() });
    }
  }

  return tokens;
}

/* --------------------------------- parser --------------------------------- */
// Grammar (lowest to highest precedence):
//   or   := and (OR and)*
//   and  := not (AND? not)*        // adjacency = implicit AND
//   not  := NOT not | primary
//   prim := '(' or ')' | TERM

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const t = peek();
    if (!t) return { term: '' };
    if (t.type === 'LPAREN') {
      next();
      const node = parseOr();
      if (peek()?.type === 'RPAREN') next();
      return node;
    }
    if (t.type === 'TERM') {
      next();
      return { term: t.value };
    }
    // Unexpected operator — skip it to stay resilient
    next();
    return parsePrimary();
  }

  function parseNot() {
    if (peek()?.type === 'NOT') {
      next();
      return { not: parseNot() };
    }
    return parsePrimary();
  }

  function parseAnd() {
    const nodes = [parseNot()];
    while (peek()) {
      const t = peek().type;
      if (t === 'AND') {
        next();
        nodes.push(parseNot());
      } else if (t === 'TERM' || t === 'NOT' || t === 'LPAREN') {
        nodes.push(parseNot()); // implicit AND
      } else {
        break; // OR or RPAREN
      }
    }
    return nodes.length === 1 ? nodes[0] : { and: nodes };
  }

  function parseOr() {
    const nodes = [parseAnd()];
    while (peek()?.type === 'OR') {
      next();
      nodes.push(parseAnd());
    }
    return nodes.length === 1 ? nodes[0] : { or: nodes };
  }

  return parseOr();
}

/* ------------------------------- evaluation ------------------------------- */

function evaluate(node, haystack) {
  if (node == null) return true;
  if (node.term !== undefined) {
    return node.term === '' ? true : haystack.includes(node.term);
  }
  if (node.and) return node.and.every((n) => evaluate(n, haystack));
  if (node.or) return node.or.some((n) => evaluate(n, haystack));
  if (node.not) return !evaluate(node.not, haystack);
  return true;
}

/* ------------------------------- public API ------------------------------- */

/**
 * Compile a boolean keyword query into a reusable AST.
 * Returns null for an empty query (matches everything).
 */
export function compileKeywordQuery(query) {
  if (!query || !query.trim()) return null;
  const tokens = tokenize(query);
  if (!tokens.length) return null;
  return parse(tokens);
}

/**
 * Test a haystack string against a compiled query.
 * A null query matches everything.
 */
export function matchesKeyword(haystack, compiled) {
  if (!compiled) return true;
  return evaluate(compiled, (haystack || '').toLowerCase());
}
