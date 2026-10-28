// Open Fixture Library'nin TAMAMINI indirip programın içine gömer (internetsiz kullanım için).
// Kullanım:  node fixtures.mjs        (Node.js 18 veya üstü; başka hiçbir şey gerekmez)
// Çıktı: www/vendor/ofl-library.js  (www klasörü yoksa vendor/ofl-library.js)
// Kaynak: Open Fixture Library — https://open-fixture-library.org
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import zlib from 'zlib';

const URL = process.env.OFL_ZIP_URL || 'https://codeload.github.com/OpenLightingProject/open-fixture-library/zip/refs/heads/master';
const outDir = existsSync('www') ? 'www/vendor' : 'vendor';

function guessType(s) {
  s = s.toLowerCase();
  if (/strobe|atomic|jdc/.test(s)) return 'strobe';
  if (/haz|fog|smoke/.test(s)) return 'hazer';
  if (/\bbar\b|batten|strip/.test(s)) return 'bar';
  if (/beam|sharpy/.test(s)) return 'beam';
  if (/wash|aura|spiider/.test(s)) return 'wash';
  if (/\bpar\b/.test(s)) return 'par';
  if (/fresnel/.test(s)) return 'fresnel';
  return 'spot';
}
function catType(c, name) {
  c = (c || '').toLowerCase();
  if (/strobe/.test(c)) return 'strobe';
  if (/haz|smoke|fog/.test(c)) return 'hazer';
  if (/blinder/.test(c)) return 'blinder';
  if (/bar/.test(c)) return 'bar';
  if (/color changer/.test(c)) return /bar|batten|strip/i.test(name) ? 'bar' : 'par';
  if (/dimmer/.test(c)) return 'profile';
  return guessType(name);
}
// Küçük ZIP okuyucu (ek paket gerektirmez)
function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP okunamadı');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files.set(name, { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  const read = name => {
    const f = files.get(name); const ln = buf.readUInt16LE(f.off + 26), lx = buf.readUInt16LE(f.off + 28);
    const data = buf.subarray(f.off + 30 + ln + lx, f.off + 30 + ln + lx + f.csize);
    return (f.method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
  };
  return { files, read };
}
try {
  console.log('Open Fixture Library indiriliyor…');
  const res = await fetch(URL); if (!res.ok) throw new Error('HTTP ' + res.status);
  const zip = readZip(Buffer.from(await res.arrayBuffer()));
  const manName = [...zip.files.keys()].find(n => /(^|\/)fixtures\/manufacturers\.json$/.test(n));
  if (!manName) throw new Error('manufacturers.json bulunamadı');
  const base = manName.replace(/manufacturers\.json$/, '');
  const man = JSON.parse(zip.read(manName));
  const out = [];
  for (const name of zip.files.keys()) {
    if (!name.startsWith(base) || !name.endsWith('.json')) continue;
    const rel = name.slice(base.length).split('/'); if (rel.length !== 2) continue;
    let j; try { j = JSON.parse(zip.read(name)); } catch { continue; }
    if (!j || j.redirectTo || !j.name || !Array.isArray(j.modes)) continue;
    const modes = j.modes.map(m => [String(m.name || m.shortName || 'Mod').replace(/[|:]/g, ' '), Array.isArray(m.channels) ? m.channels.length : 0]).filter(m => m[1] > 0);
    if (!modes.length) continue;
    const brand = (man[rel[0]] && man[rel[0]].name) || rel[0];
    const ph = j.physical || {};
    out.push([brand, j.name, catType((j.categories || [])[0], j.name), modes.map(m => m[0] + ':' + m[1]).join('|'), ph.power || '', ph.weight || '']);
  }
  out.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outDir + '/ofl-library.js', '/* Kaynak: Open Fixture Library (open-fixture-library.org) — ' + new Date().toISOString().slice(0, 10) + ' */\nwindow.OFL_LIB=' + JSON.stringify(out) + ';\n');
  console.log(`${out.length} cihaz kaydedildi: ${outDir}/ofl-library.js`);
} catch (e) {
  console.warn('Cihaz kütüphanesi indirilemedi (' + e.message + '). Program yerleşik kütüphaneyle çalışmaya devam eder.');
  process.exit(0);
}
