#!/usr/bin/env node
// Compiles story/*.twee with the Darkroom compiler and writes godot/data/story.json for the
// Godot runtime (godot/scripts/story.gd). Expressions are rewritten for Godot's Expression class,
// assignments become { var, op, expr } steps, and the text's HTML becomes BBCode.
//   node tools/compile-story.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, printReport } from '../../darkroom/lib/project.mjs';
import { loadStoryDir } from '../../darkroom/lib/twine.mjs';
import { indexAssets } from '../../darkroom/lib/assets.mjs';
import { compileStory } from '../../darkroom/lib/compile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig(ROOT);
const assetIndex = indexAssets(path.join(ROOT, 'godot', 'assets'));
// Film clips come from tools/fetch.mjs; count the ones sources.json promises as present, so the
// story keeps its film cues even before they are downloaded (the game skips missing clips).
const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'), 'utf8'));
for (const f of sources.films) {
  for (const c of f.clips) {
    const rel = `film/${c.id}.ogv`;
    if (!assetIndex.files.has(rel)) {
      assetIndex.files.set(rel, { rel, abs: null, bytes: 0, mtimeMs: 0, type: 'video', planned: true });
      assetIndex.lower.set(rel.toLowerCase(), rel);
    }
  }
}
const { passages, startName } = loadStoryDir(path.join(ROOT, 'story'));
const r = compileStory({ passages, startName, config, assetIndex });

const planned = [...assetIndex.files.values()].filter((f) => f.planned).map((f) => f.rel);
if (planned.length) r.info.push({ msg: `film not downloaded yet (${planned.join(', ')}): run node tools/fetch.mjs; the game skips missing clips` });
const problems = [];

// ---- expressions: Darkroom JS -> Godot Expression ----
const gd = (js) =>
  String(js)
    .replace(/S\._?([A-Za-z_]\w*)/g, (m, v) => `S["${m.startsWith('S._') ? '_' : ''}${v}"]`)
    .replace(/!==/g, '!=')
    .replace(/===/g, '==');

function assignment(js, where) {
  const del = js.match(/^delete\s+S\.(\w+)$/);
  if (del) return { t: 'unset', var: del[1] };
  const m = js.match(/^S\.(\w+)\s*(=|\+=|-=|\*=|\/=)\s*([\s\S]+)$/);
  if (!m) {
    problems.push(`${where}: Godot can only run simple assignments ($x = …, $x += …): "${js}"`);
    return { t: 'noop' };
  }
  return { t: 'set', var: m[1], op: m[2], expr: gd(m[3]) };
}

// ---- text: HTML -> BBCode ----
function bb(html) {
  return html
    .replace(/<div class="inscription">([\s\S]*?)<\/div>/g, '[center][font_size=26][b]$1[/b][/font_size][/center]')
    .replace(/<div class="telegram">([\s\S]*?)<\/div>/g, '[indent][i]$1[/i][/indent]')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<(strong|b)>/g, '[b]')
    .replace(/<\/(strong|b)>/g, '[/b]')
    .replace(/<(em|i)>/g, '[i]')
    .replace(/<\/(em|i)>/g, '[/i]')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function convert(ops, where) {
  return ops.map((op) => {
    const o = { ...op };
    if (o.html != null) o.text = bb(o.html);
    delete o.html;
    if (o.x) o.x = o.x.map(gd);
    if (o.t === 'set') return assignment(op.js, where);
    if (o.t === 'run') {
      problems.push(`${where}: @run is web-only and is skipped in Godot`);
      return { t: 'noop' };
    }
    if (o.t === 'choice' && o.set) o.set = assignment(o.set, where);
    if (o.t === 'if') {
      o.branches = o.branches.map((b) => ({ cond: gd(b.js), ops: convert(b.ops, where) }));
      if (o.else) o.else = convert(o.else, where);
    }
    if (o.t === 'goto' && o.js) o.expr = gd(o.js);
    delete o.js;
    // media: Godot finds files by their path under res://assets/
    if (o.src) o.src = `res://assets/${o.src}`;
    return o;
  });
}

const out = {
  format: 'darkroom-godot',
  version: 1,
  title: config.title,
  start: r.story.start,
  meters: config.meters,
  init: convert(r.story.init, 'StoryInit'),
  passages: {},
  pools: r.story.pools,
  turns: r.story.turns.map((t) => ({ passage: t.passage, cond: gd(t.js), once: t.once })),
  endings: [],
};
const endings = new Map();
for (const [name, p] of Object.entries(r.story.passages)) {
  const scene = {};
  for (const tag of p.tags) {
    const m = tag.match(/^(at|music|atmosphere|look|motif|sound|overlay)-(.+)$/);
    if (m) scene[m[1]] = m[2];
  }
  out.passages[name] = { tags: p.tags, scene, ops: convert(p.ops, name) };
  if (p.when) out.passages[name].when = gd(p.when);
  if (p.feel) out.passages[name].feel = p.feel;
  const walk = (ops) => ops.forEach((o) => (o.t === 'ending' ? endings.set(o.id, o.title) : o.t === 'if' && (o.branches.forEach((b) => walk(b.ops)), o.else && walk(o.else))));
  walk(p.ops);
}
out.endings = [...endings].map(([id, title]) => ({ id, title }));

printReport(r);
for (const p of problems) console.log(`warning ${p}`);
if (r.errors.length) {
  console.log(`\n${r.errors.length} error(s): story.json not written.`);
  process.exit(1);
}
fs.mkdirSync(path.join(ROOT, 'godot', 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'godot', 'data', 'story.json'), JSON.stringify(out, null, 1));
console.log(`\nWrote godot/data/story.json: ${Object.keys(out.passages).length} passages, ${out.turns.length} turns, pools ${Object.keys(out.pools).join(', ')}, ${out.endings.length} endings.`);
