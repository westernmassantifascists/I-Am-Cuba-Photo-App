#!/usr/bin/env node
// Fetches the recorded sound effects from Wikimedia Commons and cuts them for the game:
//   sfx_howl.ogg      wolves howling — US Fish & Wildlife Service recording (public domain)
//   sfx_thunder.ogg   a thunderclap and its roll — by Bidgee (CC BY 3.0)
//   sfx_thunder_2.ogg thunder in the rain, Sundbyberg, Sweden — by Caesar (public domain)
// into godot/assets/music/ (the folder the score renders into). Wikimedia rate-limits; the
// script waits and retries.
//   node tools/fetch-sfx.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'sfx');
const OUT = path.join(ROOT, 'godot', 'assets', 'music');
const SFX = [
  { out: 'sfx_howl.ogg', file: 'Wolf_howls.ogg', from: 0, to: 14, fadeIn: 0.4, fadeOut: 3.5, level: -16 },
  { out: 'sfx_thunder.ogg', file: 'Thunder.ogg', from: 0.6, to: 14, fadeIn: 0.05, fadeOut: 4, level: -14 },
  { out: 'sfx_thunder_2.ogg', file: 'Rain_and_thunder.ogg', from: 2.0, to: 12, fadeIn: 0.3, fadeOut: 3, level: -15 },
];
const commons = (name) => {
  const h = crypto.createHash('md5').update(name).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(name)}`;
};
const sleep = (s) => spawnSync('sleep', [String(s)]);

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
for (const s of SFX) {
  const src = path.join(CACHE, s.file);
  for (let i = 1; !fs.existsSync(src) && i <= 6; i++) {
    const r = spawnSync('curl', ['-fsSL', '-A', 'darkroom-game-builder/1.0', '-o', src, commons(s.file)]);
    if (r.status !== 0) {
      fs.rmSync(src, { force: true });
      console.log(`  ${s.file}: Wikimedia busy, retrying in ${i * 8}s`);
      sleep(i * 8);
    }
  }
  if (!fs.existsSync(src)) throw new Error(`could not download ${s.file}`);
  const len = s.to - s.from;
  const af = `atrim=${s.from}:${s.to},asetpts=PTS-STARTPTS,highpass=f=30,afade=t=in:d=${s.fadeIn},afade=t=out:st=${len - s.fadeOut}:d=${s.fadeOut},loudnorm=I=${s.level}:TP=-1.5:LRA=11`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', af, '-ar', '44100', '-ac', '2', '-c:a', 'libvorbis', '-q:a', '5', path.join(OUT, s.out)], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${s.file}`);
  console.log(`${s.out.padEnd(18)} ${len.toFixed(1)}s from ${s.file}`);
}
