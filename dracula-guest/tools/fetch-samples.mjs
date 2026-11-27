#!/usr/bin/env node
// Fetches the recorded orchestra the score is played on: Versilian Studios' VSCO 2 Community
// Edition (CC0), from GitHub, only the sections the score uses (~1.5 GB) into .cache/vsco.
//   node tools/fetch-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.cache', 'vsco');
const PARTS = [
  '/LICENSE',
  '/Strings/Violin Section/susVib/', '/Strings/Violin Section/Trem/',
  '/Strings/Viola Section/susvib/', '/Strings/Viola Section/trem/',
  '/Strings/Cello Section/susvib/', '/Strings/Cello Section/trem/', '/Strings/Cello Section/spic/',
  '/Strings/Solo Contrabass/SusVib/', '/Strings/Solo Contrabass/Spic/', '/Strings/Harp/',
  '/Brass/F Horn/sus/', '/Brass/Tenor Trombone/sus/', '/Brass/Tuba/sus/',
  '/Percussion/Timpani/', '/Percussion/BDrumNewhit*', '/Keys/Organ/',
];
const git = (args, cwd = DIR) => {
  const r = spawnSync('git', args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
};
if (!fs.existsSync(path.join(DIR, '.git'))) {
  fs.mkdirSync(path.dirname(DIR), { recursive: true });
  git(['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', 'https://github.com/sgossner/VSCO-2-CE', DIR], ROOT);
  git(['config', 'gc.auto', '0']);
  git(['sparse-checkout', 'init', '--no-cone']);
}
fs.writeFileSync(path.join(DIR, '.git', 'info', 'sparse-checkout'), PARTS.join('\n') + '\n');
git(['checkout', '-q', 'HEAD']);
console.log(`VSCO 2 CE sections in ${path.relative(ROOT, DIR)}/`);
