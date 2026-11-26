// "Lean" builds: shrink media with ffmpeg so a photo-heavy game fits itch.io's web limits.
//   photos  -> WebP (or JPEG), longest side capped (default 1920 px)
//   audio   -> AAC .m4a (plays everywhere, including iPhone Safari), unless already small mp3/m4a
//   video   -> H.264 .mp4 with fast-start, capped height; background videos lose their audio track
// Results are cached in .darkroom/cache, so only new or changed files are converted again.
// A conversion that comes out bigger than the original is thrown away and the original is kept.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

let ffmpegOk;
export function hasFfmpeg() {
  if (ffmpegOk === undefined) {
    const a = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    const b = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
    ffmpegOk = a.status === 0 && b.status === 0;
  }
  return ffmpegOk;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
  });
}

async function probe(file) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,bit_rate:stream_side_data=rotation:format=bit_rate', '-of', 'json', file]);
  try {
    return JSON.parse(r.out);
  } catch {
    return {};
  }
}

const WEB_IMAGE = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif'];

// file: { rel, abs, bytes, mtimeMs, type }, kinds: Set of directives that use it
async function convert(file, kinds, opt, cacheDir) {
  const ext = path.extname(file.rel).slice(1).toLowerCase();
  const keep = { rel: file.rel, abs: file.abs, bytes: file.bytes, note: 'kept' };
  let target;
  let args;

  if (file.type === 'image') {
    if (!opt.images || opt.image_format === 'keep' || ['gif', 'svg'].includes(ext)) return keep;
    const fmt = opt.image_format === 'jpg' ? 'jpg' : 'webp';
    const M = opt.image_max;
    const scale = `scale='if(gt(iw,ih),min(${M},iw),-2)':'if(gt(iw,ih),-2,min(${M},ih))'`;
    target = fmt;
    args = ['-i', file.abs, '-vf', scale, '-frames:v', '1', '-map_metadata', '-1'];
    if (fmt === 'webp') args.push('-c:v', 'libwebp', '-quality', String(opt.image_quality), '-compression_level', '5');
    else args.push('-q:v', String(Math.max(2, Math.round(31 - (opt.image_quality / 100) * 29))));
  } else if (file.type === 'audio') {
    if (!opt.audio) return keep;
    const info = await probe(file.abs);
    const kbps = Number(info.format?.bit_rate || 0) / 1000;
    if (['mp3', 'm4a', 'aac'].includes(ext) && kbps && kbps <= opt.audio_bitrate * 1.2) return keep;
    target = 'm4a';
    args = ['-i', file.abs, '-vn', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', `${opt.audio_bitrate}k`, '-movflags', '+faststart'];
  } else if (file.type === 'video') {
    if (!opt.video) return keep;
    const onlyBackground = [...kinds].every((k) => k === 'bg' || k === 'bgvideo');
    target = 'mp4';
    args = [
      '-i', file.abs,
      '-vf', `scale=-2:'min(${opt.video_max_height},ih)'`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(opt.video_crf), '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-map_metadata', '-1',
    ];
    if (onlyBackground) args.push('-an');
    else args.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    return keep;
  }

  const key = crypto
    .createHash('sha1')
    .update(JSON.stringify([file.rel, file.bytes, file.mtimeMs, args.slice(2), target]))
    .digest('hex')
    .slice(0, 16);
  const cached = path.join(cacheDir, `${key}.${target}`);
  if (!fs.existsSync(cached)) {
    const tmp = `${cached}.part.${target}`;
    const r = await run('ffmpeg', ['-y', '-v', 'error', ...args, tmp]);
    if (r.code !== 0 || !fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch {}
      const webSafe = file.type === 'image' ? WEB_IMAGE.includes(ext) : file.type === 'audio' ? ['mp3', 'm4a', 'aac', 'ogg', 'wav'].includes(ext) : ['mp4', 'm4v', 'webm'].includes(ext);
      return { ...keep, note: `ffmpeg failed, ${webSafe ? 'kept original' : 'kept original (may not play in all browsers)'}: ${r.err.trim().split('\n').pop()}`, warn: !webSafe };
    }
    fs.renameSync(tmp, cached);
  }
  const bytes = fs.statSync(cached).size;
  const originalPlays =
    (file.type === 'image' && WEB_IMAGE.includes(ext)) ||
    (file.type === 'audio' && ['mp3', 'm4a', 'aac'].includes(ext)) ||
    (file.type === 'video' && ['mp4', 'm4v'].includes(ext));
  if (bytes >= file.bytes && originalPlays) return { ...keep, note: 'kept (already small)' };
  const rel = file.rel.slice(0, file.rel.length - ext.length) + target;
  return { rel, abs: cached, bytes, note: `${(file.bytes / 1024).toFixed(0)}K → ${(bytes / 1024).toFixed(0)}K` };
}

// files: [{file, kinds}] -> Map(originalRel -> {rel, abs, bytes, note})
export async function leanAssets(files, opt, cacheDir, onProgress = () => {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = new Map();
  const queue = [...files];
  let done = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(os.cpus().length, 8)) }, async () => {
    while (queue.length) {
      const { file, kinds } = queue.shift();
      const r = await convert(file, kinds, opt, cacheDir);
      out.set(file.rel, r);
      onProgress(++done, files.length, file.rel, r);
    }
  });
  await Promise.all(workers);

  // Two originals can become the same file name (a.png and a.jpg -> a.webp): keep both apart.
  const taken = new Map();
  for (const [orig, r] of [...out.entries()].sort()) {
    const low = r.rel.toLowerCase();
    if (taken.has(low) && taken.get(low) !== orig) {
      const ext = path.posix.extname(r.rel);
      const origExt = path.posix.extname(orig).slice(1);
      r.rel = `${r.rel.slice(0, -ext.length)}-${origExt}${ext}`;
    }
    taken.set(r.rel.toLowerCase(), orig);
  }
  return out;
}
