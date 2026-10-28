// Işık Planı – masaüstü uygulaması (Electron)
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    title: 'Işık Planı', backgroundColor: '#16191D', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
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
