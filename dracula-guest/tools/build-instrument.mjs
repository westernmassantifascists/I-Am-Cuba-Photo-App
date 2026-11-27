#!/usr/bin/env node
// Builds "the Dracula's Guest orchestra" as a playable web instrument: from the same recorded
// instruments the score uses (VSCO 2 CE, CC0; run tools/fetch-samples.mjs first) it cuts a
// browser-sized set of samples, one dynamic, a note every few semitones, each sustained note given a
// seamless loop, all levelled to one another, plus the wolves and the thunder. Writes
// .cache/instrument/: samples/<id>/<midi>.mp3, sfx/*.mp3, manifest.json, and the page.
//   node tools/build-instrument.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _sampleIndex } from '../../darkroom/lib/groovebox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.cache', 'instrument');
const SR = 44100;
const score = JSON.parse(fs.readFileSync(path.join(ROOT, 'music', 'score.json'), 'utf8'));
const I = score.instruments;

// what the page offers: [id, name, family, score instrument, layer ('mid' | 'top'), spacing in semitones]
const SET = [
  ['violins', 'Violins', 'Strings', 'violins', 'mid', 3],
  ['violins_trem', 'Violins, tremolo', 'Strings', 'violins_trem', 'mid', 3],
  ['violas', 'Violas', 'Strings', 'violas', 'mid', 3],
  ['violas_trem', 'Violas, tremolo', 'Strings', 'violas_trem', 'mid', 3],
  ['celli', 'Cellos', 'Strings', 'celli', 'mid', 3],
  ['celli_trem', 'Cellos, tremolo', 'Strings', 'celli_trem', 'mid', 3],
  ['celli_spic', 'Cellos, spiccato', 'Strings', 'celli_spic', 'top', 3],
  ['basses', 'Double bass', 'Strings', 'basses', 'mid', 3],
  ['basses_spic', 'Double bass, spiccato', 'Strings', 'basses_spic', 'top', 3],
  ['harp', 'Harp', 'Strings', 'harp', 'top', 3],
  ['horns', 'French horns', 'Brass', 'horns', 'mid', 3],
  ['trombones', 'Trombone', 'Brass', 'trombones', 'mid', 3],
  ['tuba', 'Tuba', 'Brass', 'tuba', 'mid', 3],
  ['timp', 'Timpani', 'Percussion', 'timp', 'top', 12],
  ['timp_roll', 'Timpani roll', 'Percussion', 'timp_roll', 'top', 12],
  ['bassdrum', 'Bass drum', 'Percussion', 'bassdrum', 'top', 12],
  ['organ', 'Church organ, quiet', 'Organ', 'organ', 'mid', 3],
  ['organ_full', 'Church organ, full', 'Organ', 'organ_full', 'mid', 3],
  ['organ_pedal', 'Organ pedals', 'Organ', 'organ_pedal', 'mid', 3],
];
const SFX = [
  ['howl', 'Wolves', 'godot/assets/music/sfx_howl.ogg'],
  ['thunder', 'Thunder, near', 'godot/assets/music/sfx_thunder.ogg'],
  ['thunder2', 'Thunder in the rain', 'godot/assets/music/sfx_thunder_2.ogg'],
];

const decode = (file, seconds) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-t', String(seconds), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`decode ${file}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
};
const encode = (x, file) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '96k', file], { input: Buffer.from(x.buffer) });
  if (r.status !== 0) throw new Error(`encode ${file}`);
};
const rms = (x, a, b) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'samples'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'sfx'), { recursive: true });
const manifest = { note: 'Recorded instruments from VSCO 2 Community Edition (Versilian Studios, CC0).', instruments: [], effects: [] };
let bytes = 0;

for (const [id, name, family, src, layerPick, spacing] of SET) {
  const inst = I[src];
  const idx = _sampleIndex(inst, path.join(ROOT, 'music'));
  const vels = idx.vels;
  const layer = layerPick === 'top' ? vels[vels.length - 1] : vels[Math.floor((vels.length - 1) / 2)];
  const pool = idx.list.filter((s) => s.vel === layer).map((s) => ({ ...s, midi: Math.round(s.midi) })).sort((a, b) => a.midi - b.midi);
  const picked = [];
  for (const s of pool) {
    if (picked.length && s.midi - picked[picked.length - 1].midi < spacing) continue;
    picked.push(s);
  }
  if (picked.length && pool.length && picked[picked.length - 1] !== pool[pool.length - 1] && pool[pool.length - 1].midi - picked[picked.length - 1].midi >= 2) picked.push(pool[pool.length - 1]);
  const oneshot = !!inst.oneshot;
  const dir = path.join(OUT, 'samples', id);
  fs.mkdirSync(dir, { recursive: true });
  const notes = [];
  const levels = [];
  for (const s of picked) {
    let x = decode(s.file, oneshot ? 6 : 7);
    // trim leading silence
    let st = 0;
    while (st < x.length && Math.abs(x[st]) < 0.002) st++;
    x = x.subarray(Math.max(0, st - 40));
    let loop = null;
    if (!oneshot) {
      // a seamless loop from 40% to 92% of the clip: the end is cross-faded into what precedes the
      // loop start, so jumping back from the end continues without a seam
      const ls = Math.floor(x.length * 0.4);
      const le = Math.floor(x.length * 0.92);
      const xf = Math.min(Math.floor(0.25 * SR), Math.floor((le - ls) / 3));
      const y = Float32Array.from(x.subarray(0, le));
      for (let k = 0; k < xf; k++) {
        const t = k / xf;
        y[le - xf + k] = x[le - xf + k] * Math.cos((t * Math.PI) / 2) + x[ls - xf + k] * Math.sin((t * Math.PI) / 2);
      }
      x = y;
      loop = [ls / SR, le / SR];
    } else {
      const fade = Math.min(x.length, Math.floor(0.4 * SR));
      for (let k = 0; k < fade; k++) x[x.length - fade + k] *= 1 - k / fade;
    }
    levels.push(rms(x, Math.floor(0.02 * SR), Math.min(x.length, Math.floor((oneshot ? 0.4 : 1.5) * SR))));
    const file = path.join(dir, `${s.midi}.mp3`);
    encode(x, file);
    bytes += fs.statSync(file).size;
    notes.push({ midi: s.midi, file: `samples/${id}/${s.midi}.mp3`, loop });
  }
  const med = levels.slice().sort((a, b) => a - b)[Math.floor(levels.length / 2)] || 1;
  const lo = Math.max(notes[0].midi - (spacing >= 12 ? 12 : 5), 21);
  const hi = Math.min(notes[notes.length - 1].midi + (spacing >= 12 ? 12 : 5), 108);
  manifest.instruments.push({ id, name, family, oneshot, gain: +(0.12 / med * (inst.gain ?? 0.7)).toFixed(3), range: [lo, hi], notes });
  console.log(`${name.padEnd(24)} ${notes.length} notes  ${notes[0].midi}-${notes[notes.length - 1].midi}`);
}
for (const [id, name, src] of SFX) {
  const x = decode(path.join(ROOT, src), 20);
  const file = path.join(OUT, 'sfx', `${id}.mp3`);
  encode(x, file);
  bytes += fs.statSync(file).size;
  manifest.effects.push({ id, name, file: `sfx/${id}.mp3` });
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
fs.copyFileSync(path.join(ROOT, 'web', 'instrument.html'), path.join(OUT, 'index.html'));
console.log(`${(bytes / 1048576).toFixed(1)} MB of samples in ${path.relative(ROOT, OUT)}/`);
