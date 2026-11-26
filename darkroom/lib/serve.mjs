// `darkroom serve`: live preview while writing. Rebuilds the story on every save and reloads the
// browser. Media is served straight from assets/ (no copying), with byte-range support so that
// audio and video play in Safari. Also prints a network address for testing on a phone.
// `darkroom preview`: serves a finished dist/ folder the same way.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { analyze, writeWebFiles } from './build.mjs';
import { printReport, green, red, dim } from './project.mjs';

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime');

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

function sendFile(req, res, file) {
  let st;
  try {
    st = fs.statSync(file);
    if (!st.isFile()) throw new Error();
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  const type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (range) {
    let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(st.size - 1, end);
    if (start > end) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function safeJoin(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const p = path.normalize(path.join(base, decoded));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function addresses(port) {
  const out = [`http://localhost:${port}/`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}/`);
  }
  return out;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') resolve(listen(server, port + 1));
      else reject(e);
    });
    server.listen(port, '0.0.0.0', () => resolve(port));
  });
}

export async function serve(projectDir, { port = 8080 } = {}) {
  const devDir = path.join(projectDir, '.darkroom', 'dev');
  const assetsDir = path.join(projectDir, 'assets');
  const clients = new Set();

  const rebuild = () => {
    const t0 = Date.now();
    try {
      const { config, result, assetIndex } = analyze(projectDir);
      const assetsMeta = {};
      for (const rel of result.usedAssets.keys()) {
        const f = assetIndex.files.get(rel);
        if (f) assetsMeta[rel] = { type: f.type, bytes: f.bytes };
      }
      writeWebFiles(devDir, { config, story: result.story, dev: true, assetsMeta, errors: result.errors, warnings: result.warnings });
      console.log(dim(`\n[${new Date().toLocaleTimeString()}] rebuilt in ${Date.now() - t0} ms`));
      printReport(result);
      if (!result.errors.length) console.log(green('no errors'));
    } catch (e) {
      console.log(`${red('error')} ${e.message}`);
    }
    for (const c of clients) c.write('data: reload\n\n');
  };
  rebuild();

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__live') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': hi\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (u.pathname.startsWith('/assets/')) {
      const f = safeJoin(assetsDir, u.pathname.slice('/assets/'.length));
      return f ? sendFile(req, res, f) : res.writeHead(403).end();
    }
    const f = safeJoin(devDir, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
    return f ? sendFile(req, res, f) : res.writeHead(403).end();
  });
  const actual = await listen(server, port);
  console.log(`\nPreview running. Open ${green(addresses(actual)[0])}`);
  for (const a of addresses(actual).slice(1)) console.log(dim(`  on a phone on the same Wi-Fi: ${a}`));
  console.log(dim('  Press ` (backtick) in the game for the passage jump / variable panel. Ctrl+C to stop.'));

  let timer;
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  };
  for (const target of ['story', 'assets', 'darkroom.json']) {
    const p = path.join(projectDir, target);
    if (fs.existsSync(p)) fs.watch(p, { recursive: fs.statSync(p).isDirectory() }, kick);
  }
  fs.watch(RUNTIME, kick); // editing the engine itself also reloads
  return server;
}

export async function preview(dir, { port = 8080 } = {}) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error(`${dir} has no index.html — run darkroom build first`);
  const base = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const f = safeJoin(base, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
    return f ? sendFile(req, res, f) : res.writeHead(403).end();
  });
  const actual = await listen(server, port);
  console.log(`Serving ${dir} at ${green(addresses(actual)[0])}`);
  for (const a of addresses(actual).slice(1)) console.log(dim(`  on a phone on the same Wi-Fi: ${a}`));
  return server;
}
