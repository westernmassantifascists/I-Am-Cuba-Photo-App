// `darkroom develop`: let a piece's moods grow out of its own material.
//
// Every picture and sound is measured (lib/measure.mjs). Then, relative to *this* collection:
//  - each picture gets qualities (dark, soft, warm, restless …) that work as motifs;
//  - pictures are grouped into picture moods by tone and colour, named after what they share
//    ("dark-soft"); each mood gives a look (a filter that pulls any picture toward it), an
//    atmosphere (a tint taken from those pictures' colours) and a tag that picks those pictures;
//  - the interface palette (background, text, accent) is taken from the pictures' colours;
//  - music and ambience tracks are named by how they sound ("quiet-low", "busy-bright").
// The result is moods.json (regenerated each time: put your own changes in darkroom.json) and
// moodboard.html, a page that shows it all.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './project.mjs';
import { indexAssets, resolveAsset } from './assets.mjs';
import { syncLibrary, loadLibrary } from './library.mjs';
import { measureAll } from './measure.mjs';
import { hasFfmpeg } from './lean.mjs';

export const MOODS_FILE = 'moods.json';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- colour helpers ----------
const hex = (rgb) => `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
function toHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round);
}
const rgba = (rgb, a) => `rgba(${rgb.map(Math.round).join(', ')}, ${a})`;

// ---------- statistics ----------
function meanStd(values, floor) {
  const m = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length || 1));
  return { m, sd: Math.max(sd, floor) };
}

// Deterministic k-means (farthest-point start) on vectors; returns cluster index per item.
function kmeans(vectors, k, weights = null) {
  const n = vectors.length;
  if (k >= n) return vectors.map((_, i) => i);
  const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const cents = [vectors[vectors.reduce((best, v, i) => (v[0] < vectors[best][0] ? i : best), 0)].slice()];
  while (cents.length < k) {
    let far = 0;
    let fd = -1;
    vectors.forEach((v, i) => {
      const d = Math.min(...cents.map((c) => dist(v, c)));
      if (d > fd) (fd = d), (far = i);
    });
    cents.push(vectors[far].slice());
  }
  let assign = new Array(n).fill(0);
  for (let it = 0; it < 40; it++) {
    assign = vectors.map((v) => cents.reduce((best, c, j) => (dist(v, c) < dist(v, cents[best]) ? j : best), 0));
    for (let j = 0; j < k; j++) {
      const idx = assign.map((a, i) => (a === j ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      const w = idx.map((i) => (weights ? weights[i] : 1));
      const tw = w.reduce((a, b) => a + b, 0);
      cents[j] = cents[j].map((_, d) => idx.reduce((s, i, q) => s + vectors[i][d] * w[q], 0) / tw);
    }
  }
  return assign;
}

function uniqueName(words, taken) {
  let name = words.slice(0, 2).join('-') || 'even';
  if (taken.has(name) && words.length > 2) name = words.slice(0, 3).join('-');
  let n = 2;
  const base = name;
  while (taken.has(name)) name = `${base}-${n++}`;
  taken.add(name);
  return name;
}

// ---------- pictures ----------
const PIC_WORDS = { lum: ['bright', 'dark'], contrast: ['hard', 'soft'], sat: ['vivid', 'muted'], warmth: ['warm', 'cool'] };
const PIC_FLOOR = { lum: 0.03, contrast: 0.02, sat: 0.03, warmth: 0.01 };

function developPictures(pics) {
  // pics: [{ id, rel, type, m }]
  const mono = pics.reduce((s, p) => s + p.m.sat, 0) / pics.length < 0.1 && pics.every((p) => Math.abs(p.m.warmth) < 0.03);
  const dims = mono ? ['lum', 'contrast'] : ['lum', 'contrast', 'sat', 'warmth'];
  const st = Object.fromEntries(dims.map((d) => [d, meanStd(pics.map((p) => p.m[d]), PIC_FLOOR[d])]));
  const z = (p, d) => (p.m[d] - st[d].m) / st[d].sd;
  const videos = pics.filter((p) => p.type === 'video');
  const motion = meanStd(videos.map((v) => v.m.motion || 0), 0.004);

  for (const p of pics) {
    const words = dims
      .map((d) => ({ d, z: z(p, d) }))
      .filter((x) => Math.abs(x.z) >= 0.5)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .map((x) => PIC_WORDS[x.d][x.z > 0 ? 0 : 1]);
    if (p.type === 'video') {
      const mz = videos.length > 2 ? ((p.m.motion || 0) - motion.m) / motion.sd : (p.m.motion || 0) > 0.012 ? 1 : -1;
      words.push(mz > 0 ? 'restless' : 'still', 'moving');
    }
    p.qualities = words;
  }

  // Group into moods.
  const k = pics.length <= 2 ? 1 : pics.length <= 4 ? 2 : clamp(Math.round(Math.sqrt(pics.length)), 2, 6);
  const assign = kmeans(pics.map((p) => dims.map((d) => z(p, d))), k);
  const groups = new Map();
  pics.forEach((p, i) => (groups.get(assign[i]) || groups.set(assign[i], []).get(assign[i])).push(p));
  const taken = new Set();
  const moods = {};
  const ordered = [...groups.values()].sort((a, b) => avg(a, 'lum') - avg(b, 'lum'));
  function avg(list, key) {
    return list.reduce((s, p) => s + p.m[key], 0) / list.length;
  }
  for (const members of ordered) {
    const cz = Object.fromEntries(dims.map((d) => [d, members.reduce((s, p) => s + z(p, d), 0) / members.length]));
    const words = dims
      .filter((d) => Math.abs(cz[d]) >= 0.25)
      .sort((a, b) => Math.abs(cz[b]) - Math.abs(cz[a]))
      .map((d) => PIC_WORDS[d][cz[d] > 0 ? 0 : 1]);
    const name = uniqueName(words, taken);

    // look: pull any picture toward this group's tone
    const parts = [];
    const b = clamp(avg(members, 'lum') / st.lum.m, 0.55, 1.6);
    const c = clamp(avg(members, 'contrast') / st.contrast.m, 0.6, 1.6);
    if (Math.abs(b - 1) > 0.04) parts.push(`brightness(${r2(b)})`);
    if (Math.abs(c - 1) > 0.04) parts.push(`contrast(${r2(c)})`);
    if (!mono) {
      const s = clamp(avg(members, 'sat') / st.sat.m, 0.25, 1.8);
      if (Math.abs(s - 1) > 0.04) parts.push(`saturate(${r2(s)})`);
      const dw = avg(members, 'warmth') - st.warmth.m;
      if (dw > 0.015) parts.push(`sepia(${r2(Math.min(0.45, dw * 5))})`);
    }

    // atmosphere: a tint made of these pictures' own colours
    let tw = 0;
    const acc = [0, 0, 0];
    for (const p of members) {
      for (const col of p.m.colours || []) {
        const l = toHsl(col.rgb)[2];
        const w = col.share * (0.3 + l); // favour the visible colours over the blacks
        acc[0] += col.rgb[0] * w;
        acc[1] += col.rgb[1] * w;
        acc[2] += col.rgb[2] * w;
        tw += w;
      }
    }
    const tint = acc.map((v) => v / (tw || 1));
    const [h, s] = toHsl(tint);
    const light = fromHsl([h, Math.min(0.6, s * 1.4), 0.7]);
    const deep = fromHsl([h, Math.min(0.6, s * 1.2), 0.08]);
    const atmosphere = `radial-gradient(ellipse at 50% 35%, ${rgba(light, 0.1)}, transparent 60%), linear-gradient(180deg, ${rgba(tint, 0.12)}, ${rgba(deep, 0.34)})`;
    for (const p of members) {
      p.mood = name;
      if (!p.qualities.includes(name)) p.qualities.push(name);
    }
    moods[name] = { words, look: { opacity: 1, filter: parts.join(' ') }, tint: hex(tint), atmosphere, pictures: members.map((p) => p.id) };
  }
  return { mono, moods, mean: Object.fromEntries(dims.map((d) => [d, +st[d].m.toFixed(3)])) };
}

// ---------- interface palette from the pictures' colours ----------
function developPalette(pics, mono) {
  const cols = pics.flatMap((p) => (p.m.colours || []).map((c) => ({ rgb: c.rgb, w: c.share })));
  if (!cols.length) return null;
  const k = Math.min(5, cols.length);
  const assign = kmeans(cols.map((c) => c.rgb), k, cols.map((c) => c.w));
  const groups = [];
  for (let j = 0; j < k; j++) {
    const idx = cols.map((c, i) => (assign[i] === j ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const w = idx.reduce((s, i) => s + cols[i].w, 0);
    const rgb = [0, 1, 2].map((d) => idx.reduce((s, i) => s + cols[i].rgb[d] * cols[i].w, 0) / w);
    groups.push({ rgb, w, hsl: toHsl(rgb) });
  }
  groups.sort((a, b) => a.hsl[2] - b.hsl[2]);
  const darkest = groups[0].hsl;
  const lightest = groups[groups.length - 1].hsl;
  const accentSrc = [...groups].filter((g) => g.hsl[2] > 0.12 && g.hsl[2] < 0.92).sort((a, b) => b.hsl[1] * Math.sqrt(b.w) - a.hsl[1] * Math.sqrt(a.w))[0] || groups[groups.length - 1];
  const [ah, as] = accentSrc.hsl;
  const accentS = mono || as < 0.08 ? 0.05 : clamp(as * 1.3, 0.3, 0.6);
  const p = {
    bg: hex(fromHsl([darkest[0], Math.min(darkest[1], 0.3), 0.05])),
    surface: hex(fromHsl([darkest[0], Math.min(darkest[1], 0.3), 0.1])),
    text: hex(fromHsl([lightest[0], Math.min(lightest[1], 0.18), 0.88])),
    dim: hex(fromHsl([lightest[0], Math.min(lightest[1], 0.12), 0.6])),
    accent: hex(fromHsl([ah, accentS, mono ? 0.74 : 0.64])),
    accent_light: hex(fromHsl([ah, accentS, mono ? 0.86 : 0.76])),
    swatches: groups.map((g) => hex(g.rgb)),
  };
  return p;
}

export function paletteCss(p) {
  if (!p) return '';
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `:root {
  --dr-bg: ${p.bg};
  --dr-text: ${p.text};
  --dr-dim: ${p.dim};
  --dr-accent: ${p.accent};
  --dr-box: linear-gradient(to bottom, ${rgba(rgb(p.bg), 0.55)}, ${rgba(rgb(p.bg), 0.88)});
  --dr-choice: ${rgba(rgb(p.bg), 0.78)};
  --dr-choice-hover: ${rgba(rgb(p.surface), 0.92)};
  --dr-line: ${rgba(rgb(p.text), 0.18)};
}
.dr-panel, .dr-name, .dr-toast { background: ${p.surface}; }
.dr-link:hover, .dr-title-buttons button:hover { color: ${p.accent_light}; }`;
}

export function atmosphereCss(moods) {
  return Object.entries(moods || {})
    .map(([name, m]) => `.dr-atmos[data-atmosphere="${name}"] { background: ${m.atmosphere}; }`)
    .join('\n');
}

// ---------- sounds ----------
const SND_WORDS = { loudness: ['loud', 'quiet'], brightness: ['bright', 'low'], pace: ['busy', 'slow'], dynamics: ['surging', 'steady'] };
function soundWordsAbsolute(m) {
  const w = [];
  if (m.loudness > -20) w.push('loud');
  else if (m.loudness < -30) w.push('quiet');
  if (m.brightness > 1000) w.push('bright');
  else if (m.brightness < 200) w.push('low');
  if (m.pace > 1.5) w.push('busy');
  else if (m.pace < 0.3) w.push('slow');
  if (m.dynamics > 15) w.push('surging');
  else if (m.dynamics < 6) w.push('steady');
  return w;
}
function developSounds(list) {
  // list: [{ rel, m }]
  const taken = new Set();
  const out = {};
  const feat = (m, d) => (d === 'brightness' ? Math.log(Math.max(20, m.brightness)) : m[d]);
  const dims = Object.keys(SND_WORDS);
  const st = Object.fromEntries(dims.map((d) => [d, meanStd(list.map((s) => feat(s.m, d)), d === 'brightness' ? 0.3 : d === 'pace' ? 0.2 : 2)]));
  for (const s of [...list].sort((a, b) => a.rel.localeCompare(b.rel))) {
    let words;
    if (list.length >= 3) {
      words = dims
        .map((d) => ({ d, z: (feat(s.m, d) - st[d].m) / st[d].sd }))
        .filter((x) => Math.abs(x.z) >= 0.5)
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
        .map((x) => SND_WORDS[x.d][x.z > 0 ? 0 : 1]);
      if (!words.length) words = soundWordsAbsolute(s.m);
    } else words = soundWordsAbsolute(s.m);
    const name = uniqueName(words, taken);
    out[name] = { file: s.rel, words, measures: s.m };
  }
  return out;
}

// ---------- main ----------
export async function develop(projectDir, { onProgress } = {}) {
  if (!hasFfmpeg()) throw new Error('darkroom develop needs ffmpeg (Windows: winget install Gyan.FFmpeg, Mac: brew install ffmpeg)');
  const config = loadConfig(projectDir);
  const idx = indexAssets(path.join(projectDir, 'assets'));
  const ts = config.title_screen || {};
  const titleBg = ts.background && resolveAsset(idx, ts.background, 'bg').rel;
  const sync = syncLibrary(projectDir, idx, { exclude: titleBg ? [titleBg] : [] });
  const lib = loadLibrary(projectDir, idx);
  const pictures = [...lib.entries.values()];
  const soundFiles = [...idx.files.values()].filter((f) => f.type === 'audio' && /^(music|ambience)\//i.test(f.rel));
  const files = [...pictures.map((e) => idx.files.get(e.rel)), ...soundFiles].filter(Boolean);
  const measures = await measureAll(projectDir, files, onProgress);

  const pics = pictures.filter((e) => measures.has(e.rel)).map((e) => ({ id: e.id, rel: e.rel, type: e.type, m: measures.get(e.rel) }));
  const result = { pictures: {}, moods: {}, palette: null, music: {}, ambience: {} };
  if (pics.length) {
    const dev = developPictures(pics);
    result.collection = { pictures: pics.length, monochrome: dev.mono, mean: dev.mean };
    result.moods = dev.moods;
    result.palette = developPalette(pics, dev.mono);
    for (const p of pics) {
      const { colours, ...rest } = p.m;
      result.pictures[p.id] = { file: p.rel, mood: p.mood, qualities: p.qualities, measures: rest, colours: (colours || []).map((c) => hex(c.rgb)) };
    }
  }
  for (const kind of ['music', 'ambience']) {
    const list = soundFiles.filter((f) => f.rel.toLowerCase().startsWith(`${kind}/`) && measures.has(f.rel)).map((f) => ({ rel: f.rel, m: measures.get(f.rel) }));
    result[kind] = developSounds(list);
  }
  const out = {
    note: 'Developed from this piece\'s own pictures and sounds by `darkroom develop`. It is rewritten every time: put your own changes in darkroom.json (scene.looks, scene.music, theme).',
    developed: new Date().toISOString().slice(0, 10),
    ...result,
  };
  fs.writeFileSync(path.join(projectDir, MOODS_FILE), `${JSON.stringify(out, null, 2)}\n`);
  fs.writeFileSync(path.join(projectDir, 'moodboard.html'), moodboard(config, out, lib.entries));
  return { ...out, sync };
}

export function readMoods(projectDir) {
  const f = path.join(projectDir, MOODS_FILE);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`${MOODS_FILE} is not valid JSON (run darkroom develop again): ${e.message}`);
  }
}

// ---------- moodboard.html ----------
function moodboard(config, d, entries) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const src = (rel) => `assets/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const p = d.palette || { bg: '#111', surface: '#1a1a1a', text: '#eee', dim: '#999', accent: '#ccc', swatches: [] };
  const thumb = (id, filter) => {
    const e = entries.get(id);
    if (!e) return '';
    const st = filter ? ` style="filter:${esc(filter)}"` : '';
    return e.type === 'video'
      ? `<figure><video src="${src(e.rel)}" muted loop autoplay playsinline${st}></video><figcaption>${esc(id)}</figcaption></figure>`
      : `<figure><img src="${src(e.rel)}" alt=""${st}><figcaption>${esc(id)}</figcaption></figure>`;
  };
  const moods = Object.entries(d.moods || {})
    .map(([name, m]) => {
      const first = m.pictures[0];
      const e = entries.get(first);
      return `<section class="mood">
  <h3>${esc(name)}</h3>
  <p class="words">${m.words.map(esc).join(' · ') || 'the middle of the collection'} &nbsp;<span class="chip" style="background:${m.tint}"></span> <code>look-${esc(name)}</code> <code>atmosphere-${esc(name)}</code> <code>motif-${esc(name)}</code></p>
  <div class="row">${m.pictures.map((id) => thumb(id)).join('')}</div>
  <p class="small">Look <code>${esc(m.look.filter || 'as shot')}</code> and atmosphere on another picture:</p>
  <div class="row">${Object.keys(d.pictures).filter((id) => !m.pictures.includes(id)).slice(0, 3).map((id) => `<div class="atmo">${thumb(id, m.look.filter)}<div class="tint" style="background:${esc(m.atmosphere)}"></div></div>`).join('')}</div>
</section>`;
    })
    .join('\n');
  const quals = Object.entries(d.pictures || {})
    .map(([id, x]) => `<tr><td>${esc(id)}</td><td>${esc(x.mood || '')}</td><td>${x.qualities.map(esc).join(', ')}</td><td>${x.colours.map((c) => `<span class="chip" style="background:${c}"></span>`).join('')}</td></tr>`)
    .join('');
  const sounds = ['music', 'ambience']
    .map((kind) =>
      Object.entries(d[kind] || {})
        .map(([name, s]) => `<div class="sound"><b>${kind}-${esc(name)}</b> <span class="small">${s.words.map(esc).join(' · ')} — ${esc(s.file)}</span><audio controls preload="none" src="${src(s.file)}"></audio></div>`)
        .join(''),
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.title)} — moodboard</title>
<style>
  :root { --bg: ${p.bg}; --surface: ${p.surface}; --text: ${p.text}; --dim: ${p.dim}; --accent: ${p.accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-weight: 400; margin: 0 0 4px; } h2 { font-weight: 400; margin: 40px 0 12px; color: var(--accent); }
  h3 { margin: 0 0 4px; font-weight: 500; } .small, .words { color: var(--dim); font-size: 14px; }
  code { background: var(--surface); padding: 1px 5px; border-radius: 3px; font-size: 13px; color: var(--text); }
  .palette { display: flex; flex-wrap: wrap; gap: 10px; } .sw { width: 120px; } .sw div { height: 56px; border-radius: 4px; border: 1px solid #8884; }
  .chip { display: inline-block; width: 14px; height: 14px; border-radius: 50%; vertical-align: middle; border: 1px solid #8886; margin-right: 2px; }
  .mood { background: var(--surface); padding: 16px; border-radius: 6px; margin-bottom: 16px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
  figure { margin: 0; width: 180px; } figure img, figure video { width: 180px; height: 101px; object-fit: cover; border-radius: 3px; display: block; }
  figcaption { font-size: 12px; color: var(--dim); }
  .atmo { position: relative; } .atmo .tint { position: absolute; left: 0; top: 0; width: 180px; height: 101px; border-radius: 3px; pointer-events: none; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; } td { padding: 4px 8px; border-bottom: 1px solid #8883; }
  .sound { margin: 10px 0; } .sound audio { display: block; margin-top: 4px; width: 100%; max-width: 420px; }
</style></head>
<body><main>
<h1>${esc(config.title)}</h1>
<p class="small">Developed ${esc(d.developed)} from ${d.collection?.pictures || 0} pictures${d.collection?.monochrome ? ' (black and white, so moods follow tone only)' : ''}. Run <code>darkroom develop</code> again after adding or changing media.</p>
<h2>Palette</h2>
<div class="palette">${['bg', 'surface', 'text', 'dim', 'accent'].map((k) => `<div class="sw"><div style="background:${p[k]}"></div><span class="small">${k} ${p[k]}</span></div>`).join('')}</div>
<p class="small">Colours in the pictures: ${(p.swatches || []).map((c) => `<span class="chip" style="background:${c}"></span>`).join('')}</p>
<h2>Picture moods</h2>
${moods || '<p class="small">No pictures in library.json yet.</p>'}
<h2>Sound moods</h2>
${sounds || '<p class="small">No tracks in assets/music or assets/ambience yet.</p>'}
<h2>Every picture</h2>
<table><tr><td><b>id</b></td><td><b>mood</b></td><td><b>qualities (use as motifs)</b></td><td><b>colours</b></td></tr>${quals}</table>
</main></body></html>
`;
}
