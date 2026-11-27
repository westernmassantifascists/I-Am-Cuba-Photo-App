#!/usr/bin/env node
// Downloads and prepares everything listed in sources.json:
//   CC0 photogrammetry scans, scanned textures and real-sky HDRIs from Poly Haven  -> godot/assets/
//   public-domain film from Wikimedia Commons, cut into Ogg Theora clips          -> godot/assets/film/
// and writes CREDITS.md. Safe to run again: files already there are skipped.
// Needs: Node 20+, curl (built into Windows 10+), ffmpeg (for the film clips).
//   node tools/fetch.mjs            everything
//   node tools/fetch.mjs --no-film  skip the film
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'godot', 'assets');
const CACHE = path.join(ROOT, '.cache');
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'), 'utf8'));
const RES = src.resolution || '1k';
const UA = 'DraculasGuestFetch/1.0 (open-source game; low volume)';
const noFilm = process.argv.includes('--no-film');

function curl(url, out, { retries = 5 } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  for (let i = 0; i < retries; i++) {
    const tmp = `${out}.part`;
    const r = spawnSync('curl', ['-sSL', '--fail', '-A', UA, '-o', tmp, url], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status === 0) {
      fs.renameSync(tmp, out);
      return true;
    }
    try {
      fs.unlinkSync(tmp);
    } catch {}
    const wait = 10 * (i + 1);
    process.stdout.write(`\n  retrying in ${wait}s (${String(r.stderr).trim().split('\n').pop()})`);
    spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['/t', String(wait), '/nobreak'] : [String(wait)], { stdio: 'ignore', shell: process.platform === 'win32' });
  }
  return false;
}

function getJson(url) {
  const tmp = path.join(CACHE, 'api', `${url.replace(/[^a-z0-9]+/gi, '_')}.json`);
  if (!fs.existsSync(tmp) && !curl(url, tmp)) throw new Error(`could not download ${url}`);
  return JSON.parse(fs.readFileSync(tmp, 'utf8'));
}

const have = (f) => fs.existsSync(f) && fs.statSync(f).size > 0;
const credits = [];
let failed = 0;
const step = (label) => process.stdout.write(`\r${label.padEnd(70).slice(0, 70)}`);

// ---------------- Poly Haven ----------------
function polyhaven(kind, list) {
  for (const item of list) {
    const id = item.id;
    step(`${kind}: ${id}`);
    let files;
    let info;
    try {
      files = getJson(`https://api.polyhaven.com/files/${id}`);
      info = getJson(`https://api.polyhaven.com/info/${id}`);
    } catch (e) {
      console.log(`\n  ! ${e.message}`);
      failed++;
      continue;
    }
    let ok = true;
    if (kind === 'scan') {
      const g = files.gltf?.[RES]?.gltf;
      if (!g) {
        console.log(`\n  ! ${id}: no ${RES} glTF`);
        failed++;
        continue;
      }
      const dir = path.join(ASSETS, 'scans', id);
      ok = have(path.join(dir, `${id}.gltf`)) || curl(g.url, path.join(dir, `${id}.gltf`));
      for (const [rel, f] of Object.entries(g.include || {})) {
        const out = path.join(dir, ...rel.split('/'));
        if (!have(out)) ok = curl(f.url, out) && ok;
      }
    } else if (kind === 'texture') {
      const dir = path.join(ASSETS, 'textures', id);
      const maps = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm', Rough: 'rough' };
      for (const [key, short] of Object.entries(maps)) {
        const f = files[key]?.[RES]?.jpg;
        if (!f) continue;
        const out = path.join(dir, `${id}_${short}.jpg`);
        if (!have(out)) ok = curl(f.url, out) && ok;
      }
    } else if (kind === 'sky') {
      const f = files.hdri?.[RES]?.hdr;
      const out = path.join(ASSETS, 'sky', `${id}.hdr`);
      ok = f && (have(out) || curl(f.url, out));
    }
    if (!ok) {
      console.log(`\n  ! ${id}: some files failed`);
      failed++;
    }
    credits.push(`- **${info.name || id}** (${kind}) — ${Object.keys(info.authors || {}).join(', ')}. CC0, Poly Haven: https://polyhaven.com/a/${id}${item.use ? ` — ${item.use}` : ''}`);
  }
}

// ---------------- film ----------------
function film() {
  const ff = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (ff.status !== 0) {
    console.log('\n  ! ffmpeg not found: skipping film (Windows: winget install Gyan.FFmpeg)');
    return;
  }
  for (const f of src.films) {
    const source = path.join(CACHE, 'film', f.file.replace(/[^\w.()-]+/g, '_'));
    const clipsDone = f.clips.every((c) => have(path.join(ASSETS, 'film', `${c.id}.ogv`)));
    if (!clipsDone && !have(source)) {
      step(`film: downloading ${f.file}`);
      if (!curl(f.url, source, { retries: 8 })) {
        console.log(`\n  ! could not download ${f.file}`);
        failed++;
        continue;
      }
    }
    for (const c of f.clips) {
      const out = path.join(ASSETS, 'film', `${c.id}.ogv`);
      if (have(out)) continue;
      step(`film: cutting ${c.id}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      // Godot plays Ogg Theora; keep it small, grey and with silence (the score plays over it)
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(c.start), '-t', String(c.duration), '-i', source,
        '-vf', 'scale=-2:480,format=gray,format=yuv420p,fade=t=in:d=0.8,fade=t=out:st=' + (c.duration - 0.8) + ':d=0.8',
        '-an', '-c:v', 'libtheora', '-q:v', '6', out], { stdio: 'inherit' });
      if (r.status !== 0) failed++;
    }
    credits.push(`- **${f.file.replace(/\.webm$/, '')}** — ${f.credit} Clips: ${f.clips.map((c) => `${c.id} (${c.use})`).join(', ')}.`);
  }
}

fs.mkdirSync(CACHE, { recursive: true });
polyhaven('scan', src.scans);
polyhaven('texture', src.textures);
polyhaven('sky', src.skies);
if (!noFilm) film();
step('done');
console.log('');

const md = `# Credits

*Dracula's Guest* by Bram Stoker (1914), public domain. Adapted for this game.

Music: composed for this game on the Darkroom groovebox (darkroom/lib/groovebox.mjs).

## Photogrammetry scans, scanned textures and skies (CC0, Poly Haven)

${credits.filter((c) => c.includes('Poly Haven')).join('\n')}

## Film (public domain)

${credits.filter((c) => !c.includes('Poly Haven')).join('\n') || '- (not downloaded)'}
`;
fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), md);
console.log(failed ? `Finished with ${failed} problem(s); run again to retry.` : 'All assets ready. Wrote CREDITS.md.');
process.exitCode = failed ? 1 : 0;
