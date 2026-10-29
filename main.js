// Işık Planı – masaüstü uygulaması (Electron)
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const dgram = require('dgram');
const os = require('os');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    title: 'Işık Planı', backgroundColor: '#16191D', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Dış bağlantılar normal tarayıcıda açılır, uygulamanın içinde değil
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

// Türkçe menü. Geri al ve Tümünü seç bilerek menüde yok: Ctrl/Cmd+Z ve Ctrl/Cmd+A
// doğrudan plana gider (planın kendi geri alma ve seçme komutları).
const isMac = process.platform === 'darwin';
const template = [
  ...(isMac ? [{ label: 'Işık Planı', submenu: [
    { role: 'about', label: 'Işık Planı hakkında' }, { type: 'separator' },
    { role: 'hide', label: 'Gizle' }, { role: 'hideOthers', label: 'Diğerlerini gizle' }, { type: 'separator' },
    { role: 'quit', label: 'Çık' } ] }] : []),
  { label: 'Dosya', submenu: [ isMac ? { role: 'close', label: 'Pencereyi kapat' } : { role: 'quit', label: 'Çık' } ] },
  { label: 'Düzen', submenu: [
    { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' } ] },
  { label: 'Görünüm', submenu: [
    { role: 'togglefullscreen', label: 'Tam ekran' }, { type: 'separator' },
    { role: 'resetZoom', label: 'Yazı boyutunu sıfırla' }, { role: 'zoomIn', label: 'Yazıları büyüt' }, { role: 'zoomOut', label: 'Yazıları küçült' },
    { type: 'separator' }, { role: 'reload', label: 'Yeniden yükle' } ] },
  { label: 'Pencere', submenu: [ { role: 'minimize', label: 'Küçült' }, ...(isMac ? [{ role: 'front', label: 'Öne getir' }] : []) ] }
];

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });

// ---------- Konsoldan canlı DMX: Art-Net (UDP 6454) ve sACN / E1.31 (UDP 5568) ----------
let sockA = null, sockS = null;
const lastSent = {};
function toWin(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function sendDMX(proto, uni, buf, from) {
  // Pencereye en fazla ~44 kare/sn gönder (her universe için)
  const k = proto + uni, now = Date.now(); if (lastSent[k] && now - lastSent[k] < 22) return; lastSent[k] = now;
  toWin('dmx', { proto, uni, data: Array.from(buf), from });
}
function stopNet() {
  try { if (sockA) sockA.close(); } catch (e) {}
  try { if (sockS) sockS.close(); } catch (e) {}
  sockA = sockS = null;
}
function ips() { return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address); }
function startNet(o) {
  stopNet();
  if (o.artnet) {
    sockA = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sockA.on('message', (m, ri) => {
      if (m.length < 18 || m.toString('ascii', 0, 7) !== 'Art-Net' || m[7] !== 0) return;
      if (m.readUInt16LE(8) !== 0x5000) return; // ArtDmx
      const port = ((m[15] & 0x7f) << 8) | m[14], len = Math.min(512, m.readUInt16BE(16));
      sendDMX('artnet', port + (o.artBase1 ? 0 : 1), m.subarray(18, 18 + len), ri && ri.address);
    });
    sockA.on('error', e => toWin('net-status', 'Art-Net hatası: ' + e.message));
    sockA.bind(6454, () => { try { sockA.setBroadcast(true); } catch (e) {} });
  }
  if (o.sacn) {
    sockS = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sockS.on('message', (m, ri) => {
      if (m.length < 126 || m.toString('ascii', 4, 13) !== 'ASC-E1.17') return;
      if (m[125] !== 0) return; // yalnız normal DMX (start code 0)
      const uni = m.readUInt16BE(113), cnt = Math.min(512, m.readUInt16BE(123) - 1);
      sendDMX('sacn', uni, m.subarray(126, 126 + cnt), ri && ri.address);
    });
    sockS.on('error', e => toWin('net-status', 'sACN hatası: ' + e.message));
    sockS.bind(5568, () => {
      const from = Math.max(1, o.sFrom | 0), to = Math.min(from + 63, Math.max(from, o.sTo | 0));
      for (let u = from; u <= to; u++) {
        const grp = `239.255.${(u >> 8) & 255}.${u & 255}`;
        for (const ip of ips().concat([undefined])) { try { sockS.addMembership(grp, ip); } catch (e) {} }
      }
    });
  }
  return ips();
}
ipcMain.handle('net-start', (e, o) => startNet(o || {}));
ipcMain.handle('net-stop', () => { stopNet(); return true; });
app.on('before-quit', stopNet);

// ---------- GDTF Share (kullanıcının kendi hesabıyla; şifre saklanmaz) ----------
const GSB = 'https://gdtf-share.com/apis/public/';
let gsCookie = '';
async function gfetch(url, opt = {}) {
  const headers = Object.assign({}, opt.headers || {}); if (gsCookie) headers.Cookie = gsCookie;
  const r = await fetch(url, Object.assign({}, opt, { headers, redirect: 'follow' }));
  const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  if (sc.length) { const jar = {}; (gsCookie ? gsCookie.split('; ') : []).concat(sc.map(c => c.split(';')[0])).forEach(kv => { const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1); }); gsCookie = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '); }
  return r;
}
ipcMain.handle('gdtf-login', async (e, o) => {
  gsCookie = '';
  const r = await gfetch(GSB + 'login.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: o.user, password: o.password }) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.result === true, error: j.error || ('HTTP ' + r.status) };
});
ipcMain.handle('gdtf-list', async () => { const r = await gfetch(GSB + 'getList.php'); return r.json(); });
ipcMain.handle('gdtf-download', async (e, rid) => {
  const r = await gfetch(GSB + 'downloadFile.php?rid=' + encodeURIComponent(rid));
  const ct = r.headers.get('content-type') || '';
  if (!r.ok || ct.includes('json')) { const j = await r.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + r.status)); }
  return new Uint8Array(await r.arrayBuffer());
});
