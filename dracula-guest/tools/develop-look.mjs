#!/usr/bin/env node
// Develops the game's look from its own material, the Darkroom way (darkroom/lib/develop.mjs):
// every scanned texture, every scan's surface photograph and every real sky is measured, then
//   - the grade (how saturated, how contrasty, which tint in the shadows and the highlights)
//   - the picture moods (groups of material that share a character, each becoming a look-<mood>)
//   - the interface palette (text, accent, paper)
// are taken from what the material actually is. Writes godot/data/look.json and look-board.html.
//   node tools/develop-look.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measureAll } from '../../darkroom/lib/measure.mjs';
import { developPictures, developPalette } from '../../darkroom/lib/develop.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = path.join(ROOT, 'godot', 'assets');
const PREVIEW = path.join(ROOT, '.cache', 'sky-preview');
fs.mkdirSync(PREVIEW, { recursive: true });

// What the piece is made of: surfaces, scans' own photographs, skies.
const files = [];
const add = (id, abs, group) => {
  const st = fs.statSync(abs);
  files.push({ id, group, rel: path.relative(ROOT, abs).split(path.sep).join('/'), abs, bytes: st.size, mtimeMs: st.mtimeMs, type: 'image' });
};
for (const d of fs.readdirSync(path.join(A, 'textures'))) {
  const f = path.join(A, 'textures', d, `${d}_diff.jpg`);
  if (fs.existsSync(f)) add(d, f, 'surface');
}
for (const d of fs.readdirSync(path.join(A, 'scans'))) {
  const tex = path.join(A, 'scans', d, 'textures');
  if (!fs.existsSync(tex)) continue;
  const diff = fs.readdirSync(tex).filter((f) => /_diff_/.test(f));
  diff.forEach((f, i) => add(diff.length > 1 ? `${d}#${i + 1}` : d, path.join(tex, f), 'scan'));
}
for (const f of fs.readdirSync(path.join(A, 'sky'))) {
  const id = f.replace(/\.hdr$/, '');
  const out = path.join(PREVIEW, `${id}.jpg`);
  if (!fs.existsSync(out)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(A, 'sky', f), '-vf', 'scale=512:-2,format=rgb24', '-frames:v', '1', out]);
  if (fs.existsSync(out)) add(id, out, 'sky');
}

const m = await measureAll(ROOT, files, (n, rel) => process.stdout.isTTY && process.stdout.write(`\r  measuring ${n}/${files.length} ${rel.slice(-40).padEnd(40)}`));
if (process.stdout.isTTY) process.stdout.write('\n');
const pics = files.filter((f) => m.has(f.rel)).map((f) => ({ id: f.id, rel: f.rel, type: 'image', group: f.group, m: m.get(f.rel) }));
const dev = developPictures(pics);
const palette = developPalette(pics, dev.mono);

// CSS filter of a developed mood -> numbers for the Godot grade
const num = (filter, fn, def) => {
  const mm = (filter || '').match(new RegExp(`${fn}\\(([\\d.]+)\\)`));
  return mm ? +mm[1] : def;
};
const rgb = (hex) => [1, 3, 5].map((i) => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3));
const looks = {};
for (const [name, mood] of Object.entries(dev.moods)) {
  looks[name] = {
    words: mood.words,
    brightness: num(mood.look.filter, 'brightness', 1),
    contrast: num(mood.look.filter, 'contrast', 1),
    saturation: num(mood.look.filter, 'saturate', 1),
    sepia: num(mood.look.filter, 'sepia', 0),
    tint: rgb(mood.tint),
    members: mood.pictures,
  };
}
// The base grade: as saturated as the collection is, split-toned with its darkest and lightest colours.
const meanSat = pics.reduce((s, p) => s + p.m.sat, 0) / pics.length;
const meanContrast = pics.reduce((s, p) => s + p.m.contrast, 0) / pics.length;
const grade = {
  saturation: +Math.min(1, Math.max(0.15, meanSat * 2.2)).toFixed(2),
  contrast: +Math.min(1.35, Math.max(1.0, 0.95 + (0.22 - meanContrast) * 1.5)).toFixed(2),
  shadow_tint: rgb(palette.bg.replace(/^#/, '#')).map((v) => +Math.min(1, v * 6).toFixed(3)),
  highlight_tint: rgb(palette.text),
  grain: +Math.min(0.09, Math.max(0.035, meanContrast * 0.35)).toFixed(3),
};
const skies = {};
for (const p of pics.filter((x) => x.group === 'sky')) skies[p.id] = p.mood;

const out = {
  note: 'Developed from this piece\'s own scans, textures and skies by tools/develop-look.mjs (Darkroom develop). Rewritten each time.',
  collection: { pictures: pics.length, monochrome: dev.mono, mean: dev.mean },
  grade,
  palette,
  looks,
  skies,
  qualities: Object.fromEntries(pics.map((p) => [p.id, p.qualities])),
};
fs.writeFileSync(path.join(ROOT, 'godot', 'data', 'look.json'), JSON.stringify(out, null, 1));

// a small board to look at
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const img = (p) => `<figure><img src="${esc(path.relative(ROOT, path.join(ROOT, p.rel)))}" alt=""><figcaption>${esc(p.id)}</figcaption></figure>`;
const html = `<!doctype html><meta charset="utf-8"><title>Dracula's Guest — look</title>
<style>body{background:${palette.bg};color:${palette.text};font:15px/1.5 system-ui,sans-serif;margin:0}main{max-width:1100px;margin:auto;padding:24px 16px}
h2{font-weight:400;color:${palette.accent}}.row{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;width:150px}img{width:150px;height:100px;object-fit:cover;display:block}
figcaption{font-size:11px;opacity:.7}.sw{display:inline-block;width:60px;height:30px;border:1px solid #8884;vertical-align:middle;margin-right:6px}</style><main>
<h1>Look developed from the material</h1>
<p>${pics.length} pictures${dev.mono ? ' (reads as monochrome)' : ''}. Grade: saturation ${grade.saturation}, contrast ${grade.contrast}, grain ${grade.grain}.
<span class="sw" style="background:rgb(${grade.shadow_tint.map((v) => v * 255).join(',')})"></span>shadows
<span class="sw" style="background:rgb(${grade.highlight_tint.map((v) => v * 255).join(',')})"></span>highlights
<span class="sw" style="background:${palette.accent}"></span>accent</p>
${Object.entries(dev.moods).map(([n, md]) => `<h2>${esc(n)} <small>${esc(md.words.join(' · '))}</small></h2><div class="row">${pics.filter((p) => p.mood === n).map(img).join('')}</div>`).join('\n')}
</main>`;
fs.writeFileSync(path.join(ROOT, 'look-board.html'), html);

console.log(`Developed from ${pics.length} pictures${dev.mono ? ' (monochrome)' : ''}.`);
console.log(`Grade: saturation ${grade.saturation}, contrast ${grade.contrast}, grain ${grade.grain}`);
for (const [n, l] of Object.entries(looks)) console.log(`  ${n.padEnd(18)} ${l.words.join(' · ').padEnd(26)} ${l.members.length} pictures (${l.members.filter((x) => skies[x] !== undefined).join(', ') || 'no skies'})`);
console.log('Skies:', JSON.stringify(skies));
