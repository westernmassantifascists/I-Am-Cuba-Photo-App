// Reading and writing Twine stories.
//  - Twee 3 source files (.twee / .tw), the text format Twine 2.6+ imports and exports.
//  - Twine 2 HTML: library archives and published games (<tw-storydata>), whatever the story format.
// Both produce the same list of passages: { name, tags, text, file, line }.

import fs from 'node:fs';
import path from 'node:path';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined;
}

// ---------- Twee 3 ----------

function unescapeTweeName(s) {
  return s.replace(/\\(.)/g, '$1');
}

export function parseTwee(source, file = '<twee>') {
  const passages = [];
  let storyData = null;
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let cur = null;
  const finish = () => {
    if (!cur) return;
    cur.text = cur.body.join('\n').replace(/\s+$/, '');
    delete cur.body;
    if (cur.name === 'StoryData') {
      try {
        storyData = JSON.parse(cur.text);
      } catch {
        /* ignore malformed StoryData */
      }
    } else {
      passages.push(cur);
    }
    cur = null;
  };
  lines.forEach((line, i) => {
    if (line.startsWith('::')) {
      finish();
      // :: Name [tags] {metadata}
      let rest = line.slice(2).trim();
      let meta = null;
      const metaM = rest.match(/(?<!\\)\{[^{}]*\}\s*$/);
      if (metaM) {
        try {
          meta = JSON.parse(metaM[0]);
        } catch {
          meta = null;
        }
        rest = rest.slice(0, metaM.index).trim();
      }
      let tags = [];
      const tagM = rest.match(/(?<!\\)\[([^\]]*)\]\s*$/);
      if (tagM) {
        tags = tagM[1].split(/\s+/).filter(Boolean);
        rest = rest.slice(0, tagM.index).trim();
      }
      cur = { name: unescapeTweeName(rest), tags, meta, body: [], file, line: i + 1 };
    } else if (cur) {
      cur.body.push(line);
    }
  });
  finish();
  return { passages, storyData };
}

function escapeTweeName(s) {
  return s.replace(/([\\[\]{}])/g, '\\$1');
}

export function writeTwee(passages, storyData) {
  const out = [];
  if (storyData) out.push(':: StoryData', JSON.stringify(storyData, null, 2), '');
  for (const p of passages) {
    let head = `:: ${escapeTweeName(p.name)}`;
    if (p.tags?.length) head += ` [${p.tags.join(' ')}]`;
    if (p.meta) head += ` ${JSON.stringify(p.meta)}`;
    out.push(head, p.text, '');
  }
  return out.join('\n');
}

// ---------- Twine 2 HTML ----------

export function parseTwineHTML(html, file = '<html>') {
  const sd = html.match(/<tw-storydata\b[^>]*>/i);
  if (!sd) throw new Error(`${file}: no <tw-storydata> found — is this a Twine 2 story?`);
  const story = {
    name: attr(sd[0], 'name'),
    format: attr(sd[0], 'format'),
    formatVersion: attr(sd[0], 'format-version'),
    ifid: attr(sd[0], 'ifid'),
    startnode: attr(sd[0], 'startnode'),
  };
  const passages = [];
  let startName = null;
  const re = /<tw-passagedata\b([^>]*)>([\s\S]*?)<\/tw-passagedata>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = `<x ${m[1]}>`;
    const pid = attr(tag, 'pid');
    const p = {
      name: attr(tag, 'name') ?? `Untitled ${pid}`,
      tags: (attr(tag, 'tags') || '').split(/\s+/).filter(Boolean),
      meta: null,
      text: decodeEntities(m[2]),
      file,
      line: html.slice(0, m.index).split('\n').length,
    };
    const pos = attr(tag, 'position');
    const size = attr(tag, 'size');
    if (pos) p.meta = { position: pos, ...(size ? { size } : {}) };
    if (pid && pid === story.startnode) startName = p.name;
    passages.push(p);
  }
  const css = [...html.matchAll(/<style\b[^>]*(?:twine-user-stylesheet|role=["']?stylesheet)[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((x) => x[1])
    .join('\n')
    .trim();
  const js = [...html.matchAll(/<script\b[^>]*(?:twine-user-script|role=["']?script)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((x) => x[1])
    .join('\n')
    .trim();
  return { story, passages, startName, css, js };
}

// ---------- Loading a project's story folder ----------

export function loadStoryDir(dir) {
  const files = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(twee|tw|html?)$/i.test(ent.name)) files.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  files.sort();
  const passages = [];
  let startName = null;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(path.dirname(dir), f);
    if (/\.html?$/i.test(f)) {
      if (!/<tw-storydata/i.test(src)) continue;
      const r = parseTwineHTML(src, rel);
      passages.push(...r.passages);
      if (r.css) passages.push({ name: `${path.basename(f)} stylesheet`, tags: ['stylesheet'], text: r.css, file: rel, line: 1 });
      if (r.js) passages.push({ name: `${path.basename(f)} script`, tags: ['script'], text: r.js, file: rel, line: 1 });
      startName ??= r.startName;
    } else {
      const r = parseTwee(src, rel);
      passages.push(...r.passages);
      if (r.storyData?.start) startName ??= r.storyData.start;
    }
  }
  return { files, passages, startName };
}
