// SPDX-License-Identifier: MPL-2.0
'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const isLinux = process.platform === 'linux';
const home = os.homedir();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 所有应用数据都放在用户家目录内，不写入 /usr、/opt 等系统位置。
const dataDir = ensureDir(
  isLinux
    ? path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'linux-assistant')
    : path.join(home, '.linux-assistant')
);
const cacheDir = ensureDir(
  isLinux
    ? path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'linux-assistant')
    : path.join(home, '.linux-assistant-cache')
);
const configDir = ensureDir(
  isLinux
    ? path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'linux-assistant')
    : path.join(home, '.linux-assistant-config')
);

const dirs = {
  data: dataDir,
  cache: cacheDir,
  config: configDir,
  logs: ensureDir(path.join(dataDir, 'logs')),
  runtimes: ensureDir(path.join(dataDir, 'runtimes')),
  downloads: ensureDir(path.join(cacheDir, 'downloads')),
  screenshots: ensureDir(path.join(cacheDir, 'screenshots')),
  docker: ensureDir(path.join(dataDir, 'docker')),
  sources: ensureDir(path.join(cacheDir, 'sources')),
  themes: path.join(home, '.local', 'share', 'themes'),
  icons: path.join(home, '.local', 'share', 'icons'),
  wallpapers: path.join(home, 'Pictures', 'LinuxHelper')
};

const files = {
  settings: path.join(dataDir, 'settings.json'),
  secrets: path.join(dataDir, 'secrets.json'),
  sources: path.join(dataDir, 'sources.json'),
  conversation: path.join(dataDir, 'conversation.json'),
  log: path.join(dirs.logs, 'main.log')
};

module.exports = { isLinux, home, dirs, files, ensureDir, dataDir, cacheDir, configDir };