#!/usr/bin/env node
// Darkroom — build photo-driven visual novels from Twine/Twee stories for the web and itch.io.
import path from 'node:path';
import fs from 'node:fs';
import { analyze, build } from '../lib/build.mjs';
import { packageProject, itchCheck } from '../lib/package.mjs';
import { serve, preview } from '../lib/serve.mjs';
import { newProject } from '../lib/scaffold.mjs';
import { importTwine } from '../lib/importer.mjs';
import { printReport, mb, red, green, yellow, bold, dim, loadConfig } from '../lib/project.mjs';
import { syncLibrary, loadLibrary, motifIndex } from '../lib/library.mjs';
import { indexAssets, resolveAsset } from '../lib/assets.mjs';
import { develop } from '../lib/develop.mjs';
import { renderScore } from '../lib/groovebox.mjs';
import { hasFfmpeg } from '../lib/lean.mjs';

const HELP = `
${bold('darkroom')} — photo visual novels from Twine stories, ready for itch.io

  darkroom new <folder> [--title "Name"]   start a new project from the template
  darkroom import <twine file or folder> <project>
                                           bring in an existing Twine story (.html or .twee)
  darkroom serve [project] [--port 8080]   live preview; reloads on every save
  darkroom check [project]                 find broken links, missing media, typos
  darkroom build [project] [--lean]        build a playable web folder in dist/
  darkroom package [project] [--no-lean]   shrink media, check itch.io limits, write release/*.zip
  darkroom preview [folder]                play a built folder (default: dist/) locally
  darkroom size [project]                  where the megabytes go
  darkroom develop [project]               develop the piece's moods from its own pictures and sounds
  darkroom library [project] [--prune]     add new photos/videos to library.json, list motifs
  darkroom groove <score.json> [out folder] [--format=ogg|mp3|m4a|wav]
                                           render a groovebox score into synced music loops

  [project] defaults to the current folder. Add --verbose for full lists.
`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--') && ['title', 'port'].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  const project = path.resolve(pos[0] || '.');
  const verbose = !!flags.verbose;

  switch (cmd) {
    case 'new': {
      if (!pos[0]) throw new Error('usage: darkroom new <folder> [--title "Name"]');
      newProject(project, { title: flags.title });
      console.log(`${green('Created')} ${pos[0]}`);
      if (hasFfmpeg()) {
        await develop(project);
        console.log(dim('Developed its moods from the example media (moodboard.html).'));
      }
      console.log(`\nNext:\n  cd ${pos[0]}\n  darkroom serve\n\nWrite in story/*.twee, put photos in assets/bg/, music in assets/music/.`);
      return;
    }
    case 'import': {
      if (pos.length < 2) throw new Error('usage: darkroom import <twine .html/.twee file or folder> <project folder>');
      const target = path.resolve(pos[1]);
      const r = importTwine(pos[0], target, { title: flags.title });
      console.log(`${green('Imported')} ${r.passages} passages${r.format ? ` (${r.format})` : ''} → ${path.relative(process.cwd(), target)}/story/${r.outName}`);
      console.log(`Media copied: ${r.report.copied.length}${r.report.missing.length ? `, ${red(`${r.report.missing.length} not found`)}` : ''}`);
      if (r.report.leftovers.size) console.log(`${r.report.leftovers.size} passage(s) still use macros to convert by hand.`);
      console.log(`\nRead ${path.relative(process.cwd(), target)}/IMPORT-REPORT.md, then run: darkroom check ${path.relative(process.cwd(), target)}`);
      return;
    }
    case 'check': {
      const { result, config } = analyze(project);
      printReport(result, { verbose });
      const n = Object.keys(result.story.passages).length;
      const reach = [...result.reach].length;
      console.log(`\n${n} passages (${reach} reachable), ${result.usedAssets.size} media files (${mb(result.bytes)} before lean), ${result.story.endings.length} endings`);
      if (result.bytes > config.itch.max_total_mb * 1024 * 1024) console.log(dim(`Over ${config.itch.max_total_mb} MB before shrinking — darkroom package will try to make it fit.`));
      if (result.errors.length) {
        console.log(red(`${result.errors.length} error(s)`));
        process.exitCode = 1;
      } else console.log(green('No errors.'));
      return;
    }
    case 'build': {
      const r = await build(project, { lean: !!flags.lean, verbose, outDir: flags.out && path.resolve(flags.out) });
      if (!r.ok) process.exitCode = 1;
      else console.log(dim(`Play it: darkroom preview ${path.relative(process.cwd(), r.outDir) || '.'}`));
      return;
    }
    case 'package': {
      const z = await packageProject(project, { lean: !flags['no-lean'], verbose });
      if (!z) process.exitCode = 1;
      return;
    }
    case 'serve':
    case 'dev':
      await serve(project, { port: Number(flags.port) || 8080 });
      return;
    case 'preview': {
      let dir = project;
      if (fs.existsSync(path.join(dir, 'darkroom.json'))) dir = path.join(dir, 'dist');
      await preview(dir, { port: Number(flags.port) || 8080 });
      return;
    }
    case 'develop': {
      const tty = process.stdout.isTTY;
      const d = await develop(project, {
        onProgress: (n, rel) => tty && process.stdout.write(`\r  measuring ${n} ${dim(rel.slice(0, 50).padEnd(50))}`),
      });
      if (tty) process.stdout.write('\r'.padEnd(70) + '\r');
      if (d.sync.added.length) console.log(`library.json: added ${d.sync.added.join(', ')}`);
      const c = d.collection;
      console.log(bold(`Picture moods`) + dim(` from ${c ? c.pictures : 0} pictures${c?.monochrome ? ' (black and white: tone only)' : ''}`));
      for (const [name, m] of Object.entries(d.moods)) console.log(`  ${green(name.padEnd(18))} ${dim(m.words.join(' · ').padEnd(26))} ${m.pictures.join(', ')}`);
      for (const kind of ['music', 'ambience']) {
        const list = Object.entries(d[kind]);
        if (!list.length) continue;
        console.log(bold(`${kind[0].toUpperCase()}${kind.slice(1)} moods`));
        for (const [name, s] of list) console.log(`  ${green(name.padEnd(18))} ${dim(s.file)}`);
      }
      if (d.palette) console.log(bold('Palette') + `  background ${d.palette.bg}  text ${d.palette.text}  accent ${d.palette.accent}`);
      console.log(`\nWrote moods.json and ${bold('moodboard.html')} (open it in a browser).`);
      console.log(dim('Use them as tags: look-<mood> atmosphere-<mood> motif-<mood or quality> music-<mood> sound-<mood>.'));
      return;
    }
    case 'groove': {
      if (!pos[0]) throw new Error('usage: darkroom groove <score.json> [out folder]');
      const out = path.resolve(pos[1] || 'assets/music');
      renderScore(path.resolve(pos[0]), out, {
        format: flags.format || 'm4a',
        onStem: (name, sec, ms) => console.log(`${name.padEnd(18)} ${sec.toFixed(1)}s  ${dim(`${ms} ms`)}`),
      });
      console.log(green(`Rendered into ${path.relative(process.cwd(), out) || '.'}`));
      return;
    }
    case 'library': {
      const idx = indexAssets(path.join(project, 'assets'));
      const ts = loadConfig(project).title_screen;
      const titleBg = ts.background && resolveAsset(idx, ts.background, 'bg').rel;
      const r = syncLibrary(project, idx, { prune: !!flags.prune, exclude: titleBg ? [titleBg] : [] });
      console.log(`library.json: ${r.total} pictures and videos${r.added.length ? `, ${green(`${r.added.length} added`)}` : ''}${r.pruned.length ? `, ${r.pruned.length} removed` : ''}`);
      if (r.added.length) console.log(dim(`  added: ${r.added.join(', ')}`));
      if (r.missing.length && !r.pruned.length) console.log(`${yellow('warning')} ${r.missing.length} entries point to files that are gone (darkroom library --prune removes them): ${r.missing.join(', ')}`);
      if (r.untagged.length) console.log(`${yellow('to do')}   give these motifs in library.json: ${r.untagged.join(', ')}`);
      const counts = motifIndex(loadLibrary(project, idx).entries);
      if (counts.size) {
        console.log(bold('\nMotifs (pictures per motif):'));
        console.log(`  ${[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m, n]) => `${m} ${dim(n)}`).join('   ')}`);
      }
      return;
    }
    case 'size': {
      const { result, assetIndex, config } = analyze(project);
      const used = [...result.usedAssets.keys()].map((r) => assetIndex.files.get(r)).filter(Boolean);
      const byFolder = new Map();
      for (const f of used) {
        const k = f.rel.split('/')[0];
        byFolder.set(k, (byFolder.get(k) || 0) + f.bytes);
      }
      console.log(bold('Media used by the story (before lean):'));
      for (const [k, v] of [...byFolder].sort((a, b) => b[1] - a[1])) console.log(`  ${mb(v).padStart(10)}  assets/${k}/`);
      console.log(`  ${mb(result.bytes).padStart(10)}  total, ${used.length} files (itch.io limit ${config.itch.max_total_mb} MB)`);
      console.log(bold('\nLargest files:'));
      for (const f of used.sort((a, b) => b.bytes - a.bytes).slice(0, verbose ? 50 : 12)) console.log(`  ${mb(f.bytes).padStart(10)}  ${f.rel}`);
      const dist = path.join(project, 'dist');
      if (fs.existsSync(path.join(dist, 'index.html'))) {
        const c = itchCheck(dist, config.itch);
        console.log(`\nLast build in dist/: ${c.files.length} files, ${mb(c.total)}`);
      }
      return;
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;
    case 'version':
    case '--version':
      console.log(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
      return;
    default:
      console.log(HELP);
      throw new Error(`unknown command "${cmd}"`);
  }
}

main().catch((e) => {
  console.error(`${red('error')} ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exitCode = 1;
});
