// Minimal ZIP writer with no dependencies. Already-compressed media is stored as-is (zipping a
// JPEG or MP4 again only wastes time); text files are deflated. Files are streamed, so a
// 500 MB game does not have to fit in memory.
import fs from 'node:fs';
import zlib from 'node:zlib';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, crc = 0) {
  if (zlib.crc32) return zlib.crc32(buf, crc);
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const DEFLATE = /\.(html?|js|mjs|css|json|svg|txt|md|xml|csv)$/i;

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// entries: [{ name: 'assets/bg/a.webp', abs: '/path/to/file' }]
export function writeZip(outPath, entries) {
  const fd = fs.openSync(outPath, 'w');
  let offset = 0;
  const central = [];
  const write = (buf) => {
    fs.writeSync(fd, buf);
    offset += buf.length;
  };
  const CHUNK = 1 << 20;
  const chunk = Buffer.allocUnsafe(CHUNK);
  try {
    for (const e of entries) {
      const st = fs.statSync(e.abs);
      const name = Buffer.from(e.name, 'utf8');
      const { time, date } = dosTime(st.mtime);
      let method = 0;
      let crc = 0;
      let data = null;
      let size = st.size;
      let csize = st.size;
      if (DEFLATE.test(e.name)) {
        const raw = fs.readFileSync(e.abs);
        crc = crc32(raw);
        data = zlib.deflateRawSync(raw, { level: 9 });
        method = 8;
        csize = data.length;
        size = raw.length;
      } else {
        const rfd = fs.openSync(e.abs, 'r');
        let n;
        while ((n = fs.readSync(rfd, chunk, 0, CHUNK, null)) > 0) crc = crc32(chunk.subarray(0, n), crc);
        fs.closeSync(rfd);
      }
      if (offset + csize > 0xfffffffe) throw new Error('zip would be larger than 4 GB');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc >>> 0, 14);
      local.writeUInt32LE(csize, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      const headerAt = offset;
      write(local);
      write(name);
      if (data) write(data);
      else {
        const rfd = fs.openSync(e.abs, 'r');
        let n;
        while ((n = fs.readSync(rfd, chunk, 0, CHUNK, null)) > 0) write(chunk.subarray(0, n));
        fs.closeSync(rfd);
      }
      central.push({ name, method, time, date, crc, csize, size, headerAt });
    }
    const cdStart = offset;
    for (const c of central) {
      const b = Buffer.alloc(46);
      b.writeUInt32LE(0x02014b50, 0);
      b.writeUInt16LE((3 << 8) | 20, 4); // made by unix
      b.writeUInt16LE(20, 6);
      b.writeUInt16LE(0x0800, 8);
      b.writeUInt16LE(c.method, 10);
      b.writeUInt16LE(c.time, 12);
      b.writeUInt16LE(c.date, 14);
      b.writeUInt32LE(c.crc >>> 0, 16);
      b.writeUInt32LE(c.csize, 20);
      b.writeUInt32LE(c.size, 24);
      b.writeUInt16LE(c.name.length, 28);
      b.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      b.writeUInt32LE(c.headerAt, 42);
      write(b);
      write(c.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    write(end);
  } finally {
    fs.closeSync(fd);
  }
  return offset;
}
