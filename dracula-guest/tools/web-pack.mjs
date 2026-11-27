#!/usr/bin/env node
// Packs the Godot web export (.cache/web, from the "Web" export preset) into a site that any static
// host with a per-file size limit can serve: the engine (.wasm) and the game (.pck) are cut into
// pieces of at most 14 MB, listed in pieces.json; web/index.html fetches and joins them.
//   godot --headless --path godot --export-release Web ../.cache/web/index.html
//   node tools/web-pack.mjs          -> .cache/site/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '.cache', 'web');
const OUT = path.join(ROOT, '.cache', 'site');
const PIECE = 14 * 1024 * 1024;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const files = {};
for (const name of ['index.wasm', 'index.pck']) {
  const buf = fs.readFileSync(path.join(SRC, name));
  const parts = [];
  for (let i = 0, n = 0; i < buf.length; i += PIECE, n++) {
    const part = `${name.replace('.', '-')}-${String(n).padStart(2, '0')}.bin`;
    fs.writeFileSync(path.join(OUT, part), buf.subarray(i, i + PIECE));
    parts.push(part);
  }
  files[name] = { size: buf.length, parts };
  console.log(`${name}: ${(buf.length / 1048576).toFixed(1)} MB in ${parts.length} pieces`);
}
fs.writeFileSync(path.join(OUT, 'pieces.json'), JSON.stringify({ files }, null, 1));
for (const f of ['index.js', 'index.audio.worklet.js']) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, 'web', 'index.html'), path.join(OUT, 'index.html'));
console.log(`Site in ${path.relative(ROOT, OUT)}/`);
