// `darkroom new`: copy the starter template into a new project folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from './project.mjs';

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'template');

export function newProject(dir, { title, empty = false } = {}) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length) {
    if (fs.existsSync(path.join(dir, 'darkroom.json'))) throw new Error(`${dir} is already a Darkroom project`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(TEMPLATE, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(TEMPLATE, src);
      if (/^(\.darkroom|dist|release)(\/|\\|$)/.test(rel)) return false; // build output, caches
      if (empty && /^(story|assets)[\/\\]/.test(rel)) return false;
      if (empty && /^(library|moods)\.json$/.test(rel)) return false;
      return true;
    },
  });
  fs.mkdirSync(path.join(dir, 'story'), { recursive: true });
  const cfgPath = path.join(dir, 'darkroom.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.title = title || path.basename(path.resolve(dir));
  cfg.id = slug(cfg.title);
  if (empty) {
    cfg.start = null;
    cfg.characters = {};
    cfg.title_screen = { background: null, music: null, subtitle: '' };
  }
  fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  try {
    fs.rmSync(path.join(dir, 'moodboard.html'), { force: true });
  } catch {}
  return dir;
}
