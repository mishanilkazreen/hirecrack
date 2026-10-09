// Electron shell. Serves the built app from a small localhost server and opens it in a window.
// A real http origin (rather than file://) is what lets the camera, WASM, workers and the
// model cache work.
const { app, BrowserWindow, session, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// A fixed port keeps the origin stable, so localStorage and cached models survive restarts.
const PREFERRED_PORT = 47821;
const DIST = path.join(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.task': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.onnx': 'application/octet-stream',
};

function serveDist() {
  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = path.normalize(path.join(DIST, urlPath));
    // Compare against DIST plus a separator so a sibling folder like "dist-x" can't match.
    if (file !== DIST && !file.startsWith(DIST + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    // Unknown paths get index.html, as a single-page app expects.
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    // Port already taken: settle for any free one (settings and models won't carry over).
    server.once('error', () => server.listen(0, '127.0.0.1'));
    server.once('listening', () => resolve(`http://127.0.0.1:${server.address().port}`));
    server.listen(PREFERRED_PORT, '127.0.0.1');
  });
}

async function createWindow() {
  const url = process.env.ELECTRON_DEV_URL || (await serveDist());
  const win = new BrowserWindow({
    width: 1200,
    height: 840,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    title: 'HireCrack',
    icon: path.join(DIST, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  // Show only once painted, already maximised, to avoid a resize flash.
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  // F11 toggles real fullscreen even with the menu bar hidden.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  win.loadURL(url);
}

app.whenReady().then(() => {
  // Camera, mic and speaker choice only; deny everything else.
  const allow = new Set(['media', 'speaker-selection', 'mediaKeySystem', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allow.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allow.has(perm));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
