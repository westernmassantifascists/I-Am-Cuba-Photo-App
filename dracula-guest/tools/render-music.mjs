#!/usr/bin/env node
// Renders music/score.json with the Darkroom groovebox into godot/assets/music/*.ogg
//   node tools/render-music.mjs [stem ...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScore } from '../../darkroom/lib/groovebox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2);
renderScore(path.join(ROOT, 'music', 'score.json'), path.join(ROOT, 'godot', 'assets', 'music'), {
  only: only.length ? only : null,
  onStem: (name, sec, ms) => console.log(`${name.padEnd(16)} ${sec.toFixed(1)}s loop  (${ms} ms)`),
});
