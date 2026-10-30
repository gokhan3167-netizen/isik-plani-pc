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
// Menü dili programın diliyle aynı olur (renderer 'set-lang' ile bildirir; ilk açılışta sistem dili)
const MT = {
  tr: { about:'Işık Planı hakkında', hide:'Gizle', others:'Diğerlerini gizle', quit:'Çık', file:'Dosya', close:'Pencereyi kapat', edit:'Düzen', cut:'Kes', copy:'Kopyala', paste:'Yapıştır', view:'Görünüm', full:'Tam ekran', rz:'Yazı boyutunu sıfırla', zi:'Yazıları büyüt', zo:'Yazıları küçült', reload:'Yeniden yükle', win:'Pencere', min:'Küçült', front:'Öne getir' },
  en: { about:'About Işık Planı', hide:'Hide', others:'Hide Others', quit:'Quit', file:'File', close:'Close Window', edit:'Edit', cut:'Cut', copy:'Copy', paste:'Paste', view:'View', full:'Toggle Full Screen', rz:'Actual Size', zi:'Zoom In', zo:'Zoom Out', reload:'Reload', win:'Window', min:'Minimize', front:'Bring All to Front' }
};
function buildMenu(lang) { const t = MT[lang] || MT.tr; return Menu.buildFromTemplate([
  ...(isMac ? [{ label: 'Işık Planı', submenu: [
    { role: 'about', label: t.about }, { type: 'separator' },
    { role: 'hide', label: t.hide }, { role: 'hideOthers', label: t.others }, { type: 'separator' },
    { role: 'quit', label: t.quit } ] }] : []),
  { label: t.file, submenu: [ isMac ? { role: 'close', label: t.close } : { role: 'quit', label: t.quit } ] },
  { label: t.edit, submenu: [
    { role: 'cut', label: t.cut }, { role: 'copy', label: t.copy }, { role: 'paste', label: t.paste } ] },
  { label: t.view, submenu: [
    { role: 'togglefullscreen', label: t.full }, { type: 'separator' },
    { role: 'resetZoom', label: t.rz }, { role: 'zoomIn', label: t.zi }, { role: 'zoomOut', label: t.zo },
    { type: 'separator' }, { role: 'reload', label: t.reload } ] },
  { label: t.win, submenu: [ { role: 'minimize', label: t.min }, ...(isMac ? [{ role: 'front', label: t.front }] : []) ] }
]); }
ipcMain.on('set-lang', (e, l) => { if (l === 'tr' || l === 'en') Menu.setApplicationMenu(buildMenu(l)); });

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu(/^tr/i.test(app.getLocale()) ? 'tr' : 'en'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  setTimeout(checkUpdates, 6000);              // açılıştan biraz sonra güncelleme kontrolü
  setInterval(checkUpdates, 6 * 3600 * 1000);  // açık kalırsa 6 saatte bir
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
// ArtPollReply: konsolun Art-Net düğüm listesinde “Isik Plani” olarak görünürüz;
// grandMA2/3 “Output Auto” modunda veriyi doğrudan bu bilgisayara gönderir.
function artPollReply(ri) {
  if (!sockA) return;
  const all = ips(); const pick = (ri && all.find(ip => ip.split('.').slice(0, 2).join('.') === String(ri.address).split('.').slice(0, 2).join('.'))) || all[0] || '0.0.0.0';
  const ip = pick.split('.').map(n => +n || 0);
  for (let bind = 0; bind < 2; bind++) {
    const b = Buffer.alloc(239);
    b.write('Art-Net\0', 0, 'ascii'); b.writeUInt16LE(0x2100, 8);
    ip.forEach((n, i) => { b[10 + i] = n; }); b.writeUInt16LE(0x1936, 14);
    b[16] = 0; b[17] = 1; b[18] = 0; b[19] = 0;
    b.writeUInt16LE(0x00ff, 20); b[23] = 0xd0; b.writeUInt16LE(0x7ff0, 24);
    b.write('Isik Plani', 26, 'ascii'); b.write('Isik Plani - 3D gorsellestirme', 44, 'ascii'); b.write('#0001 [0000] OK', 108, 'ascii');
    b[173] = 4;
    for (let p = 0; p < 4; p++) { b[174 + p] = 0x80; b[182 + p] = 0x80; b[190 + p] = bind * 4 + p; }
    b[200] = 0x00; ip.forEach((n, i) => { b[207 + i] = n; }); b[211] = bind + 1; b[212] = 0x08;
    try { sockA.send(b, 6454, ri && ri.address ? ri.address : '255.255.255.255'); } catch (e) {}
  }
}
function ips() { return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address); }
function startNet(o) {
  stopNet();
  if (o.artnet) {
    sockA = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sockA.on('message', (m, ri) => {
      if (m.length < 10 || m.toString('ascii', 0, 7) !== 'Art-Net' || m[7] !== 0) return;
      const op = m.readUInt16LE(8);
      if (op === 0x2000) { artPollReply(ri); return; }   // ArtPoll: konsola “buradayım” de
      if (m.length < 18 || op !== 0x5000) return; // ArtDmx
      const port = ((m[15] & 0x7f) << 8) | m[14], len = Math.min(512, m.readUInt16BE(16));
      sendDMX('artnet', port + (o.artBase1 ? 0 : 1), m.subarray(18, 18 + len), ri && ri.address);
    });
    sockA.on('error', e => toWin('net-status', 'Art-Net hatası: ' + (e.code === 'EADDRINUSE' ? 'bu bilgisayarda başka bir program (ör. Capture, MA 3D, Resolume) Art-Net portunu kullanıyor; onu kapatıp tekrar dene' : e.message)));
    sockA.bind(6454, () => { try { sockA.setBroadcast(true); } catch (e) {} toWin('net-status', 'artnet-ok'); });
  }
  if (o.sacn) {
    sockS = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sockS.on('message', (m, ri) => {
      if (m.length < 126 || m.toString('ascii', 4, 13) !== 'ASC-E1.17') return;
      if (m[125] !== 0) return; // yalnız normal DMX (start code 0)
      const uni = m.readUInt16BE(113), cnt = Math.min(512, m.readUInt16BE(123) - 1);
      sendDMX('sacn', uni, m.subarray(126, 126 + cnt), ri && ri.address);
    });
    sockS.on('error', e => toWin('net-status', 'sACN hatası: ' + (e.code === 'EADDRINUSE' ? 'bu bilgisayarda başka bir program (ör. Capture, MA 3D) sACN portunu kullanıyor' : e.message)));
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

// ---------- Güncelleme ----------
// Windows: yeni sürüm arka planda iner, kullanıcı “Yeniden başlat” deyince kurulur (electron-updater, GitHub Releases).
// Mac: Apple imzası olmadan kendini güncelleyemediği için yeni sürüm bildirilir, indirme sayfası açılır.
const REPO = 'gokhan3167-netizen/isik-plani-pc';
let updater = null, updReady = false;
function sendUpd(o) { toWin('update', o); }
function newer(a, b) { const p = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; }
async function checkUpdates(manual) {
  if (!app.isPackaged) { if (manual) sendUpd({ state: 'none', note: 'Geliştirme sürümünde güncelleme denetlenmez.' }); return; }
  try {
    if (process.platform === 'win32') {
      if (!updater) {
        updater = require('electron-updater').autoUpdater;
        updater.autoDownload = true; updater.autoInstallOnAppQuit = true;
        updater.on('update-available', i => sendUpd({ state: 'downloading', version: i.version }));
        updater.on('download-progress', p => sendUpd({ state: 'downloading', percent: Math.round(p.percent || 0) }));
        updater.on('update-downloaded', i => { updReady = true; sendUpd({ state: 'ready', version: i.version }); });
        updater.on('update-not-available', () => { if (manual) sendUpd({ state: 'none', version: app.getVersion() }); });
        updater.on('error', e => sendUpd({ state: 'error', note: String(e && e.message || e).slice(0, 200) }));
      }
      if (updReady) { sendUpd({ state: 'ready' }); return; }
      await updater.checkForUpdates();
    } else {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'IsikPlani' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(), v = String(j.tag_name || '').replace(/^v/, '');
      const dmg = (j.assets || []).find(a => /\.dmg$/i.test(a.name));
      if (v && newer(v, app.getVersion())) sendUpd({ state: 'available', version: v, url: dmg ? dmg.browser_download_url : j.html_url });
      else if (manual) sendUpd({ state: 'none', version: app.getVersion() });
    }
  } catch (e) { if (manual) sendUpd({ state: 'error', note: String(e && e.message || e).slice(0, 200) }); }
}
ipcMain.handle('update-check', () => { checkUpdates(true); return app.getVersion(); });
ipcMain.handle('update-install', () => { if (updater && updReady) { setImmediate(() => updater.quitAndInstall(false, true)); return true; } return false; });
ipcMain.handle('update-open', (e, url) => { if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url); return true; });
