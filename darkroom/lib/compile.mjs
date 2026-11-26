// Turns Twine passages into Darkroom story data: a list of ops per passage that the runtime plays
// in order, plus a full validation report (broken links, missing media, bad expressions, ...).

import { translateExpr, checkExpr, variablesIn, assignedIn } from './expr.mjs';
import { resolveAsset, mediaType } from './assets.mjs';

export const SPECIAL = new Set(['StoryInit', 'StoryTitle', 'StoryData', 'StoryMenu', 'StoryCaption', 'PassageReady', 'PassageDone']);

// ---------- small parsers ----------

function tokenize(s) {
  const out = [];
  const re = /\s*([^\s"'=]+=(?:"[^"]*"|'[^']*'|\S*)|"[^"]*"|'[^']*'|\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}

function unquote(v) {
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
}

function parseArgs(s) {
  const pos = [];
  const kv = {};
  for (const tok of tokenize(s)) {
    const m = tok.match(/^([A-Za-z_][\w-]*)=(.*)$/);
    if (m) kv[m[1].toLowerCase()] = unquote(m[2]);
    else pos.push(unquote(tok));
  }
  return { pos, kv };
}

function num(v, def) {
  if (v === undefined || v === '') return def;
  const n = parseFloat(String(v).replace(/s$/, ''));
  return Number.isFinite(n) ? n : def;
}

function bool(v, def) {
  if (v === undefined) return def;
  return !/^(false|no|off|0)$/i.test(String(v));
}

// [[text->target]], [[target<-text]], [[text|target]], [[target]], optionally followed by [setter]
export function parseLink(inner) {
  let setter = null;
  const sp = inner.indexOf('][');
  if (sp !== -1) {
    setter = inner.slice(sp + 2);
    inner = inner.slice(0, sp);
  }
  let text;
  let target;
  let i;
  if ((i = inner.lastIndexOf('->')) !== -1) {
    text = inner.slice(0, i);
    target = inner.slice(i + 2);
  } else if ((i = inner.indexOf('<-')) !== -1) {
    target = inner.slice(0, i);
    text = inner.slice(i + 2);
  } else if ((i = inner.lastIndexOf('|')) !== -1) {
    text = inner.slice(0, i);
    target = inner.slice(i + 1);
  } else {
    text = target = inner;
  }
  return { text: text.trim(), target: target.trim(), setter: setter?.trim() || null };
}

const LINK_RE = /\[\[(.+?)\]\]/g;

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------- compiler ----------

export function compileStory({ passages, startName, config, assetIndex }) {
  const errors = [];
  const warnings = [];
  const info = [];
  const usedAssets = new Map(); // rel -> {kinds:Set, refs:[]}
  const varsRead = new Map(); // name -> first location
  const varsSet = new Set();
  const byName = new Map();
  const characters = config.characters || {};
  const speakerNames = new Map(); // lowercase name -> key
  for (const [key, c] of Object.entries(characters)) {
    speakerNames.set(key.toLowerCase(), key);
    if (c && c.name) speakerNames.set(String(c.name).toLowerCase(), key);
  }

  for (const p of passages) {
    if (byName.has(p.name)) {
      const prev = byName.get(p.name);
      errors.push({ file: p.file, line: p.line, passage: p.name, msg: `duplicate passage name (also in ${prev.file}:${prev.line})` });
    } else byName.set(p.name, p);
  }

  const out = { passages: {}, init: [], css: [], js: [] };
  const refs = []; // {from, target, file, line, kind}

  for (const p of passages) {
    if (p.tags.includes('stylesheet')) {
      out.css.push(`/* ${p.name} */\n${p.text}`);
      continue;
    }
    if (p.tags.includes('script')) {
      out.js.push(`/* ${p.name} */\n${p.text}`);
      continue;
    }
    if (p.name === 'StoryTitle' || p.name === 'StoryData') continue;
    if (out.passages[p.name]) continue; // duplicate already reported
    const ctx = { p, errors, warnings, refs, usedAssets, varsRead, varsSet, assetIndex, config, speakerNames, assets: new Set() };
    const ops = compileBody(p.text, ctx);
    const links = [...new Set(refs.filter((r) => r.from === p.name).map((r) => r.target))];
    out.passages[p.name] = { tags: p.tags, ops, assets: [...ctx.assets], links };
    if (p.name === 'StoryInit') out.init = ops;
  }

  // ----- cross-passage validation -----
  const start = config.start || startName || (byName.has('Start') ? 'Start' : passages.find((p) => !SPECIAL.has(p.name) && !p.tags.includes('script') && !p.tags.includes('stylesheet'))?.name);
  if (!start || !out.passages[start]) {
    errors.push({ file: 'darkroom.json', line: 0, passage: '', msg: `start passage "${start ?? ''}" does not exist` });
  }
  for (const r of refs) {
    if (!out.passages[r.target]) {
      const close = [...Object.keys(out.passages)].find((n) => n.toLowerCase() === r.target.toLowerCase());
      errors.push({ file: r.file, line: r.line, passage: r.from, msg: `${r.kind} to missing passage "${r.target}"${close ? ` (did you mean "${close}"?)` : ''}` });
    }
  }

  // reachability
  const reach = new Set();
  const queue = [start, 'StoryInit'].filter((n) => out.passages[n]);
  while (queue.length) {
    const n = queue.shift();
    if (reach.has(n)) continue;
    reach.add(n);
    for (const t of out.passages[n].links) if (out.passages[t] && !reach.has(t)) queue.push(t);
  }
  for (const [name, ps] of Object.entries(out.passages)) {
    const src = byName.get(name);
    if (!reach.has(name) && !SPECIAL.has(name) && !ps.tags.includes('widget')) {
      warnings.push({ file: src.file, line: src.line, passage: name, msg: 'passage is never reached from the start' });
    }
    if (reach.has(name) && !SPECIAL.has(name) && !endsSomewhere(ps.ops)) {
      warnings.push({ file: src.file, line: src.line, passage: name, msg: 'dead end: no choices, @goto or @ending' });
    }
  }

  for (const [v, loc] of varsRead) {
    if (!varsSet.has(v)) warnings.push({ ...loc, msg: `$${v} is read but never set (typo? set it in StoryInit)` });
  }

  out.start = start;
  return { story: out, errors, warnings, info, usedAssets, reach };
}

function endsSomewhere(ops) {
  for (const op of ops) {
    if (op.t === 'choice' || op.t === 'goto' || op.t === 'ending' || op.t === 'include') return true;
    if (op.t === 'text' && /data-goto=/.test(op.html)) return true;
    if (op.t === 'if' && (op.branches.some((b) => endsSomewhere(b.ops)) || (op.else && endsSomewhere(op.else)))) return true;
  }
  return false;
}

function compileBody(text, ctx) {
  const { p } = ctx;
  // Strip /* block */ and <!-- html --> comments but keep line numbers stable.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
  const lines = stripped.split('\n');
  const root = [];
  const stack = [{ kind: 'root', ops: root }];
  let para = [];
  let paraLine = 0;
  const cur = () => stack[stack.length - 1].ops;
  const loc = (ln) => ({ file: p.file, line: p.line + ln + 1, passage: p.name });
  const err = (ln, msg) => ctx.errors.push({ ...loc(ln), msg });
  const warn = (ln, msg) => ctx.warnings.push({ ...loc(ln), msg });

  const expr = (src, ln, statement = false) => {
    const js = translateExpr(src);
    try {
      checkExpr(js, statement);
    } catch (e) {
      err(ln, `bad expression "${src}": ${e.message}`);
    }
    for (const v of variablesIn(src)) if (!ctx.varsRead.has(v)) ctx.varsRead.set(v, loc(ln));
    for (const v of assignedIn(src)) ctx.varsSet.add(v);
    return js;
  };

  const asset = (ref, kind, ln) => {
    const r = resolveAsset(ctx.assetIndex, ref, kind);
    if (r.error) {
      err(ln, `@${kind} ${ref}: ${r.error}`);
      return null;
    }
    const u = ctx.usedAssets.get(r.rel) ?? { kinds: new Set(), refs: [] };
    u.kinds.add(kind);
    u.refs.push(loc(ln));
    ctx.usedAssets.set(r.rel, u);
    ctx.assets.add(r.rel);
    return r.rel;
  };

  const ref = (target, ln, kind) => ctx.refs.push({ from: p.name, target, ...loc(ln), kind });

  // Inline text: interpolation, links, raw-HTML media, light markdown.
  const richText = (src, ln, x = []) => {
    // 1. pull links out first so their setters are not touched by interpolation
    const links = [];
    let s = src.replace(LINK_RE, (m, inner) => {
      const l = parseLink(inner);
      ref(l.target, ln, 'link');
      const set = l.setter ? ` data-set="${escapeHtml(expr(l.setter, ln, true))}"` : '';
      const label = richText(l.text, ln, x).html;
      links.push(`<a class="dr-link" data-goto="${escapeHtml(l.target)}"${set}>${label}</a>`);
      return `\u0002${links.length - 1}\u0002`;
    });
    // 2. {$var}, {= expression} and naked $var (SugarCube style)
    s = s.replace(/\{(=\s*[^{}]+|\$[A-Za-z_][\w.]*)\}/g, (m, body) => {
      x.push(expr(body.startsWith('=') ? body.slice(1) : body, ln));
      return `\u0001${x.length - 1}\u0001`;
    });
    s = s.replace(/(^|[^\w\\])\$([A-Za-z_]\w*)(?![\w(])/g, (m, pre, v) => {
      x.push(expr(`$${v}`, ln));
      return `${pre}\u0001${x.length - 1}\u0001`;
    });
    // 3. media referenced from raw HTML (<img src="...">) is resolved against assets/
    s = s.replace(/\b(src|poster)=(["'])([^"':]+?)\2/g, (m, a, q, url) => {
      if (/^(https?:|data:|#|\/)/.test(url)) return m;
      const rel = asset(url, 'any', ln);
      return rel ? `${a}=${q}assets/${rel}${q}` : m;
    });
    // 4. **bold** and *italic* outside of tags
    s = s
      .split(/(<[^>]+>)/)
      .map((seg) => (seg.startsWith('<') ? seg : seg.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')))
      .join('');
    s = s.replace(/\u0002(\d+)\u0002/g, (m, i) => links[+i]);
    return { html: s, x };
  };

  const flush = () => {
    if (!para.length) return;
    let first = para[0];
    let who = null;
    const sm = first.match(/^\s*([^:<>\[\]]{1,32}):\s+(.*)$/);
    if (sm && ctx.speakerNames.has(sm[1].trim().toLowerCase())) {
      who = ctx.speakerNames.get(sm[1].trim().toLowerCase());
      first = sm[2];
    }
    const { html, x } = richText([first, ...para.slice(1)].join('\n').trim().replace(/\n/g, '<br>'), paraLine);
    const op = { t: 'text', html };
    if (who) op.who = who;
    if (x.length) op.x = x;
    cur().push(op);
    para = [];
  };

  lines.forEach((raw, ln) => {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) return flush();

    if (trimmed.startsWith('@') && /^@[a-z]/i.test(trimmed)) {
      flush();
      const m = trimmed.match(/^@([A-Za-z]+)\s*(.*)$/);
      const name = m[1].toLowerCase();
      const rest = m[2].trim();
      directive(name, rest, ln);
      return;
    }

    // A line made only of links becomes a list of choices.
    const withoutLinks = trimmed.replace(LINK_RE, '').trim();
    if (trimmed.includes('[[') && withoutLinks === '') {
      flush();
      for (const lm of trimmed.matchAll(LINK_RE)) {
        const l = parseLink(lm[1]);
        ref(l.target, ln, 'choice');
        const { html, x } = richText(l.text, ln);
        const op = { t: 'choice', html, target: l.target };
        if (x.length) op.x = x;
        if (l.setter) op.set = expr(l.setter, ln, true);
        cur().push(op);
      }
      return;
    }
    // A line starting with a character's name always starts a new beat.
    const sm = trimmed.match(/^([^:<>\[\]]{1,32}):\s/);
    if (para.length && sm && ctx.speakerNames.has(sm[1].trim().toLowerCase())) flush();
    if (!para.length) paraLine = ln;
    para.push(trimmed);
    // By default every line is its own beat (click to advance). "beat": "paragraph" groups lines
    // until a blank line, which suits long Twine-style prose.
    if (ctx.config.beat !== 'paragraph') flush();
  });
  flush();
  if (stack.length > 1) err(stack[stack.length - 1].line, `@${stack[stack.length - 1].kind} is never closed with @endif`);
  return root;

  function directive(name, rest, ln) {
    const { pos, kv } = parseArgs(rest);
    const fade = num(kv.fade, undefined);
    switch (name) {
      case 'bg': {
        if (!pos[0]) return err(ln, '@bg needs a file name');
        if (pos[0] === 'none' || pos[0] === 'clear' || pos[0] === 'black') return cur().push({ t: 'bg', src: null, fade });
        const rel = asset(pos[0], 'bg', ln);
        if (!rel) return;
        const isVideo = mediaType(rel) === 'video';
        const op = { t: isVideo ? 'bgvideo' : 'bg', src: rel };
        if (fade !== undefined) op.fade = fade;
        if (kv.fit) op.fit = kv.fit;
        if (kv.pos) op.pos = kv.pos;
        if (kv.move) op.move = kv.move;
        if (kv.time) op.time = num(kv.time, 20);
        if (kv.filter) op.filter = kv.filter;
        return cur().push(op);
      }
      case 'bgvideo': {
        const rel = pos[0] && asset(pos[0], 'bgvideo', ln);
        if (rel) cur().push({ t: 'bgvideo', src: rel, fade, fit: kv.fit });
        return;
      }
      case 'image': {
        if (!pos[0] || pos[0] === 'clear' || pos[0] === 'none') return cur().push({ t: 'image', src: null, fade, id: kv.id });
        const rel = asset(pos[0], 'image', ln);
        if (rel) cur().push({ t: 'image', src: rel, pos: kv.pos || pos[1] || 'center', fade, id: kv.id, width: kv.width });
        return;
      }
      case 'music':
      case 'ambience': {
        if (!pos[0] || pos[0] === 'stop' || pos[0] === 'none') return cur().push({ t: name, src: null, fade });
        const rel = asset(pos[0], name, ln);
        if (rel) cur().push({ t: name, src: rel, fade, volume: num(kv.volume, 1), loop: bool(kv.loop, true) });
        return;
      }
      case 'sfx':
      case 'voice': {
        const rel = pos[0] && asset(pos[0], name, ln);
        if (rel) cur().push({ t: name, src: rel, volume: num(kv.volume, 1) });
        else if (!pos[0]) err(ln, `@${name} needs a file name`);
        return;
      }
      case 'stop':
        return cur().push({ t: 'stop', ch: pos[0] || 'all', fade });
      case 'video': {
        const rel = pos[0] && asset(pos[0], 'video', ln);
        if (rel) cur().push({ t: 'video', src: rel, skip: bool(kv.skip, true), volume: num(kv.volume, 1), fit: kv.fit });
        else if (!pos[0]) err(ln, '@video needs a file name');
        return;
      }
      case 'wait':
        return cur().push({ t: 'wait', s: num(pos[0], 1) });
      case 'set':
        if (!rest) return err(ln, '@set needs an expression, e.g. @set $trust = 1');
        return cur().push({ t: 'set', js: expr(rest, ln, true) });
      case 'run':
        // @run may assign anything; treat every variable it mentions as set
        for (const v of variablesIn(rest)) ctx.varsSet.add(v);
        return cur().push({ t: 'run', js: expr(rest, ln, true) });
      case 'if': {
        if (!rest) return err(ln, '@if needs a condition');
        const op = { t: 'if', branches: [{ js: expr(rest, ln), ops: [] }], else: null };
        cur().push(op);
        stack.push({ kind: 'if', op, ops: op.branches[0].ops, line: ln });
        return;
      }
      case 'elseif':
      case 'elif': {
        const top = stack[stack.length - 1];
        if (top.kind !== 'if' || top.op.else) return err(ln, '@elseif without a matching @if');
        const b = { js: expr(rest, ln), ops: [] };
        top.op.branches.push(b);
        top.ops = b.ops;
        return;
      }
      case 'else': {
        const top = stack[stack.length - 1];
        if (top.kind !== 'if' || top.op.else) return err(ln, '@else without a matching @if');
        top.op.else = [];
        top.ops = top.op.else;
        return;
      }
      case 'endif':
      case 'end': {
        if (stack.length < 2) return err(ln, '@endif without a matching @if');
        stack.pop();
        return;
      }
      case 'goto':
      case 'include': {
        const target = unquote(rest.trim());
        if (!target) return err(ln, `@${name} needs a passage name`);
        ref(target, ln, `@${name}`);
        return cur().push({ t: name, target });
      }
      case 'ending': {
        const id = pos[0];
        if (!id) return err(ln, '@ending needs an id, e.g. @ending drowned "The River Takes Her"');
        return cur().push({ t: 'ending', id, title: pos.slice(1).join(' ') || kv.title || id });
      }
      case 'card':
        return cur().push({ t: 'card', title: pos[0] || '', sub: pos[1] || kv.sub || '', s: num(kv.time, 0) });
      case 'clear':
        return cur().push({ t: 'clear' });
      case 'textbox':
        return cur().push({ t: 'textbox', show: !/^(hide|off|false)$/i.test(pos[0] || 'show') });
      case 'fx':
        return cur().push({ t: 'fx', kind: pos[0] || 'flash', color: kv.color, s: num(kv.time, undefined) });
      case 'speed':
        return cur().push({ t: 'speed', cps: num(pos[0], 0) });
      case 'todo':
        warn(ln, `TODO: ${rest}`);
        return;
      default:
        err(ln, `unknown directive @${name}`);
    }
  }
}
