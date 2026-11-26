// Project config (darkroom.json) and console reporting.
import fs from 'node:fs';
import path from 'node:path';

// Visual "looks" for backgrounds: how strongly the photo shows and with what CSS filter.
// These are The Dead City's psychological states; add or override them in darkroom.json scene.looks.
export const DEFAULT_LOOKS = {
  neutral: { opacity: 1, filter: '' },
  quiet: { opacity: 0.9, filter: 'saturate(0.8)' },
  mourning: { opacity: 0.85, filter: 'saturate(0.5) brightness(0.95)' },
  shadowed: { opacity: 0.7, filter: 'brightness(0.7)' },
  dimmed: { opacity: 0.6, filter: 'brightness(0.6)' },
  desaturated: { opacity: 1, filter: 'saturate(0.4)' },
  ghostly: { opacity: 0.5, filter: 'brightness(1.2) saturate(0)' },
  candlelit: { opacity: 0.85, filter: 'sepia(0.2) brightness(1.1)' },
  luminous: { opacity: 1, filter: 'brightness(1.15)' },
  windswept: { opacity: 0.9, filter: 'contrast(1.1)' },
  vast: { opacity: 0.95, filter: 'contrast(0.9)' },
  duplicated: { opacity: 0.8, filter: 'hue-rotate(180deg) saturate(0.3)' },
  uncanny: { opacity: 0.75, filter: 'brightness(1.3) invert(0.1)' },
  chaotic: { opacity: 1, filter: 'blur(2px)' },
  fading: { opacity: 0.5, filter: 'saturate(0.2)' },
  warped: { opacity: 0.9, filter: 'contrast(1.2) saturate(0.7)' },
  doorway: { opacity: 1, filter: '' },
  ethereal: { opacity: 0.8, filter: 'brightness(1.2) saturate(0.3)' },
  waiting: { opacity: 0.9, filter: 'brightness(0.95)' },
  intimate: { opacity: 0.95, filter: 'sepia(0.1) brightness(0.98)' },
  empty: { opacity: 0.85, filter: 'saturate(0.3) brightness(0.85)' },
};

export const DEFAULTS = {
  id: '',
  title: 'Untitled',
  author: '',
  start: null,
  style: null, // a built-in style from runtime/themes, e.g. "vigil"
  mode: 'vn', // "vn" = text box over the picture, click to advance; "page" = Twine-style scrolling page
  beat: 'line', // "line" = every line is a click; "paragraph" = lines are grouped until a blank line
  typewriter: 40, // characters per second, 0 = instant
  bg_fade: 1,
  bg_fit: 'cover', // "cover" fills the screen (crops), "contain" shows the whole photo
  mark_visited: true,
  characters: {},
  title_screen: { background: null, music: null, subtitle: '' },
  theme: {},
  lean: {
    images: true,
    image_max: 1920, // longest side in pixels
    image_format: 'webp', // "webp", "jpg" or "keep"
    image_quality: 80,
    audio: true,
    audio_bitrate: 128, // kbps AAC
    video: true,
    video_max_height: 720,
    video_crf: 26, // H.264 quality: lower = better and bigger (18–30)
  },
  itch: { max_files: 1000, max_total_mb: 500, max_file_mb: 200 },
};

export function slug(s) {
  return String(s || 'story')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'story';
}

export function loadConfig(projectDir) {
  const file = path.join(projectDir, 'darkroom.json');
  if (!fs.existsSync(file)) throw new Error(`No darkroom.json in ${projectDir} — is this a Darkroom project? (create one with: darkroom new <folder>)`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`darkroom.json is not valid JSON: ${e.message}`);
  }
  const c = { ...DEFAULTS, ...raw };
  c.lean = { ...DEFAULTS.lean, ...(raw.lean || {}) };
  c.itch = { ...DEFAULTS.itch, ...(raw.itch || {}) };
  c.title_screen = { ...DEFAULTS.title_screen, ...(raw.title_screen || {}) };
  c.id = c.id || slug(c.title);
  return c;
}

// ---------- console output ----------
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const red = paint(31);
export const yellow = paint(33);
export const green = paint(32);
export const dim = paint(2);
export const bold = paint(1);

export function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function printReport(r, { verbose = false } = {}) {
  const where = (e) => dim(`${e.file}${e.line ? `:${e.line}` : ''}${e.passage ? ` (${e.passage})` : ''}`);
  for (const e of r.errors) console.log(`${red('error')}   ${e.msg}  ${where(e)}`);
  const ws = verbose ? r.warnings : r.warnings.slice(0, 40);
  for (const w of ws) console.log(`${yellow('warning')} ${w.msg}  ${where(w)}`);
  if (ws.length < r.warnings.length) console.log(dim(`  … and ${r.warnings.length - ws.length} more warnings (use --verbose)`));
  for (const i of r.info) {
    console.log(`${dim('note')}    ${i.msg}`);
    if (verbose && i.list) for (const x of i.list) console.log(dim(`          ${x}`));
  }
}
