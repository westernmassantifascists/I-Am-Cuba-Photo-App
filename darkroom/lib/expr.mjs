// Expression handling shared by the compiler (validation) and documented for the runtime.
//
// Authors write expressions with Twine-style variables:  $trust > 2 and not $hasKey
// They are translated to JavaScript that reads/writes the story state object `S`:
//   S.trust > 2 && !S.hasKey
// SugarCube/Harlowe word operators (to, is, eq, neq, and, or, not, gt, gte, lt, lte)
// are accepted so that code imported from Twine keeps working.

const WORD_OPS = {
  to: '=',
  is: '===',
  isnot: '!==',
  eq: '==',
  neq: '!=',
  and: '&&',
  or: '||',
  not: '!',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

// Split an expression into string-literal and code segments so we never rewrite inside quotes.
function segments(src) {
  const out = [];
  let i = 0;
  let buf = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      if (buf) out.push({ code: true, text: buf });
      buf = '';
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j++;
        j++;
      }
      out.push({ code: false, text: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf) out.push({ code: true, text: buf });
  return out;
}

export function translateExpr(src) {
  return segments(String(src))
    .map((seg) => {
      if (!seg.code) return seg.text;
      let t = seg.text;
      t = t.replace(/\bis\s+not\b/g, 'isnot');
      t = t.replace(/\$([A-Za-z_][\w]*)/g, 'S.$1');
      // SugarCube temporary variables (_name) are kept alongside the story variables.
      t = t.replace(/(^|[^\w$.])_([A-Za-z][\w]*)/g, '$1S._$2');
      t = t.replace(/(^|[^.\w$])(to|isnot|is|eq|neq|and|or|not|gte|gt|lte|lt)(?![\w$])/g, (m, pre, w) => `${pre}${WORD_OPS[w]}`);
      return t;
    })
    .join('')
    .trim();
}

// Variables read and written by an expression (approximate, for warnings only).
export function variablesIn(src) {
  const names = new Set();
  for (const seg of segments(String(src))) {
    if (!seg.code) continue;
    for (const m of seg.text.matchAll(/\$([A-Za-z_][\w]*)/g)) names.add(m[1]);
  }
  return names;
}

export function assignedIn(src) {
  const names = new Set();
  for (const seg of segments(String(src))) {
    if (!seg.code) continue;
    for (const m of seg.text.matchAll(/\$([A-Za-z_][\w]*)\s*(?:to\b|[-+*/%]?=(?!=)|\+\+|--)/g)) names.add(m[1]);
  }
  return names;
}

// Helper names the runtime exposes inside expressions. Keep in sync with runtime/darkroom.js.
export const HELPERS = ['visited', 'random', 'either', 'ending', 'turns', 'passage', 'previous', 'runs', 'clamp', 'Math'];

// Throws a SyntaxError if the translated expression is not valid JavaScript.
export function checkExpr(js, asStatement = false) {
  // eslint-disable-next-line no-new-func
  new Function('S', 'H', asStatement ? js : `return (${js});`);
}
