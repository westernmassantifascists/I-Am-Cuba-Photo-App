// Darkroom groovebox: a small offline synthesizer, drum machine and step sequencer.
// A score (JSON) defines instruments and stems; each stem is a set of tracks playing text patterns.
// Stems render as seamless loops (the reverb tail is folded back onto the start) so a game can
// layer and crossfade them. Output: 44.1 kHz stereo, written as WAV and converted with ffmpeg.
//
// Pattern language, one token per step (default 16 steps per bar; "|" is only for reading):
//   D3  F#4  Bb2     a note             D3+F3+A3   a chord
//   x   X            a drum hit / accented hit (for drum instruments; any note name also works)
//   -                hold the previous note (tie)          .   rest
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SR = 44100;
const TAU = Math.PI * 2;

// ---------- notes ----------
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteFreq(name) {
  const m = String(name).match(/^([A-Ga-g])([#b]?)(-?\d)$/);
  if (!m) throw new Error(`not a note: ${name}`);
  const semi = NOTE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
  return 440 * 2 ** ((semi - 69) / 12);
}

// ---------- building blocks ----------
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

function svf() {
  // Chamberlin state-variable filter; returns { lp, bp, hp }
  let low = 0;
  let band = 0;
  return (x, cutoff, q = 0.5) => {
    const f = 2 * Math.sin((Math.PI * Math.min(Math.max(cutoff, 20), SR / 8)) / SR);
    const damp = Math.max(0.02, 2 - 2 * Math.min(q, 0.98));
    low += f * band;
    const high = x - low - damp * band;
    band += f * high;
    return { lp: low, bp: band, hp: high };
  };
}

function osc(type, ph) {
  const p = ph - Math.floor(ph);
  switch (type) {
    case 'sine':
      return Math.sin(TAU * p);
    case 'saw':
      return 2 * p - 1;
    case 'square':
      return p < 0.5 ? 1 : -1;
    case 'tri':
      return 4 * Math.abs(p - 0.5) - 1;
    default:
      return rnd();
  }
}

function adsr(t, dur, a, d, s, r) {
  // t: seconds since note on; dur: seconds held
  let v;
  if (t < a) v = t / Math.max(a, 1e-4);
  else if (t < a + d) v = 1 - (1 - s) * ((t - a) / Math.max(d, 1e-4));
  else v = s;
  if (t > dur) {
    const held = dur < a ? dur / Math.max(a, 1e-4) : dur < a + d ? 1 - (1 - s) * ((dur - a) / d) : s;
    v = held * Math.max(0, 1 - (t - dur) / Math.max(r, 1e-4));
  }
  return Math.max(0, v);
}

// ---------- instruments: render one note into a mono buffer ----------
// Each returns a Float32Array of samples starting at note-on.
function renderNote(inst, freq, dur, vel) {
  const type = inst.type || 'poly';
  const tail = inst.release ?? (type === 'poly' ? 1 : 0.3);
  const len = Math.ceil((dur + tail + 0.05) * SR);
  const out = new Float32Array(len);
  const g = (inst.gain ?? 0.3) * vel;
  if (type === 'poly' || type === 'pluck' || type === 'pad') {
    const oscs = inst.osc || ['saw', 'saw'];
    const det = inst.detune ?? 0.1; // semitones spread
    const filt = svf();
    const ph = oscs.map(() => Math.random());
    const a = inst.attack ?? (type === 'pluck' ? 0.003 : 0.5);
    const d = inst.decay ?? (type === 'pluck' ? 0.25 : 0.5);
    const s = inst.sustain ?? (type === 'pluck' ? 0 : 0.8);
    const lfoRate = inst.lfo ?? 0.15;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      let x = 0;
      for (let k = 0; k < oscs.length; k++) {
        const spread = oscs.length > 1 ? (k / (oscs.length - 1) - 0.5) * 2 * det : 0;
        ph[k] += (freq * 2 ** (spread / 12) * (inst.octaves?.[k] ? 2 ** inst.octaves[k] : 1)) / SR;
        x += osc(oscs[k], ph[k]);
      }
      x /= oscs.length;
      const env = adsr(t, dur, a, d, s, tail);
      const fenv = inst.filterEnv ? 1 + inst.filterEnv * adsr(t, dur, a * 0.5, d, 0, tail) : 1;
      const cutoff = (inst.cutoff ?? 1200) * fenv * (1 + 0.15 * Math.sin(TAU * lfoRate * t));
      out[i] = filt(x, cutoff, inst.res ?? 0.2).lp * env * g;
    }
  } else if (type === 'fm') {
    const ratio = inst.ratio ?? 3.5;
    const index = inst.index ?? 3;
    const decay = inst.decay ?? 3;
    let pc = 0;
    let pm = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.exp(-t / decay) * Math.min(1, t / (inst.attack ?? 0.002)) * (t > dur + tail ? 0 : 1);
      pm += (freq * ratio) / SR;
      pc += freq / SR;
      const mod = Math.sin(TAU * pm) * index * Math.exp(-t / (decay * 0.4));
      out[i] = Math.sin(TAU * pc + mod) * env * g;
    }
  } else if (type === 'noise') {
    // wind / breath: band-passed noise with a slow sweep
    const filt = svf();
    const a = inst.attack ?? 1.5;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const sweep = (inst.cutoff ?? 500) * (1 + (inst.sweep ?? 0.6) * Math.sin(TAU * (inst.lfo ?? 0.07) * t + freq));
      const env = adsr(t, dur, a, 0.5, 1, tail);
      out[i] = filt(rnd(), sweep, inst.res ?? 0.6).bp * env * g;
    }
  } else if (type === 'kick') {
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const f = (inst.low ?? 42) + ((inst.high ?? 130) - (inst.low ?? 42)) * Math.exp(-t * 30);
      ph += f / SR;
      out[i] = (Math.sin(TAU * ph) * Math.exp(-t / (inst.decay ?? 0.35)) + (t < 0.004 ? rnd() * 0.3 : 0)) * g;
    }
  } else if (type === 'snare') {
    const filt = svf();
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      ph += 185 / SR;
      const n = filt(rnd(), 3000, 0.3).bp * Math.exp(-t / (inst.decay ?? 0.16));
      out[i] = (n * 1.4 + Math.sin(TAU * ph) * Math.exp(-t / 0.05) * 0.6) * g;
    }
  } else if (type === 'hat') {
    // differentiated noise: a bright, stable high-pass
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const n = rnd();
      out[i] = (n - prev) * 0.5 * Math.exp(-t / (inst.decay ?? 0.04)) * g;
      prev = n;
    }
  } else if (type === 'tom') {
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      ph += (freq * (1 + 0.6 * Math.exp(-t * 18))) / SR;
      out[i] = Math.sin(TAU * ph) * Math.exp(-t / (inst.decay ?? 0.45)) * g;
    }
  } else if (type === 'howl') {
    // a wolf-like glide: sine + formant-filtered saw rising then falling
    const filt = svf();
    let p1 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const shape = Math.sin(Math.PI * Math.min(1, t / Math.max(dur, 0.1)));
      const f = freq * (1 + 0.5 * shape) * (1 + 0.01 * Math.sin(TAU * 5.5 * t));
      p1 += f / SR;
      const x = 0.6 * Math.sin(TAU * p1) + 0.4 * filt(osc('saw', p1), 900, 0.7).bp;
      out[i] = x * adsr(t, dur, 0.4, 0.2, 0.9, tail) * g;
    }
  } else if (type === 'thunder') {
    const f1 = svf();
    const f2 = svf();
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const crack = t < 0.15 ? f2(rnd(), 2500, 0.2).bp * (1 - t / 0.15) : 0;
      const rumble = f1(rnd(), 120 + 80 * Math.exp(-t), 0.4).lp * Math.exp(-t / (inst.decay ?? 3)) * (1 + 0.5 * Math.sin(TAU * 3 * t + rnd()));
      out[i] = (crack + rumble * 3) * g;
    }
  } else {
    throw new Error(`unknown instrument type "${type}"`);
  }
  return out;
}

// ---------- effects ----------
function reverb(L, R, mix, size = 0.84, damp = 0.25) {
  // Freeverb-ish: 8 parallel combs, 4 serial allpasses, per channel
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const proc = (inp, spread) => {
    const out = new Float32Array(inp.length);
    const cb = combs.map((n) => ({ buf: new Float32Array(n + spread), i: 0, f: 0 }));
    const ab = aps.map((n) => ({ buf: new Float32Array(n + spread), i: 0 }));
    for (let s = 0; s < inp.length; s++) {
      const x = inp[s] * 0.015;
      let y = 0;
      for (const c of cb) {
        const o = c.buf[c.i];
        c.f = o * (1 - damp) + c.f * damp;
        c.buf[c.i] = x + c.f * size;
        c.i = (c.i + 1) % c.buf.length;
        y += o;
      }
      for (const a of ab) {
        const o = a.buf[a.i];
        a.buf[a.i] = y + o * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = o - y;
      }
      out[s] = y;
    }
    return out;
  };
  const wl = proc(L, 0);
  const wr = proc(R, 23);
  for (let s = 0; s < L.length; s++) {
    L[s] = L[s] * (1 - mix * 0.5) + wl[s] * mix;
    R[s] = R[s] * (1 - mix * 0.5) + wr[s] * mix;
  }
}

function delay(L, R, time, feedback, mix) {
  const n = Math.round(time * SR);
  for (let s = n; s < L.length; s++) {
    L[s] += R[s - n] * feedback * mix;
    R[s] += L[s - n] * feedback * mix;
  }
}

// ---------- sequencer ----------
function parsePattern(str) {
  return str
    .replace(/\|/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function renderStem(score, stemName) {
  const stem = score.stems[stemName];
  if (!stem) throw new Error(`no stem "${stemName}"`);
  const bpm = stem.bpm ?? score.bpm ?? 72;
  const bars = stem.bars ?? 8;
  const barSec = (60 / bpm) * 4;
  const loopLen = Math.round(bars * barSec * SR);
  const tailLen = Math.round((stem.tail ?? 4) * SR);
  const L = new Float32Array(loopLen + tailLen);
  const R = new Float32Array(loopLen + tailLen);
  seed = [...stemName].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;

  for (const tr of stem.tracks) {
    const inst = { ...(score.instruments[tr.inst] || {}), ...(tr.params || {}) };
    if (!score.instruments[tr.inst]) throw new Error(`${stemName}: unknown instrument "${tr.inst}"`);
    const steps = parsePattern(tr.pattern);
    const perBar = tr.steps ?? 16;
    const stepSec = barSec / perBar;
    const total = bars * perBar;
    const pan = tr.pan ?? 0;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2 * (tr.gain ?? 1);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2 * (tr.gain ?? 1);
    const tL = new Float32Array(L.length);
    const tR = new Float32Array(R.length);
    for (let i = 0; i < total; i++) {
      const tok = steps[i % steps.length];
      if (tok === '.' || tok === '-') continue;
      if (tr.chance != null && Math.abs(rnd()) > tr.chance) continue;
      let hold = 1;
      while (steps[(i + hold) % steps.length] === '-' && hold < total - i) hold++;
      const accent = tok === 'X' || tok.endsWith('!');
      const notes = tok === 'x' || tok === 'X' ? [tr.note || 'C3'] : tok.replace(/!$/, '').split('+');
      const vel = (accent ? 1 : 0.75) * (1 + 0.08 * rnd());
      const swing = score.swing && i % 2 === 1 ? score.swing * stepSec : 0;
      const start = Math.round((i * stepSec + swing) * SR);
      for (const n of notes) {
        const buf = renderNote(inst, noteFreq(n), hold * stepSec, vel / Math.sqrt(notes.length));
        for (let k = 0; k < buf.length; k++) {
          const at = (start + k) % L.length; // wrap past the end so long notes loop seamlessly
          tL[at] += buf[k] * gl;
          tR[at] += buf[k] * gr;
        }
      }
    }
    if (tr.delay) delay(tL, tR, tr.delay.time ?? stepSec * 3, tr.delay.feedback ?? 0.4, tr.delay.mix ?? 0.4);
    if (tr.reverb) reverb(tL, tR, tr.reverb);
    for (let s = 0; s < L.length; s++) {
      L[s] += tL[s];
      R[s] += tR[s];
    }
  }
  // fold the tail onto the start so the loop is seamless
  const outL = new Float32Array(loopLen);
  const outR = new Float32Array(loopLen);
  for (let s = 0; s < L.length; s++) {
    outL[s % loopLen] += L[s];
    outR[s % loopLen] += R[s];
  }
  // level: normalise loops to the same loudness (score.loudness, dB RMS) so the game can mix
  // them predictably, then soft-clip. One-shots (sfx_*) normalise by peak instead.
  let master = stem.gain ?? score.gain ?? 1;
  const target = stem.loudness ?? score.loudness;
  if (target != null) {
    let sum = 0;
    let peak = 1e-9;
    for (let s = 0; s < loopLen; s++) {
      sum += outL[s] * outL[s] + outR[s] * outR[s];
      peak = Math.max(peak, Math.abs(outL[s]), Math.abs(outR[s]));
    }
    const rms = Math.sqrt(sum / (2 * loopLen)) || 1e-9;
    master *= stemName.startsWith('sfx') ? 0.8 / peak : 10 ** (target / 20) / rms;
  }
  for (let s = 0; s < loopLen; s++) {
    outL[s] = Math.tanh(outL[s] * master);
    outR[s] = Math.tanh(outR[s] * master);
  }
  return { L: outL, R: outR, seconds: loopLen / SR };
}

export function writeWav(file, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

// Render every stem of a score into outDir as .ogg (or .wav/.mp3/.m4a by `format`).
export function renderScore(scoreFile, outDir, { format = 'ogg', only = null, onStem = () => {} } = {}) {
  const score = JSON.parse(fs.readFileSync(scoreFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const name of Object.keys(score.stems)) {
    if (only && !only.includes(name)) continue;
    const t0 = Date.now();
    const { L, R, seconds } = renderStem(score, name);
    const wav = path.join(outDir, `${name}.wav`);
    writeWav(wav, L, R);
    let out = wav;
    if (format !== 'wav') {
      out = path.join(outDir, `${name}.${format}`);
      const codec = { ogg: ['-c:a', 'libvorbis', '-q:a', '5'], mp3: ['-c:a', 'libmp3lame', '-b:a', '160k'], m4a: ['-c:a', 'aac', '-b:a', '160k'] }[format];
      const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, ...codec, out], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error(`ffmpeg failed on ${name}`);
      fs.unlinkSync(wav);
    }
    results.push({ name, file: out, seconds });
    onStem(name, seconds, Date.now() - t0);
  }
  return results;
}
