// Building a project into a playable web folder.
//   dist/index.html, story.js, darkroom.js, darkroom.css, assets/... (only the media the story uses)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, printReport, mb, dim, yellow } from './project.mjs';
import { loadStoryDir } from './twine.mjs';
import { indexAssets, resolveAsset } from './assets.mjs';
import { compileStory } from './compile.mjs';
import { hasFfmpeg, leanAssets } from './lean.mjs';
import { loadLibrary } from './library.mjs';
import { translateExpr, checkExpr } from './expr.mjs';
import { DEFAULT_LOOKS } from './project.mjs';

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime');

export function availableStyles() {
  const dir = path.join(RUNTIME, 'themes');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, `${d}.css`))) : [];
}

// Compile without writing anything. Used by check, build, serve and package.
export function analyze(projectDir) {
  const config = loadConfig(projectDir);
  const assetIndex = indexAssets(path.join(projectDir, 'assets'));
  const { passages, startName, files } = loadStoryDir(path.join(projectDir, 'story'));
  const lib = loadLibrary(projectDir, assetIndex);
  const result = compileStory({ passages, startName, config, assetIndex, library: lib.entries });
  result.errors.push(...lib.errors);
  result.warnings.push(...lib.warnings);
  result.story.scene = sceneRuntime(config, result.errors);
  if (config.style && !fs.existsSync(path.join(RUNTIME, 'themes', config.style))) {
    result.errors.push({ file: 'darkroom.json', line: 0, passage: '', msg: `style "${config.style}" does not exist (available: ${availableStyles().join(', ') || 'none'})` });
  }
  if (!files.length) result.errors.unshift({ file: 'story/', line: 0, passage: '', msg: 'no .twee, .tw or Twine .html files found in story/' });

  // Title screen media from darkroom.json
  const ts = config.title_screen;
  for (const [key, kind] of [['background', 'bg'], ['music', 'music']]) {
    if (!ts[key]) continue;
    const r = resolveAsset(assetIndex, ts[key], kind);
    if (r.error) result.errors.push({ file: 'darkroom.json', line: 0, passage: '', msg: `title_screen.${key} "${ts[key]}": ${r.error}` });
    else {
      ts[`${key}_src`] = r.rel;
      const u = result.usedAssets.get(r.rel) ?? { kinds: new Set(), refs: [] };
      u.kinds.add(kind);
      result.usedAssets.set(r.rel, u);
    }
  }

  const unused = [...assetIndex.files.keys()].filter((rel) => !result.usedAssets.has(rel));
  if (unused.length) result.info.push({ msg: `${unused.length} file(s) in assets/ are not used by the story and will be left out of the build`, list: unused });

  // Every ending in the story, for the Endings screen.
  const endings = new Map();
  const walk = (ops) => {
    for (const op of ops) {
      if (op.t === 'ending' && !endings.has(op.id)) endings.set(op.id, { id: op.id, title: op.title });
      if (op.t === 'if') {
        op.branches.forEach((b) => walk(b.ops));
        if (op.else) walk(op.else);
      }
    }
  };
  for (const p of Object.values(result.story.passages)) walk(p.ops);
  result.story.endings = [...endings.values()];

  // Library entries whose files ship with the game (the engine picks among these by motif).
  result.story.library = [...lib.entries.values()]
    .filter((e) => result.usedAssets.has(e.rel))
    .map((e) => ({ id: e.id, src: e.rel, type: e.type, motifs: e.motifs, ...(e.repeat ? {} : { repeat: false }), ...(e.focal ? { focal: e.focal } : {}), ...(e.still ? { still: e.still } : {}) }));

  const used = [...result.usedAssets.keys()].map((rel) => assetIndex.files.get(rel)).filter(Boolean);
  result.bytes = used.reduce((n, f) => n + f.bytes, 0);
  return { config, assetIndex, result, used };
}

// darkroom.json "scene" -> what the player needs, with conditions translated to JavaScript.
function sceneRuntime(config, errors) {
  const sc = config.scene || {};
  const js = (src, where) => {
    const t = translateExpr(src);
    try {
      checkExpr(t);
    } catch (e) {
      errors.push({ file: 'darkroom.json', line: 0, passage: where, msg: `bad expression "${src}": ${e.message}` });
    }
    return t;
  };
  const out = {
    looks: { ...DEFAULT_LOOKS, ...(sc.looks || {}) },
    look_floor: sc.look_floor || null,
    look_rules: (sc.look_rules || []).map((r, i) => ({ js: js(r.when, `scene.look_rules[${i}]`), look: r.look })),
    weights: (sc.weights || []).map((w, i) => ({ js: js(w.when, `scene.weights[${i}]`), favor: w.favor || {} })),
    volume: { music: 1, ambience: 1, ...(sc.volume || {}) },
    first_run_shots: sc.first_run_shots !== false,
  };
  if (sc.mix) {
    out.mix = {};
    for (const k of ['music', 'ambience']) {
      if (sc.mix[k]) out.mix[k] = { js: js(sc.mix[k], `scene.mix.${k}`), range: sc.mix[`${k}_range`] || [0, 1] };
    }
  }
  return out;
}

function rewriteAssets(story, map) {
  const fix = (rel) => map.get(rel)?.rel ?? rel;
  const walk = (ops) => {
    for (const op of ops) {
      if (op.src) op.src = fix(op.src);
      if (op.html) op.html = op.html.replace(/assets\/([^"']+)/g, (m, rel) => `assets/${fix(rel)}`);
      if (op.t === 'if') {
        op.branches.forEach((b) => walk(b.ops));
        if (op.else) walk(op.else);
      }
    }
  };
  for (const p of Object.values(story.passages)) {
    walk(p.ops);
    p.assets = p.assets.map(fix);
    if (p.scene) for (const k of ['music', 'ambience']) if (p.scene[k]) p.scene[k] = fix(p.scene[k]);
  }
  walk(story.init);
  for (const e of story.library || []) e.src = fix(e.src);
}

function publicConfig(config) {
  const { lean, itch, theme, scene, ...rest } = config;
  return rest;
}

function themeCss(theme = {}) {
  const vars = Object.entries(theme).map(([k, v]) => `  --dr-${k.replace(/_/g, '-')}: ${v};`);
  return vars.length ? `:root {\n${vars.join('\n')}\n}` : '';
}

export function writeWebFiles(outDir, { config, story, dev = false, assetsMeta = {}, errors = [], warnings = [] }) {
  fs.mkdirSync(outDir, { recursive: true });
  const data = {
    format: 'darkroom',
    version: 1,
    dev,
    config: publicConfig(config),
    start: story.start,
    init: story.init,
    passages: story.passages,
    endings: story.endings,
    pools: story.pools,
    turns: story.turns,
    library: story.library || [],
    scene: story.scene,
    assets: assetsMeta,
  };
  if (dev) {
    data.errors = errors.map((e) => `${e.file}:${e.line} ${e.msg}`);
    data.warnings = warnings.map((e) => `${e.file}:${e.line} ${e.msg}`);
  }
  fs.writeFileSync(path.join(outDir, 'story.js'), `window.DARKROOM_STORY = ${JSON.stringify(data)};\n`);
  fs.copyFileSync(path.join(RUNTIME, 'darkroom.js'), path.join(outDir, 'darkroom.js'));
  fs.copyFileSync(path.join(RUNTIME, 'darkroom.css'), path.join(outDir, 'darkroom.css'));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const userCss = [themeCss(config.theme), ...story.css].filter(Boolean).join('\n\n');
  // A built-in style (runtime/themes/<name>/): its CSS, plus bundled fonts if it has them.
  let styleLinks = '';
  const styleDir = config.style && path.join(RUNTIME, 'themes', config.style);
  if (styleDir && fs.existsSync(styleDir)) {
    fs.cpSync(styleDir, path.join(outDir, 'themes', config.style), { recursive: true });
    for (const f of ['fonts.css', `${config.style}.css`]) {
      if (fs.existsSync(path.join(styleDir, f))) styleLinks += `<link rel="stylesheet" href="themes/${config.style}/${f}">\n`;
    }
  }
  const userJs = story.js.join('\n\n');
  const html = `<!doctype html>
<html lang="${esc(config.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#000000">
<title>${esc(config.title)}</title>
<link rel="stylesheet" href="darkroom.css">
${styleLinks}${userCss ? `<style>\n${userCss}\n</style>\n` : ''}</head>
<body>
<div id="dr"></div>
<noscript>This story needs JavaScript.</noscript>
<script src="story.js"></script>
<script src="darkroom.js"></script>
${userJs ? `<script>\n${userJs}\n</script>\n` : ''}${dev ? '<script>new EventSource("/__live").onmessage = () => location.reload();</script>\n' : ''}</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}

// Full build into dist/ (or another folder). lean = convert media with ffmpeg first.
export async function build(projectDir, { lean = false, outDir, quiet = false, verbose = false } = {}) {
  const { config, assetIndex, result, used } = analyze(projectDir);
  if (!quiet) printReport(result, { verbose });
  if (result.errors.length) {
    console.log(`\n${result.errors.length} error(s) — fix them and build again.`);
    return { ok: false, result };
  }

  let map = new Map(used.map((f) => [f.rel, { rel: f.rel, abs: f.abs, bytes: f.bytes }]));
  if (lean) {
    if (!hasFfmpeg()) {
      console.log(yellow('warning') + ' ffmpeg not found, so media is copied unchanged. Install it to shrink the build (Windows: winget install Gyan.FFmpeg, Mac: brew install ffmpeg).');
    } else {
      const list = used.map((f) => ({ file: f, kinds: result.usedAssets.get(f.rel).kinds }));
      const cacheDir = path.join(projectDir, '.darkroom', 'cache');
      const isTTY = process.stdout.isTTY;
      map = await leanAssets(list, config.lean, cacheDir, (n, total, rel, r) => {
        if (r.warn) console.log(`\n${yellow('warning')} ${rel}: ${r.note}`);
        if (isTTY) process.stdout.write(`\r  lean media ${n}/${total} ${dim(rel.slice(0, 50).padEnd(50))}`);
        else if (verbose) console.log(`  ${rel}: ${r.note}`);
      });
      if (isTTY) process.stdout.write('\n');
      rewriteAssets(result.story, map);
      if (config.title_screen.background_src) config.title_screen.background_src = map.get(config.title_screen.background_src).rel;
      if (config.title_screen.music_src) config.title_screen.music_src = map.get(config.title_screen.music_src).rel;
    }
  }

  outDir = outDir || path.join(projectDir, 'dist');
  fs.rmSync(outDir, { recursive: true, force: true });
  const assetsMeta = {};
  for (const [orig, r] of map) {
    const dest = path.join(outDir, 'assets', ...r.rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(r.abs, dest);
    assetsMeta[r.rel] = { type: assetIndex.files.get(orig)?.type, bytes: r.bytes };
  }
  writeWebFiles(outDir, { config, story: result.story, assetsMeta });
  const before = used.reduce((n, f) => n + f.bytes, 0);
  const after = [...map.values()].reduce((n, r) => n + r.bytes, 0);
  if (!quiet) {
    const passages = Object.keys(result.story.passages).length;
    console.log(`\nBuilt ${passages} passages, ${map.size} media files → ${path.relative(process.cwd(), outDir) || '.'}`);
    console.log(lean && before !== after ? `Media: ${mb(before)} → ${mb(after)}` : `Media: ${mb(after)}`);
  }
  return { ok: true, result, outDir, config, map };
}
