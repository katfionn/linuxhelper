// SPDX-License-Identifier: MPL-2.0
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { shell } = require('electron');
const { run, commandExistsSync } = require('./exec');
const paths = require('./paths');

const KIND_FLAG = { any: '', file: '-type f', dir: '-type d' };

function safeDir(dir) {
  const home = paths.home;
  const target = path.resolve(String(dir || home));
  if (!target.startsWith(home)) return home;
  return target;
}

async function statEntries(found) {
  const out = [];
  for (const filePath of found) {
    try {
      const st = await fsp.stat(filePath);
      out.push({
        path: filePath,
        name: path.basename(filePath),
        dir: path.dirname(filePath),
        size: st.size,
        mtime: st.mtimeMs,
        isDir: st.isDirectory()
      });
    } catch {
      /* ignore vanished files */
    }
  }
  return out;
}

async function search(options = {}) {
  const query = String(options.query || '').trim().slice(0, 200);
  if (!query) return { ok: true, results: [], hint: '输入文件名关键字开始搜索' };
  const dir = safeDir(options.dir);
  const kind = KIND_FLAG[options.kind] ? options.kind : 'any';
  const limit = Math.min(Math.max(Number(options.limit) || 80, 1), 200);

  if (!paths.isLinux) {
    return searchDemo(query, dir, limit);
  }

  const hasFd = commandExistsSync('fd') ? 'fd' : commandExistsSync('fdfind') ? 'fdfind' : null;
  if (hasFd) {
    const args = ['--color', 'never', '--max-results', String(limit), '--ignore-case', '--hidden', '--exclude', '.git'];
    if (kind === 'file') args.push('--type', 'f');
    if (kind === 'dir') args.push('--type', 'd');
    args.push(query, dir);
    const res = await run(hasFd, args, { timeout: 15000 });
    const found = (res.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return { ok: true, results: await statEntries(found), engine: hasFd, truncated: found.length >= limit };
  }

  const args = [dir, '-iname', `*${query}*`, '-print'];
  if (kind === 'file') args.splice(1, 0, '-type', 'f');
  if (kind === 'dir') args.splice(1, 0, '-type', 'd');
  const handle = run('find', args, { timeout: 15000 });
  const res = await handle;
  const found = (res.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, limit);
  return {
    ok: true,
    results: await statEntries(found),
    engine: 'find',
    truncated: found.length >= limit || res.timedOut,
    note: res.timedOut ? '搜索超时，结果可能不完整。安装 fd-find 可显著提速。' : ''
  };
}

async function searchDemo(query, dir, limit) {
  const results = [
    { path: path.join(paths.home, 'Documents', '示例文档.txt'), name: '示例文档.txt', dir: path.join(paths.home, 'Documents'), size: 2480, mtime: Date.now() - 86400000, isDir: false },
    { path: path.join(paths.home, 'Downloads', 'linux-helper.AppImage'), name: 'linux-helper.AppImage', dir: path.join(paths.home, 'Downloads'), size: 118000000, mtime: Date.now() - 3600000, isDir: false },
    { path: path.join(paths.home, 'Pictures', '壁纸'), name: '壁纸', dir: path.join(paths.home, 'Pictures'), size: 0, mtime: Date.now() - 7200000, isDir: true }
  ].filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  return { ok: true, demo: true, results: results.slice(0, limit), engine: '预览' };
}

const SHORTCUTS = () => [
  { id: 'home', label: '主目录', path: paths.home },
  { id: 'desktop', label: '桌面', path: path.join(paths.home, 'Desktop') },
  { id: 'downloads', label: '下载', path: path.join(paths.home, 'Downloads') },
  { id: 'documents', label: '文档', path: path.join(paths.home, 'Documents') },
  { id: 'pictures', label: '图片', path: path.join(paths.home, 'Pictures') },
  { id: 'videos', label: '视频', path: path.join(paths.home, 'Videos') },
  { id: 'config', label: '应用数据', path: paths.dirs.data },
  { id: 'cache', label: '应用缓存', path: paths.dirs.cache }
];

async function open(target) {
  const resolved = path.resolve(String(target || paths.home));
  if (resolved !== paths.home && !resolved.startsWith(paths.home + path.sep)) {
    return { ok: false, error: '只允许打开家目录内的路径' };
  }
  const error = await shell.openPath(resolved);
  return { ok: !error, error };
}

function reveal(target) {
  const resolved = path.resolve(String(target || paths.home));
  shell.showItemInFolder(resolved);
  return { ok: true };
}

module.exports = { search, open, reveal, shortcuts: SHORTCUTS, safeDir };