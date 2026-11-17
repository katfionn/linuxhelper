// SPDX-License-Identifier: MPL-2.0
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, Notification, dialog } = require('electron');

const paths = require('./lib/paths');
const settings = require('./lib/settings');
const data = require('./lib/data');

// 关键：所有数据、缓存、日志都落在用户家目录内
app.setName('LinuxHelper');
app.setPath('userData', paths.dirs.data);
app.setPath('sessionData', paths.dirs.cache);
try {
  app.setPath('crashDumps', path.join(paths.dirs.logs, 'crashes'));
} catch {
  /* ignore */
}

// 打包后图标放在 resources/ 下，开发时用 build/icon.png
const ICON_CANDIDATES = [
  process.resourcesPath ? path.join(process.resourcesPath, 'icon.png') : null,
  path.join(__dirname, '..', '..', 'build', 'icon.png')
].filter(Boolean);
const ICON = ICON_CANDIDATES.find((p) => fs.existsSync(p)) || ICON_CANDIDATES[ICON_CANDIDATES.length - 1];
const startHidden = process.argv.includes('--hidden') || Boolean(process.env.LH_SMOKE);
let mainWindow = null;
let tray = null;
let isQuitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [{ label: '设置', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.send('ui:navigate', 'settings') }, { type: 'separator' }, { role: 'quit', label: '退出' }]
    },
    {
      label: '编辑',
      submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }]
    },
    {
      label: '视图',
      submenu: [{ role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }]
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用文档', click: () => shell.openExternal('https://linuxhelper.local/docs') },
        { label: '关于 Linux 使用助手', click: () => dialog.showMessageBox({ title: 'Linux 使用助手', message: `Linux 使用助手 v${app.getVersion()}`, detail: `Electron ${process.versions.electron} · Node ${process.versions.node}\n数据目录：${paths.dirs.data}\n缓存目录：${paths.dirs.cache}\n许可证：MPL-2.0 · 源码：https://github.com/katfionn/linuxhelper` }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (!fs.existsSync(ICON)) return;
  try {
    const image = nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 });
    tray = new Tray(image);
    tray.setToolTip('Linux 使用助手');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开主界面', click: () => mainWindow?.show() },
        { label: 'AI 助手', click: () => { mainWindow?.show(); mainWindow?.webContents.send('ui:navigate', 'ai'); } },
        { type: 'separator' },
        { label: '退出', click: () => { isQuitting = true; app.quit(); } }
      ])
    );
    tray.on('click', () => mainWindow?.show());
  } catch {
    tray = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 660,
    show: false,
    backgroundColor: '#0b0f14',
    title: 'Linux 使用助手',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: process.platform === 'linux',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  const { register } = require('./ipc');
  register(() => mainWindow);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    const general = settings.publicSettings().general;
    const zoom = Number(general.zoom) || 1;
    mainWindow.webContents.setZoomFactor(zoom);
    if (!startHidden) mainWindow.show();
    maybeShowTip(general);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    const general = settings.publicSettings().general;
    if (!isQuitting && general.closeToTray && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.LH_SMOKE) runSmoke(mainWindow);
}

/**
 * 冒烟测试：在真实 Electron 渲染进程里依次打开每个页面，
 * 收集控制台错误、异常横幅与页面内容长度，结果写到 LH_SMOKE_OUT。
 */
function runSmoke(win) {
  const errors = [];
  win.webContents.on('console-message', (event, level, message) => {
    const msg = message || (event && event.message) || '';
    const lvl = typeof level === 'number' ? level : event && event.level;
    const isErr = lvl === 'error' || lvl === 'warning' || (typeof lvl === 'number' && lvl >= 2);
    if (isErr && !/Autofill/i.test(msg)) errors.push(String(msg).slice(0, 300));
  });
  win.webContents.once('did-finish-load', async () => {
    const routes = ['home', 'ai', 'store', 'files', 'knowledge', 'maintenance', 'settings'];
    const result = { ok: true, routes: {}, errors };
    try {
      await new Promise((r) => setTimeout(r, 1200));
      for (const route of routes) {
        const info = await win.webContents.executeJavaScript(`(async () => {
          window.location.hash = '#/${route}';
          await new Promise((r) => setTimeout(r, 900));
          const root = document.getElementById('view');
          return {
            chars: (root.innerText || '').trim().length,
            text: (root.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
            errored: /页面加载失败|初始化失败/.test(root.innerText || ''),
            banners: [...root.querySelectorAll('.banner')].map((b) => b.innerText.slice(0, 120))
          };
        })()`);
        result.routes[route] = info;
        if (info.errored || info.chars < 40) result.ok = false;
      }
      // 设置页写入一次，验证设置链路
      const settingsOk = await win.webContents.executeJavaScript(`(async () => {
        const s = await window.lh.call('settings:get');
        return Boolean(s && s.general && s.ai && Array.isArray(s.ai.providers) && s.ai.providers.length > 0);
      })()`);
      result.settingsOk = settingsOk;
      if (!settingsOk) result.ok = false;
    } catch (err) {
      result.ok = false;
      result.fatal = String((err && err.stack) || err);
    }
    const out = process.env.LH_SMOKE_OUT;
    const text = JSON.stringify(result, null, 2);
    if (out) fs.writeFileSync(out, text);
    console.log('[smoke] ' + text);
    isQuitting = true;
    app.exit(result.ok ? 0 : 1);
  });
}

function maybeShowTip(general) {
  if (!general.dailyTip || !general.notifications) return;
  if (process.env.LH_SMOKE) return;
  if (!Notification.isSupported()) return;
  const tip = data.dailyTip();
  if (!tip) return;
  setTimeout(() => {
    try {
      new Notification({ title: '今日 Linux 小技巧', body: `${tip.title} · ${tip.body.slice(0, 120)}`, icon: fs.existsSync(ICON) ? ICON : undefined }).show();
    } catch {
      /* ignore */
    }
  }, 4000);
}

app.whenReady().then(async () => {
  buildMenu();
  createWindow();
  createTray();

  try {
    const general = settings.publicSettings().general;
    await settings.applyProxySettings(general.proxy);
  } catch {
    /* ignore proxy setup failure */
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(paths.files.log, `[${new Date().toISOString()}] uncaught: ${err.stack || err}\n`);
  } catch {
    /* ignore */
  }
});