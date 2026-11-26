// The media library (library.json): every photo and video tagged with motifs, so passages can ask
// for an idea ("canal", "mourning") instead of a file name and the engine picks a fitting picture.
// The format is The Dead City's assets.json:
//   { "metadata": {...}, "assets": [ { "id", "category", "file", "type", "motifs": [], "repeatAllowed" } ] }
// Optional per asset: "focal" ("center 74%": which part of the photo to keep on narrow screens)
// and "still" (id of an image to show if a video cannot play).
import fs from 'node:fs';
import path from 'node:path';
import { mediaType, resolveAsset } from './assets.mjs';

export const LIBRARY_FILE = 'library.json';

// Paths in the manifest are relative to assets/ ("Assets/..." prefixes from older builds are accepted).
export function cleanLibraryPath(file) {
  return String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^assets\//i, '');
}

export function readLibrary(projectDir) {
  const file = path.join(projectDir, LIBRARY_FILE);
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`${LIBRARY_FILE} is not valid JSON: ${e.message}`);
  }
  return Array.isArray(raw) ? { metadata: {}, assets: raw } : { metadata: raw.metadata || {}, assets: raw.assets || [] };
}

// Resolve every entry against the assets index. Returns { entries: Map(id -> entry), errors, warnings }.
export function loadLibrary(projectDir, assetIndex) {
  const lib = readLibrary(projectDir);
  const entries = new Map();
  const errors = [];
  const warnings = [];
  if (!lib) return { entries, errors, warnings, present: false };
  const where = (i) => ({ file: LIBRARY_FILE, line: 0, passage: `asset ${i}` });
  lib.assets.forEach((a, i) => {
    if (!a || !a.id) return errors.push({ ...where(i), msg: 'entry without an "id"' });
    if (entries.has(a.id)) return errors.push({ ...where(a.id), msg: `duplicate id "${a.id}"` });
    const r = resolveAsset(assetIndex, cleanLibraryPath(a.file), 'any');
    if (r.error) return errors.push({ ...where(a.id), msg: `"${a.file}": ${r.error}` });
    const type = mediaType(r.rel);
    if (type !== 'image' && type !== 'video') return errors.push({ ...where(a.id), msg: `"${a.file}" is not a picture or video` });
    const motifs = (a.motifs || []).map((m) => String(m).toLowerCase());
    if (!motifs.length) warnings.push({ ...where(a.id), msg: `"${a.id}" has no motifs, so it is only shown when asked for by id` });
    entries.set(a.id, {
      id: a.id,
      rel: r.rel,
      type,
      motifs,
      repeat: a.repeatAllowed !== false,
      category: a.category || '',
      focal: a.focal || null,
      still: a.still || null,
    });
  });
  for (const e of entries.values()) {
    if (e.still && !entries.has(e.still)) errors.push({ ...where(e.id), msg: `"still": "${e.still}" is not an id in the library` });
  }
  return { entries, errors, warnings, present: true };
}

export function motifIndex(entries) {
  const m = new Map();
  for (const e of entries.values()) for (const t of e.motifs) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

// `darkroom library`: add new pictures and videos from assets/ to library.json (with empty motifs to
// fill in), and report entries whose files are gone. Existing entries are never rewritten.
// Pictures used by name rather than by motif are left out: overlays in assets/images/, cut-scenes in
// assets/video/, and anything passed in `exclude` (the title-screen picture).
const BY_NAME = /^(images|video|videos|sprites)\//i;

export function syncLibrary(projectDir, assetIndex, { prune = false, exclude = [] } = {}) {
  const lib = readLibrary(projectDir) || { metadata: { version: '2.0', description: 'Darkroom media library' }, assets: [] };
  const known = new Set(lib.assets.map((a) => cleanLibraryPath(a.file).toLowerCase()));
  const ids = new Set(lib.assets.map((a) => a.id));
  const added = [];
  for (const f of [...assetIndex.files.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (f.type !== 'image' && f.type !== 'video') continue;
    if (known.has(f.rel.toLowerCase())) continue;
    if (BY_NAME.test(f.rel) || exclude.includes(f.rel)) continue;
    let id = path.posix.basename(f.rel, path.posix.extname(f.rel)).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    let n = 2;
    while (ids.has(id)) id = `${id.replace(/_\d+$/, '')}_${n++}`;
    ids.add(id);
    const parts = f.rel.split('/');
    lib.assets.push({ id, category: parts.length > 1 ? parts[parts.length - 2] : '', file: f.rel, type: f.type, motifs: [], repeatAllowed: true });
    added.push(id);
  }
  const missing = lib.assets.filter((a) => resolveAsset(assetIndex, cleanLibraryPath(a.file), 'any').error).map((a) => a.id);
  if (prune && missing.length) lib.assets = lib.assets.filter((a) => !missing.includes(a.id));
  lib.metadata = { ...lib.metadata, totalAssets: lib.assets.length, lastUpdated: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(path.join(projectDir, LIBRARY_FILE), `${JSON.stringify(lib, null, 2)}\n`);
  const untagged = lib.assets.filter((a) => !(a.motifs || []).length).map((a) => a.id);
  return { added, missing, pruned: prune ? missing : [], untagged, total: lib.assets.length };
}
