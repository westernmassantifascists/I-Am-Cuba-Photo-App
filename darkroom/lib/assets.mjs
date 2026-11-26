// Finding media files in a project's assets/ folder.
// Authors can write `@bg harbor`, `@bg harbor.jpg` or `@bg night/harbor.jpg`; the resolver looks in
// the folder that matches the directive first (assets/bg/ for @bg), then in assets/ itself.
// Paths are matched case-sensitively, because itch.io's servers are case-sensitive even when your
// Mac's disk is not — a case-only mismatch is reported as an error instead of breaking online.

import fs from 'node:fs';
import path from 'node:path';

export const TYPES = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg'],
  audio: ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'aif', 'aiff'],
  video: ['mp4', 'm4v', 'mov', 'webm'],
  font: ['woff', 'woff2', 'ttf', 'otf'],
};

export function mediaType(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  for (const [t, exts] of Object.entries(TYPES)) if (exts.includes(ext)) return t;
  return 'other';
}

// directive -> folders to search (in order) and acceptable media types
export const KINDS = {
  bg: { dirs: ['bg', 'backgrounds', 'images'], types: ['image', 'video'] },
  bgvideo: { dirs: ['video', 'bg', 'backgrounds'], types: ['video'] },
  image: { dirs: ['images', 'sprites', 'bg'], types: ['image'] },
  music: { dirs: ['music', 'audio'], types: ['audio'] },
  ambience: { dirs: ['ambience', 'sfx', 'music', 'audio'], types: ['audio'] },
  sfx: { dirs: ['sfx', 'audio'], types: ['audio'] },
  voice: { dirs: ['voice', 'audio'], types: ['audio'] },
  video: { dirs: ['video', 'videos'], types: ['video'] },
  any: { dirs: [], types: ['image', 'audio', 'video', 'font', 'other'] },
};

const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)$/i;

export function indexAssets(assetsDir) {
  const files = new Map(); // relpath -> { rel, abs, bytes, mtimeMs, type }
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || JUNK.test(ent.name)) continue;
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else {
        const rel = path.relative(assetsDir, abs).split(path.sep).join('/');
        const st = fs.statSync(abs);
        files.set(rel, { rel, abs, bytes: st.size, mtimeMs: st.mtimeMs, type: mediaType(rel) });
      }
    }
  };
  walk(assetsDir);
  const lower = new Map();
  for (const rel of files.keys()) lower.set(rel.toLowerCase(), rel);
  return { dir: assetsDir, files, lower };
}

function stripExt(p) {
  const e = path.posix.extname(p);
  return e ? p.slice(0, -e.length) : p;
}

// Returns { rel } on success, or { error, hint }.
export function resolveAsset(index, ref, kind = 'any') {
  const spec = KINDS[kind] ?? KINDS.any;
  const clean = ref.replace(/^\.?\//, '').replace(/^assets\//, '');
  const hasExt = !!path.posix.extname(clean) && mediaType(clean) !== 'other';
  const candidates = [...spec.dirs.map((d) => `${d}/${clean}`), clean];

  for (const c of candidates) {
    if (hasExt) {
      if (index.files.has(c)) return { rel: c };
    } else {
      for (const t of spec.types) {
        for (const ext of TYPES[t] ?? []) {
          if (index.files.has(`${c}.${ext}`)) return { rel: `${c}.${ext}` };
        }
      }
    }
  }
  // Case-insensitive near miss: works on a Mac, breaks on itch.io.
  for (const c of candidates) {
    const low = c.toLowerCase();
    if (hasExt && index.lower.has(low)) {
      return { error: `wrong letter case: file is "${index.lower.get(low)}"`, hint: index.lower.get(low) };
    }
    if (!hasExt) {
      for (const rel of index.files.keys()) {
        if (stripExt(rel).toLowerCase() === low) return { error: `wrong letter case: file is "${rel}"`, hint: rel };
      }
    }
  }
  const where = spec.dirs.length ? `assets/${spec.dirs[0]}/ or assets/` : 'assets/';
  return { error: `file not found (looked in ${where})` };
}
