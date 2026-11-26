// Measuring the material: what each photo, video and sound actually is, so a piece's moods can be
// developed from its own media. Uses only ffmpeg/ffprobe (raw pixels and raw audio piped into Node).
// Results are cached in .darkroom/measure.json and only recomputed for new or changed files.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

function runRaw(args) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-v', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, buf: Buffer.concat(chunks), err }));
    p.on('error', (e) => resolve({ code: -1, buf: Buffer.alloc(0), err: String(e) }));
  });
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(parseFloat(out) || 0));
    p.on('error', () => resolve(0));
  });
}

const SIDE = 64; // pictures are measured at 64×64: plenty for tone and colour

async function frame(file, at) {
  const args = [];
  if (at != null) args.push('-ss', String(at));
  args.push('-i', file, '-frames:v', '1', '-vf', `scale=${SIDE}:${SIDE}:flags=area,format=rgb24`, '-f', 'rawvideo', 'pipe:1');
  const r = await runRaw(args);
  return r.buf.length >= SIDE * SIDE * 3 ? r.buf.subarray(0, SIDE * SIDE * 3) : null;
}

// k-means on pixels -> the few colours a picture is made of, with their share
function colours(px, k = 3) {
  const pts = [];
  for (let i = 0; i < px.length; i += 3) pts.push([px[i], px[i + 1], px[i + 2]]);
  pts.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let c = Array.from({ length: k }, (_, j) => pts[Math.floor(((j + 0.5) / k) * pts.length)].slice());
  let assign = new Array(pts.length).fill(0);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < pts.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = (pts[i][0] - c[j][0]) ** 2 + (pts[i][1] - c[j][1]) ** 2 + (pts[i][2] - c[j][2]) ** 2;
        if (d < bd) (bd = d), (best = j);
      }
      assign[i] = best;
    }
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    pts.forEach((p, i) => {
      const s = sum[assign[i]];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    });
    c = sum.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : c[j]));
  }
  const counts = new Array(k).fill(0);
  assign.forEach((a) => counts[a]++);
  return c.map((rgb, j) => ({ rgb: rgb.map(Math.round), share: +(counts[j] / pts.length).toFixed(3) })).filter((x) => x.share > 0);
}

function pictureStats(px) {
  let sumL = 0;
  let sumL2 = 0;
  let sumS = 0;
  let sumW = 0;
  const n = px.length / 3;
  for (let i = 0; i < px.length; i += 3) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sumL += l;
    sumL2 += l * l;
    sumS += mx > 0.04 ? (mx - mn) / mx : 0;
    sumW += r - b;
  }
  const lum = sumL / n;
  return { lum, contrast: Math.sqrt(Math.max(0, sumL2 / n - lum * lum)), sat: sumS / n, warmth: sumW / n };
}

function lumDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 3) d += Math.abs(a[i] + a[i + 1] + a[i + 2] - (b[i] + b[i + 1] + b[i + 2])) / 765;
  return d / (a.length / 3);
}

async function measurePicture(file, type) {
  if (type === 'image') {
    const px = await frame(file);
    if (!px) return null;
    return { ...round(pictureStats(px)), colours: colours(px) };
  }
  // video: tone from three moments, motion from two frames a quarter-second apart
  const dur = await probeDuration(file);
  const at = [0.15, 0.5, 0.85].map((f) => +(f * dur).toFixed(2));
  const frames = (await Promise.all(at.map((t) => frame(file, t)))).filter(Boolean);
  if (!frames.length) return null;
  const stats = frames.map(pictureStats);
  const avg = (k) => stats.reduce((s, x) => s + x[k], 0) / stats.length;
  const a = await frame(file, dur * 0.5);
  const b = await frame(file, Math.min(dur, dur * 0.5 + 0.25));
  const all = Buffer.concat(frames);
  return {
    ...round({ lum: avg('lum'), contrast: avg('contrast'), sat: avg('sat'), warmth: avg('warmth') }),
    motion: a && b ? +lumDiff(a, b).toFixed(4) : 0,
    colours: colours(all),
    duration: +dur.toFixed(1),
  };
}

// Sound: loudness, how bright or low it is, how busy (onsets per second) and how much it swells.
async function measureSound(file) {
  const SR = 11025;
  const r = await runRaw(['-i', file, '-t', '90', '-ac', '1', '-ar', String(SR), '-f', 's16le', 'pipe:1']);
  const n = Math.floor(r.buf.length / 2);
  if (n < SR / 4) return null;
  const sample = (i) => r.buf.readInt16LE(i * 2) / 32768;
  const W = 512; // ~46 ms windows
  const energies = [];
  let zc = 0;
  let prev = 0;
  for (let w = 0; w + W <= n; w += W) {
    let e = 0;
    for (let i = w; i < w + W; i++) {
      const s = sample(i);
      e += s * s;
      if ((s >= 0) !== (prev >= 0)) zc++;
      prev = s;
    }
    energies.push(e / W);
  }
  const db = energies.map((e) => 10 * Math.log10(e + 1e-10));
  const sorted = [...db].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const meanE = energies.reduce((a, b) => a + b, 0) / energies.length;
  let onsets = 0;
  for (let i = 8; i < energies.length; i++) {
    const before = energies.slice(i - 8, i).reduce((a, b) => a + b, 0) / 8;
    if (energies[i] > before * 2.2 && energies[i] > meanE * 0.5 && energies[i - 1] <= before * 2.2) onsets++;
  }
  const seconds = n / SR;
  return {
    loudness: +(10 * Math.log10(meanE + 1e-10)).toFixed(1), // dBFS
    brightness: Math.round((zc / seconds) / 2), // ≈ dominant frequency in Hz
    pace: +(onsets / seconds).toFixed(2), // onsets per second
    dynamics: +(pct(0.9) - pct(0.1)).toFixed(1), // dB between quiet and loud moments
    duration: +seconds.toFixed(1),
  };
}

function round(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = +v.toFixed(4);
  return out;
}

// files: [{ rel, abs, bytes, mtimeMs, type }] -> Map(rel -> measures)
export async function measureAll(projectDir, files, onProgress = () => {}) {
  const cacheFile = path.join(projectDir, '.darkroom', 'measure.json');
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {}
  const out = new Map();
  const todo = [];
  for (const f of files) {
    const c = cache[f.rel];
    if (c && c.bytes === f.bytes && c.mtimeMs === f.mtimeMs && c.v === 1) out.set(f.rel, c.m);
    else todo.push(f);
  }
  let done = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(os.cpus().length, 6)) }, async () => {
    while (todo.length) {
      const f = todo.shift();
      const m = f.type === 'audio' ? await measureSound(f.abs) : await measurePicture(f.abs, f.type);
      if (m) {
        out.set(f.rel, m);
        cache[f.rel] = { v: 1, bytes: f.bytes, mtimeMs: f.mtimeMs, m };
      }
      onProgress(++done, f.rel, !!m);
    }
  });
  await Promise.all(workers);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return out;
}
