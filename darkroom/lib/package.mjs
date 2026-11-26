// `darkroom package`: lean build + itch.io safety checks + versioned zip in release/.
import fs from 'node:fs';
import path from 'node:path';
import { build } from './build.mjs';
import { writeZip } from './zip.mjs';
import { mb, red, yellow, green, bold, dim } from './project.mjs';

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else out.push({ name: path.relative(dir, abs).split(path.sep).join('/'), abs, bytes: fs.statSync(abs).size });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Checks a built web folder against itch.io's HTML5 upload rules.
export function itchCheck(dir, limits) {
  const files = listFiles(dir);
  const problems = [];
  const warnings = [];
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (!files.some((f) => f.name === 'index.html')) problems.push('index.html must be at the top level of the zip');
  if (files.length > limits.max_files) problems.push(`${files.length} files — itch.io allows ${limits.max_files}`);
  if (total > limits.max_total_mb * 1024 * 1024) problems.push(`${mb(total)} in total — itch.io allows ${limits.max_total_mb} MB`);
  for (const f of files) if (f.bytes > limits.max_file_mb * 1024 * 1024) problems.push(`${f.name} is ${mb(f.bytes)} — itch.io allows ${limits.max_file_mb} MB per file`);
  const seen = new Map();
  for (const f of files) {
    const low = f.name.toLowerCase();
    if (seen.has(low)) problems.push(`"${f.name}" and "${seen.get(low)}" differ only by letter case`);
    seen.set(low, f.name);
    if (/[^\x20-\x7e]/.test(f.name)) warnings.push(`"${f.name}" has non-ASCII characters; rename it to be safe`);
    else if (/[ #?%]/.test(f.name)) warnings.push(`"${f.name}" has spaces or #?% in its name; it works, but plain names are safer`);
  }
  if (total > limits.max_total_mb * 1024 * 1024 * 0.9 && total <= limits.max_total_mb * 1024 * 1024) {
    warnings.push(`${mb(total)} is within 10% of the ${limits.max_total_mb} MB limit`);
  }
  const biggest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  return { files, total, problems, warnings, biggest };
}

function nextVersion(releaseDir, base) {
  if (!fs.existsSync(releaseDir)) return 1;
  let v = 0;
  for (const f of fs.readdirSync(releaseDir)) {
    const m = f.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-.*-v(\\d+)\\.zip$`));
    if (m) v = Math.max(v, +m[1]);
  }
  return v + 1;
}

export async function packageProject(projectDir, { lean = true, verbose = false } = {}) {
  const outDir = path.join(projectDir, '.darkroom', 'release-build');
  const b = await build(projectDir, { lean, outDir, verbose });
  if (!b.ok) return false;
  const limits = b.config.itch;
  const c = itchCheck(outDir, limits);

  console.log(`\n${bold('itch.io check')}  ${c.files.length}/${limits.max_files} files, ${mb(c.total)} / ${limits.max_total_mb} MB`);
  for (const w of c.warnings) console.log(`${yellow('warning')} ${w}`);
  if (c.problems.length) {
    for (const p of c.problems) console.log(`${red('problem')} ${p}`);
    console.log(dim('\nLargest files:'));
    for (const f of c.biggest) console.log(dim(`  ${mb(f.bytes).padStart(9)}  ${f.name}`));
    console.log(`\nNot packaged. To shrink it, lower lean.image_max / lean.image_quality / lean.video_crf in darkroom.json,`);
    console.log('or split long videos. If it still cannot fit, itch.io also accepts a downloadable build.');
    return false;
  }

  const releaseDir = path.join(projectDir, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const base = `${b.config.id}-itch`;
  const v = nextVersion(releaseDir, base);
  const zipPath = path.join(releaseDir, `${base}-${day}-v${v}.zip`);
  const size = writeZip(zipPath, c.files);
  console.log(`\n${green('Ready to upload:')} ${path.relative(process.cwd(), zipPath)} (${mb(size)})`);
  console.log(dim('On itch.io: Kind of project = HTML, upload the zip, tick "This file will be played in the browser",'));
  console.log(dim('set the viewport (e.g. 1280 × 720), and turn on "Mobile friendly" and "Fullscreen button".'));
  return zipPath;
}
