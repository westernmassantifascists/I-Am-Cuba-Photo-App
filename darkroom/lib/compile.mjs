// Turns Twine passages into Darkroom story data: a list of ops per passage that the runtime plays
// in order, plus a full validation report (broken links, missing media, bad expressions, ...).

import { translateExpr, checkExpr, variablesIn, assignedIn } from './expr.mjs';
import { resolveAsset, mediaType } from './assets.mjs';
import { motifIndex } from './library.mjs';

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

// Special link / @goto targets that are worked out while playing:
//   @resume                      back to where the player was heading before a threshold turn
//   @drift town else=Evening     the unvisited "town" scene that best fits the current feelings
export function parseSpecial(target) {
  const t = target.trim();
  if (t === '@resume') return { kind: 'resume' };
  // @walk: close the text and hand control back to the world (engines with a world, e.g. Godot)
  if (t === '@walk') return { kind: 'walk' };
  const m = t.match(/^@drift\s+(\S+)(?:\s+else\s*=\s*(.+))?$/);
  if (m) return { kind: 'drift', pool: m[1], else: m[2] ? m[2].trim().replace(/^(["'])(.*)\1$/, '$2') : null };
  if (t.startsWith('@')) return { kind: 'bad' };
  return null;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// "dread+20 longing-5" in a link setter changes meters (kept within their range).
const NUDGE_RE = /^(\s*\$?[A-Za-z_]\w*\s*[+-]\s*\d+(?:\.\d+)?\s*)+$/;
export function parseNudge(src) {
  if (!src || !NUDGE_RE.test(src) || /[=]/.test(src)) return null;
  const out = {};
  for (const m of src.matchAll(/\$?([A-Za-z_]\w*)\s*([+-])\s*(\d+(?:\.\d+)?)/g)) out[m[1]] = (m[2] === '-' ? -1 : 1) * parseFloat(m[3]);
  return out;
}

// ---------- compiler ----------

export function compileStory({ passages, startName, config, assetIndex, library = new Map() }) {
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

  const out = { passages: {}, init: [], css: [], js: [], pools: {}, turns: [] };
  const motifs = motifIndex(library);
  // Meters (e.g. grief, obsession) are variables the engine sets up, so they count as set.
  for (const m of Object.keys(config.meters || {})) varsSet.add(m);
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
    const ctx = { p, errors, warnings, refs, usedAssets, varsRead, varsSet, assetIndex, config, speakerNames, assets: new Set(), library, motifs, scene: null };
    const ops = compileBody(p.text, ctx);
    const links = [...new Set(refs.filter((r) => r.from === p.name).map((r) => r.target))];
    out.passages[p.name] = { tags: p.tags, ops, assets: [...ctx.assets], links };
    if (ctx.scene) out.passages[p.name].scene = ctx.scene;
    if (ctx.dynamicGoto) out.passages[p.name].dynamicGoto = true;
    if (ctx.when) out.passages[p.name].when = ctx.when;
    if (ctx.turn) out.turns.push({ passage: p.name, ...ctx.turn });
    const feel = p.tags.filter((t) => t.startsWith('feel-')).map((t) => t.slice(5));
    if (feel.length) out.passages[p.name].feel = feel;
    for (const t of p.tags) {
      if (!t.startsWith('drift-')) continue;
      (out.pools[t.slice(6)] ||= []).push(p.name);
    }
    for (const f of feel) {
      if (config.meters && !config.meters[f]) warnings.push({ file: p.file, line: p.line, passage: p.name, msg: `feel-${f}: "${f}" is not a meter in darkroom.json` });
    }
    if (p.name === 'StoryInit') out.init = ops;
  }

  // ----- cross-passage validation -----
  const start = config.start || startName || (byName.has('Start') ? 'Start' : passages.find((p) => !SPECIAL.has(p.name) && !p.tags.includes('script') && !p.tags.includes('stylesheet'))?.name);
  if (!start || !out.passages[start]) {
    errors.push({ file: 'darkroom.json', line: 0, passage: '', msg: `start passage "${start ?? ''}" does not exist` });
  }
  // Special targets: check the drift pool and its fallback, and make the pool reachable.
  for (const r of refs) {
    const sp = parseSpecial(r.target);
    if (!sp) continue;
    r.special = true;
    const ps = out.passages[r.from];
    if (sp.kind === 'walk') continue;
    if (sp.kind === 'bad') errors.push({ file: r.file, line: r.line, passage: r.from, msg: `"${r.target}" is not a known target (use @drift <pool>, @resume or @walk)` });
    if (sp.kind === 'resume' && !out.turns.length) warnings.push({ file: r.file, line: r.line, passage: r.from, msg: '@resume is only meaningful in a passage with @turn' });
    if (sp.kind === 'drift') {
      if (!out.pools[sp.pool]) errors.push({ file: r.file, line: r.line, passage: r.from, msg: `@drift ${sp.pool}: no passages are tagged drift-${sp.pool}` });
      else ps.links.push(...out.pools[sp.pool]);
      if (sp.else) {
        if (!out.passages[sp.else]) errors.push({ file: r.file, line: r.line, passage: r.from, msg: `@drift ${sp.pool} else=${sp.else}: no such passage` });
        else ps.links.push(sp.else);
      } else warnings.push({ file: r.file, line: r.line, passage: r.from, msg: `@drift ${sp.pool} has no else=: once every scene in the pool is visited, the story stops here` });
    }
  }
  for (const ps of Object.values(out.passages)) ps.links = [...new Set(ps.links)];
  for (const r of refs) {
    if (r.special) continue;
    if (!out.passages[r.target]) {
      const close = [...Object.keys(out.passages)].find((n) => n.toLowerCase() === r.target.toLowerCase());
      errors.push({ file: r.file, line: r.line, passage: r.from, msg: `${r.kind} to missing passage "${r.target}"${close ? ` (did you mean "${close}"?)` : ''}` });
    }
  }

  // reachability
  const reach = new Set();
  // Threshold turns can happen from anywhere, and passages placed in a game world (at-<place>
  // tags) are reached by walking there, so both count as reachable.
  const placed = Object.entries(out.passages).filter(([, ps]) => ps.tags.some((t) => t.startsWith('at-'))).map(([n]) => n);
  const queue = [start, 'StoryInit', ...out.turns.map((t) => t.passage), ...placed].filter((n) => out.passages[n]);
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
    if (reach.has(name) && !SPECIAL.has(name) && !ps.dynamicGoto && !endsSomewhere(ps.ops)) {
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

  const use = (rel, kind, ln) => {
    const u = ctx.usedAssets.get(rel) ?? { kinds: new Set(), refs: [] };
    u.kinds.add(kind);
    u.refs.push(loc(ln));
    ctx.usedAssets.set(rel, u);
    ctx.assets.add(rel);
    return rel;
  };
  const asset = (ref, kind, ln) => {
    // An id from library.json ("arch20") works anywhere a file name does.
    const lib = ctx.library.get(ref);
    if (lib) {
      if (lib.still) use(ctx.library.get(lib.still).rel, 'bg', ln);
      return use(lib.rel, kind, ln);
    }
    const r = resolveAsset(ctx.assetIndex, ref, kind);
    if (r.error) {
      err(ln, `@${kind} ${ref}: ${r.error}`);
      return null;
    }
    return use(r.rel, kind, ln);
  };
  // Mood names from darkroom.json "scene.music" / "scene.ambience" (e.g. music-mourning -> le_cygne).
  // Returns undefined when the name is not a mood, { src: null } for a silent mood.
  const mood = (kind, name, ln) => {
    const map = ctx.config.scene?.[kind];
    if (!map || !Object.prototype.hasOwnProperty.call(map, name)) return undefined;
    const v = map[name];
    if (v === null || v === '' || v === 'silence') return { src: null };
    const rel = asset(v, kind, ln);
    return rel ? { src: rel } : { src: null };
  };

  // Passage tags describe the scene: motif-canal sound-water music-mourning atmosphere-fog look-quiet shot-arch20
  const tagged = {};
  for (const tag of p.tags) {
    const m = tag.match(/^(motif|atmosphere|sound|music|overlay|look|shot)-(.+)$/);
    if (m) tagged[m[1]] = m[2];
  }
  if (Object.keys(tagged).length) {
    const sc = {};
    const al = ctx.config.scene?.aliases || {};
    const hl = -1; // header line
    if (tagged.shot) {
      if (ctx.library.has(tagged.shot)) {
        sc.shot = tagged.shot;
        const e = ctx.library.get(tagged.shot);
        use(e.rel, 'bg', hl);
        if (e.still) use(ctx.library.get(e.still).rel, 'bg', hl);
      } else err(hl, `shot-${tagged.shot}: no asset with that id in library.json`);
    }
    if (tagged.motif) {
      sc.motif = al.motif?.[tagged.motif] ?? tagged.motif;
      if (!ctx.motifs.has(sc.motif) && !sc.shot) warn(hl, `motif-${tagged.motif}: no picture in library.json has the motif "${sc.motif}"`);
      for (const e of ctx.library.values()) {
        if (!e.motifs.includes(sc.motif)) continue;
        use(e.rel, 'bg', hl);
        if (e.still) use(ctx.library.get(e.still).rel, 'bg', hl);
      }
    }
    for (const [tag, kind] of [['music', 'music'], ['sound', 'ambience']]) {
      if (!tagged[tag]) continue;
      const name = tag === 'sound' && al.sound && Object.prototype.hasOwnProperty.call(al.sound, tagged[tag]) ? al.sound[tagged[tag]] : tagged[tag];
      let r = name === null || name === 'silence' || name === 'none' ? (mood(kind, name, hl) ?? { src: null }) : mood(kind, name, hl);
      if (r === undefined) {
        // not a mood name: a file of that name in the matching folder (music-theme -> assets/music/theme.m4a)
        const f = resolveAsset(ctx.assetIndex, name, kind);
        if (!f.error && f.rel.toLowerCase().startsWith(`${kind}/`)) r = { src: use(f.rel, kind, hl) };
      }
      if (r === undefined) warn(hl, `${tag}-${tagged[tag]}: no ${kind} mood "${name}" (run darkroom develop, or map it in darkroom.json scene.${kind}) and no file assets/${kind}/${name}`);
      else sc[kind] = r.src;
    }
    if (tagged.look) {
      if (tagged.look !== 'neutral' && !ctx.config.scene?.looks?.[tagged.look]) warn(hl, `look-${tagged.look}: no look of that name (developed moods: ${Object.keys(ctx.config.scene?.looks || {}).join(', ') || 'none yet, run darkroom develop'})`);
      sc.look = tagged.look;
    }
    if (tagged.atmosphere) sc.atmosphere = al.atmosphere?.[tagged.atmosphere] ?? tagged.atmosphere;
    if (tagged.overlay) sc.overlay = tagged.overlay;
    ctx.scene = sc;
  }

  const ref = (target, ln, kind) => ctx.refs.push({ from: p.name, target, ...loc(ln), kind });

  // Inline text: interpolation, links, raw-HTML media, light markdown.
  const richText = (src, ln, x = []) => {
    // 1. pull links out first so their setters are not touched by interpolation
    const links = [];
    let s = src.replace(LINK_RE, (m, inner) => {
      const l = parseLink(inner);
      ref(l.target, ln, 'link');
      const nd = parseNudge(l.setter);
      if (nd) for (const k of Object.keys(nd)) ctx.varsSet.add(k);
      const set = nd ? ` data-nudge="${escapeHtml(JSON.stringify(nd))}"` : l.setter ? ` data-set="${escapeHtml(expr(l.setter, ln, true))}"` : '';
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

  const BLOCK = /<(\/?)(div|section|article|aside|header|footer|figure|ul|ol|table|blockquote|nav|main|details|center)\b[^>]*>/gi;
  const depthChange = (line) => {
    let d = 0;
    for (const m of line.matchAll(BLOCK)) d += m[1] ? -1 : 1;
    return d;
  };
  let htmlDepth = 0;
  let paraIsBlock = false;

  const flush = () => {
    if (!para.length) return;
    if (paraIsBlock) {
      const { html, x } = richText(para.join('\n'), paraLine);
      const op = { t: 'text', html, block: true };
      if (x.length) op.x = x;
      cur().push(op);
      para = [];
      paraIsBlock = false;
      htmlDepth = 0;
      return;
    }
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
    // Inside a multi-line HTML block (<div> ... </div>) everything but @directives is part of the block.
    if (htmlDepth > 0 && !/^@[a-z]/i.test(trimmed)) {
      para.push(line);
      htmlDepth += depthChange(trimmed);
      if (htmlDepth <= 0) flush();
      return;
    }
    if (!trimmed) return flush();
    if (/^<(div|section|article|aside|header|footer|figure|ul|ol|table|blockquote|nav|main|details|center)\b/i.test(trimmed)) {
      flush();
      paraLine = ln;
      para.push(line);
      paraIsBlock = true;
      htmlDepth = depthChange(trimmed);
      if (htmlDepth <= 0) flush();
      return;
    }

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
        const nd = parseNudge(l.setter);
        if (nd) {
          op.nudge = nd;
          for (const k of Object.keys(nd)) ctx.varsSet.add(k);
        } else if (l.setter) op.set = expr(l.setter, ln, true);
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
  if (htmlDepth > 0) warn(paraLine, 'an HTML block (<div>…) is never closed');
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
        const md = mood(name, pos[0], ln);
        if (md) return cur().push({ t: name, src: md.src, fade, volume: num(kv.volume, undefined), loop: true, mood: pos[0] });
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
        if (name === 'goto' && rest.trim().startsWith('=')) {
          // @goto = $next or "Market"  — the target is worked out while playing
          ctx.dynamicGoto = true;
          return cur().push({ t: 'goto', js: expr(rest.trim().slice(1), ln) });
        }
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
        return cur().push({ t: 'card', title: pos[0] || '', sub: pos[1] || kv.sub || '', kicker: kv.kicker || '', s: num(kv.time, 0) });
      case 'atmosphere':
      case 'overlay':
        return cur().push({ t: name, name: pos[0] || 'none' });
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
      case 'turn': {
        // @turn $dread >= 60 [once=false] — this passage interrupts the story when the condition holds
        if (stack.length > 1) return err(ln, '@turn belongs at the top level of a passage, not inside @if');
        const cond = rest.replace(/\s+once\s*=\s*(true|false)\s*$/i, '');
        if (!cond) return err(ln, '@turn needs a condition, e.g. @turn $dread >= 60');
        ctx.turn = { js: expr(cond, ln), once: !/once\s*=\s*false/i.test(rest) };
        return;
      }
      case 'when':
        // @when $longing > 20 — a drifting scene is only chosen while this holds
        if (stack.length > 1) return err(ln, '@when belongs at the top level of a passage');
        if (!rest) return err(ln, '@when needs a condition');
        ctx.when = expr(rest, ln);
        return;
      case 'drift':
        ref(`@drift ${rest}`, ln, '@drift');
        ctx.dynamicGoto = true;
        return cur().push({ t: 'goto', special: `@drift ${rest}` });
      case 'resume':
        ref('@resume', ln, '@resume');
        ctx.dynamicGoto = true;
        return cur().push({ t: 'goto', special: '@resume' });
      case 'motif': {
        // @motif canal look=quiet — let the engine choose a fitting picture from library.json
        if (!pos[0]) return err(ln, '@motif needs a motif, e.g. @motif canal');
        const m = ctx.config.scene?.aliases?.motif?.[pos[0]] ?? pos[0];
        if (!ctx.motifs.has(m)) warn(ln, `@motif ${pos[0]}: no picture in library.json has this motif`);
        // every picture with this motif may be shown, so all of them ship with the game
        for (const e of ctx.library.values()) if (e.motifs.includes(m)) use(e.rel, 'bg', ln);
        return cur().push({ t: 'motif', motif: m, look: kv.look, fade });
      }
      case 'look':
        if (!pos[0]) return err(ln, '@look needs a look name, e.g. @look mourning');
        if (pos[0] !== 'neutral' && !ctx.config.scene?.looks?.[pos[0]]) warn(ln, `@look ${pos[0]}: no look of that name (run darkroom develop, or add it to darkroom.json scene.looks)`);
        return cur().push({ t: 'look', look: pos[0] });
      case 'nudge': {
        // @nudge grief+4 obsession-1 — change meters, kept within their min/max
        const changes = {};
        for (const tok of rest.split(/[\s,]+/).filter(Boolean)) {
          const m = tok.match(/^\$?([A-Za-z_]\w*)\s*(?:=)?\s*([+-]?\d+(?:\.\d+)?)$/);
          if (!m) return err(ln, `@nudge: cannot read "${tok}" (write it like grief+4 or fracture-2)`);
          if (ctx.config.meters && !ctx.config.meters[m[1]]) warn(ln, `@nudge: "${m[1]}" is not a meter in darkroom.json`);
          changes[m[1]] = parseFloat(m[2]);
          ctx.varsSet.add(m[1]);
        }
        return cur().push({ t: 'nudge', changes });
      }
      case 'unset':
        for (const v of rest.split(/[\s,]+/).filter(Boolean)) cur().push({ t: 'set', js: `delete ${translateExpr(v)}` });
        return;
      default:
        err(ln, `unknown directive @${name}`);
    }
  }
}
