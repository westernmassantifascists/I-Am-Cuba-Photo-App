// `darkroom import`: bring an existing Twine story (published .html, archive .html, or .twee —
// or a whole folder of them) into a Darkroom project.
//  - passages become story/<name>.twee (Twine map positions are kept)
//  - the common SugarCube and Harlowe macros are converted to Darkroom directives
//  - media the story points to is copied into assets/, keeping its folder layout
//  - everything that could not be converted is listed in IMPORT-REPORT.md
import fs from 'node:fs';
import path from 'node:path';
import { parseTwee, parseTwineHTML, writeTwee } from './twine.mjs';
import { mediaType } from './assets.mjs';
import { newProject } from './scaffold.mjs';
import { slug } from './project.mjs';

// ---------- finding sources ----------
function findSources(input) {
  const st = fs.statSync(input);
  if (st.isFile()) return [input];
  const out = [];
  const walk = (d, depth) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (/\.(twee|tw)$/i.test(ent.name)) out.push(p);
      else if (/\.html?$/i.test(ent.name) && /<tw-storydata/i.test(fs.readFileSync(p, 'utf8').slice(0, 2_000_000))) out.push(p);
    }
  };
  walk(input, 0);
  return out;
}

// ---------- Harlowe hooks: (if: x)[...](else-if: y)[...](else:)[...] ----------
function matchClose(s, i, open, close) {
  // s[i] === open; returns index of the matching close, honouring quotes
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'") {
      const k = s.indexOf(c, j + 1);
      if (k === -1) return -1;
      j = k;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j;
  }
  return -1;
}

function convertHarloweIf(text, stats) {
  let out = '';
  let i = 0;
  const re = /\((if|unless):/gi;
  let m;
  while ((m = re.exec(text))) {
    if (m.index < i) continue;
    const condEnd = matchClose(text, m.index, '(', ')');
    if (condEnd === -1) break;
    let cond = text.slice(m.index + m[0].length, condEnd).trim();
    if (m[1].toLowerCase() === 'unless') cond = `not (${cond})`;
    let k = condEnd + 1;
    while (text[k] === ' ') k++;
    if (text[k] !== '[') continue; // not a hook, leave it for the report
    const hookEnd = matchClose(text, k, '[', ']');
    if (hookEnd === -1) break;
    const parts = [`\n@if ${cond}\n${convertHarloweIf(text.slice(k + 1, hookEnd), stats)}\n`];
    let j = hookEnd + 1;
    for (;;) {
      const rest = text.slice(j);
      const em = rest.match(/^\s*\((else-if|elseif|else):\s*([^)]*)\)\s*\[/i);
      if (!em) break;
      const open = j + em[0].length - 1;
      const close = matchClose(text, open, '[', ']');
      if (close === -1) break;
      const body = convertHarloweIf(text.slice(open + 1, close), stats);
      parts.push(em[1].toLowerCase() === 'else' ? `@else\n${body}\n` : `@elseif ${em[2].trim()}\n${body}\n`);
      j = close + 1;
    }
    parts.push('@endif\n');
    out += text.slice(i, m.index) + parts.join('');
    stats.converted.if = (stats.converted.if || 0) + 1;
    i = j;
    re.lastIndex = j;
  }
  return out + text.slice(i);
}

// Replace every (name: ...) Harlowe macro, matching parentheses properly. fn returns the
// replacement, or null to leave the macro alone.
function harloweMacro(text, name, fn) {
  const re = new RegExp(`\\(${name}:`, 'gi');
  let out = '';
  let i = 0;
  let m;
  while ((m = re.exec(text))) {
    const end = matchClose(text, m.index, '(', ')');
    if (end === -1) break;
    const r = fn(text.slice(m.index + m[0].length, end));
    if (r === null) continue;
    out += text.slice(i, m.index) + r;
    i = end + 1;
    re.lastIndex = i;
  }
  return out + text.slice(i);
}

// ---------- macro conversion ----------
function convertText(text, stats) {
  const bump = (k) => (stats.converted[k] = (stats.converted[k] || 0) + 1);
  const unq = (s) => s.trim().replace(/^\[\[(.*)\]\]$/, '$1').replace(/^(["'])(.*)\1$/, '$2');
  let t = text;

  // SugarCube
  t = t.replace(/<<\/?(nobr|silently)>>/g, () => (bump('nobr/silently (removed)'), ''));
  t = t.replace(/<<set\s+([\s\S]+?)>>/g, (m, e) => (bump('set'), `\n@set ${e.trim()}\n`));
  t = t.replace(/<<if\s+([\s\S]+?)>>/g, (m, e) => (bump('if'), `\n@if ${e.trim()}\n`));
  t = t.replace(/<<elseif\s+([\s\S]+?)>>/g, (m, e) => `\n@elseif ${e.trim()}\n`);
  t = t.replace(/<<else>>/g, '\n@else\n');
  t = t.replace(/<<\/if>>|<<endif>>/g, '\n@endif\n');
  t = t.replace(/<<goto\s+([\s\S]+?)>>/g, (m, e) => (bump('goto'), `\n@goto ${unq(e)}\n`));
  t = t.replace(/<<include\s+([\s\S]+?)>>/g, (m, e) => (bump('include'), `\n@include ${unq(e)}\n`));
  t = t.replace(/<<(print|=)\s+([\s\S]+?)>>/g, (m, k, e) => (bump('print'), `{= ${e.trim()}}`));
  t = t.replace(/<<link\s+"([^"]+)"\s+"([^"]+)"\s*>>\s*<<\/link>>/g, (m, a, b) => (bump('link'), `[[${a}->${b}]]`));
  t = t.replace(/\[img\[([^\]]+)\]\]/g, (m, src) => (bump('[img[]]'), `<img src="${src.split('|').pop()}">`));

  // Harlowe
  t = convertHarloweIf(t, stats);
  t = harloweMacro(t, 'set', (e) => {
    bump('set');
    // Harlowe's "it" means the variable being set: (set: $x to it + 1)
    return e.split(/,(?![^(]*\))/).map((part) => {
      const v = part.match(/^\s*(\$\w+)/);
      return `\n@set ${(v ? part.replace(/\bit\b/g, v[1]) : part).trim()}\n`;
    }).join('');
  });
  t = harloweMacro(t, 'go-to', (e) => (bump('goto'), `\n@goto ${unq(e)}\n`));
  t = harloweMacro(t, 'goto', (e) => (bump('goto'), `\n@goto ${unq(e)}\n`));
  t = harloweMacro(t, 'display', (e) => (bump('include'), `\n@include ${unq(e)}\n`));
  t = harloweMacro(t, 'print', (e) => (bump('print'), `{= ${e.trim()}}`));
  t = harloweMacro(t, 'link-goto', (e) => {
    const args = [...e.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
    if (!args.length) return null;
    bump('link-goto');
    return args.length > 1 ? `[[${args[0]}->${args[1]}]]` : `[[${args[0]}]]`;
  });
  t = t.replace(/''(.+?)''/g, '**$1**');
  t = t.replace(/(^|[^:])\/\/(.+?)\/\//g, '$1*$2*');

  // Tidy the blank lines created by putting directives on their own line.
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function leftovers(text) {
  const found = new Set();
  for (const m of text.matchAll(/<<\/?([\w-]+)/g)) found.add(`<<${m[1]}>>`);
  for (const m of text.matchAll(/\(([a-z][\w-]*):/g)) if (!/^(https?|data|mailto)$/.test(m[1])) found.add(`(${m[1]}:)`);
  for (const m of text.matchAll(/\|[\w-]+>\[|\?[\w-]+/g)) found.add('Harlowe named hook');
  return [...found];
}

// ---------- media ----------
const MEDIA_REF = /(?:src|poster|href)\s*=\s*["']([^"'#?]+)["']|url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"'\n]+\.(?:jpe?g|png|webp|gif|avif|svg|mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|mov|webm))["']/gi;

function mediaRefs(text) {
  const refs = new Set();
  for (const m of text.matchAll(MEDIA_REF)) {
    const r = (m[1] || m[2] || m[3] || '').trim();
    if (!r || /^(https?:|data:|\/\/)/.test(r)) continue;
    if (mediaType(r) === 'other') continue;
    refs.add(r.replace(/^\.\//, ''));
  }
  return refs;
}

// ---------- main ----------
export function importTwine(input, projectDir, { title } = {}) {
  input = path.resolve(input);
  if (!fs.existsSync(input)) throw new Error(`${input} does not exist`);
  const sources = findSources(input);
  if (!sources.length) throw new Error(`No Twine stories (.html with <tw-storydata>, .twee, .tw) found in ${input}`);

  const stats = { converted: {} };
  const report = { sources: [], leftovers: new Map(), copied: [], missing: [], scripts: [] };
  const all = [];
  let storyName = title;
  let startName = null;
  let format = null;
  let css = '';

  for (const src of sources) {
    const text = fs.readFileSync(src, 'utf8');
    const baseDir = path.dirname(src);
    let passages;
    if (/\.html?$/i.test(src)) {
      const r = parseTwineHTML(text, path.basename(src));
      passages = r.passages;
      storyName ??= r.story.name;
      startName ??= r.startName;
      format ??= r.story.format && `${r.story.format} ${r.story.formatVersion || ''}`.trim();
      if (r.css) css += `${r.css}\n`;
      if (r.js) report.scripts.push({ from: path.basename(src), js: r.js });
    } else {
      const r = parseTwee(text, path.basename(src));
      passages = r.passages.filter((p) => p.name !== 'StoryTitle' || ((storyName ??= p.text.trim()), false));
      if (r.storyData) {
        startName ??= r.storyData.start;
        format ??= r.storyData.format && `${r.storyData.format} ${r.storyData['format-version'] || ''}`.trim();
      }
      for (const p of passages.filter((x) => x.tags.includes('stylesheet'))) css += `${p.text}\n`;
      for (const p of passages.filter((x) => x.tags.includes('script'))) report.scripts.push({ from: p.name, js: p.text });
      passages = passages.filter((x) => !x.tags.includes('stylesheet') && !x.tags.includes('script'));
    }
    report.sources.push(`${path.relative(process.cwd(), src)} (${passages.length} passages)`);
    for (const p of passages) all.push({ ...p, baseDir });
  }

  // Create the project (no sample story) if needed.
  if (!fs.existsSync(path.join(projectDir, 'darkroom.json'))) newProject(projectDir, { title: storyName || path.basename(projectDir), empty: true });
  const cfgPath = path.join(projectDir, 'darkroom.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (startName) cfg.start = startName;
  if (storyName && (!cfg.title || cfg.title === 'Untitled')) cfg.title = storyName;
  if (!cfg.id) cfg.id = slug(cfg.title);
  // Twine prose is usually written as paragraphs; show it a paragraph at a time.
  cfg.beat = cfg.beat || 'paragraph';
  fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);

  // Copy media, keeping the original folder layout under assets/.
  const assetsDir = path.join(projectDir, 'assets');
  const copyRef = (ref, baseDir, where) => {
    const decoded = decodeURIComponent(ref);
    const abs = path.resolve(baseDir, decoded);
    const dest = path.join(assetsDir, decoded.replace(/^(\.\.\/)+/, ''));
    if (!abs.startsWith(path.dirname(input)) && !abs.startsWith(input)) return report.missing.push(`${ref} (outside the import folder, ${where})`);
    if (!fs.existsSync(abs)) return report.missing.push(`${ref} (${where})`);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
      report.copied.push(path.relative(assetsDir, dest));
    }
  };

  const converted = all.map((p) => {
    const text = convertText(p.text, stats);
    for (const ref of mediaRefs(p.text)) copyRef(ref, p.baseDir, p.name);
    const left = leftovers(text);
    if (left.length) report.leftovers.set(p.name, left);
    return { name: p.name, tags: p.tags, meta: p.meta, text };
  });
  for (const ref of mediaRefs(css)) copyRef(ref, path.dirname(sources[0]), 'stylesheet');

  const storyDir = path.join(projectDir, 'story');
  fs.mkdirSync(storyDir, { recursive: true });
  const outName = `${slug(storyName || 'imported')}.twee`;
  fs.writeFileSync(path.join(storyDir, outName), writeTwee(converted));
  if (css.trim()) {
    // Paths in the old CSS were relative to the story file; media now lives under assets/.
    const fixed = css.replace(/url\(\s*(["']?)(?!https?:|data:)([^"')]+)\1\s*\)/g, 'url($1assets/$2$1)');
    fs.writeFileSync(path.join(storyDir, 'imported-style.twee'), writeTwee([{ name: 'Imported stylesheet', tags: ['stylesheet'], text: fixed }]));
  }
  if (report.scripts.length) {
    fs.writeFileSync(
      path.join(projectDir, 'IMPORTED-SCRIPT.js.txt'),
      report.scripts.map((s) => `/* ---- from ${s.from} ---- */\n${s.js}`).join('\n\n'),
    );
  }

  const lines = [
    `# Import report`,
    '',
    `Imported ${converted.length} passages${format ? ` written for **${format}**` : ''} into \`story/${outName}\`.`,
    '',
    '## Sources',
    ...report.sources.map((s) => `- ${s}`),
    '',
    '## Converted automatically',
    ...(Object.keys(stats.converted).length ? Object.entries(stats.converted).map(([k, v]) => `- ${k}: ${v}`) : ['- nothing']),
    '',
    '## Still to convert by hand',
    report.leftovers.size
      ? 'These passages use macros Darkroom does not run. Rewrite them with directives (see the Darkroom README), then run `darkroom check`.'
      : 'Nothing — every macro was converted.',
    ...[...report.leftovers].map(([name, l]) => `- **${name}**: ${l.join(', ')}`),
    '',
    '## Media',
    `Copied ${report.copied.length} file(s) into assets/.`,
    ...(report.missing.length ? ['', 'Referenced but not found:', ...report.missing.map((m) => `- ${m}`)] : []),
    '',
    '## Story JavaScript',
    report.scripts.length
      ? 'The old Story JavaScript was written for the old story format, so it is **not** run. It is saved in `IMPORTED-SCRIPT.js.txt` for reference; move any parts you still need into a passage tagged `[script]`.'
      : 'None.',
    '',
  ];
  fs.writeFileSync(path.join(projectDir, 'IMPORT-REPORT.md'), lines.join('\n'));
  return { passages: converted.length, outName, report, stats, format };
}
