#!/usr/bin/env node
/**
 * LinuxHelper 环境快照工具
 *
 * 把「和本软件关联的全部数据」当作一个可搬迁的环境：
 *   - data    : ~/.local/share/linux-assistant （设置、密钥、会话、模型运行时）
 *   - cache   : ~/.cache/linux-assistant        （下载缓存、源缓存、截图）
 *   - config  : ~/.config/linux-assistant       （Electron 配置/隔离分区）
 *
 * 用法：
 *   node tools/envpack.mjs status
 *   node tools/envpack.mjs pack [--out ~/LinuxHelper-backup.tar.gz] [--no-cache]
 *   node tools/envpack.mjs restore <备份文件> [--yes]
 *   node tools/envpack.mjs purge [--yes] [--keep-config] [--dry-run]
 *
 * 所有路径都限制在 $HOME 内，不会写入 /usr、/opt 等系统位置。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const HOME = homedir();
const XDG_DATA = process.env.XDG_DATA_HOME || join(HOME, '.local', 'share');
const XDG_CACHE = process.env.XDG_CACHE_HOME || join(HOME, '.cache');
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || join(HOME, '.config');

const isLinux = process.platform === 'linux';
const tarCompat = process.platform === 'win32' ? ['--force-local'] : [];
const dirs = {
  data: isLinux ? join(XDG_DATA, 'linux-assistant') : join(HOME, '.linux-assistant'),
  cache: isLinux ? join(XDG_CACHE, 'linux-assistant') : join(HOME, '.linux-assistant-cache'),
  config: isLinux ? join(XDG_CONFIG, 'linux-assistant') : join(HOME, '.linux-assistant-config')
};
const backupDir = join(isLinux ? XDG_DATA : HOME, 'linux-assistant-backups');

const args = process.argv.slice(2);
const cmd = args[0] || 'status';
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function du(dir) {
  if (!existsSync(dir)) return { bytes: 0, entries: 0 };
  let bytes = 0;
  let entries = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let list;
    try {
      list = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of list) {
      const p = join(cur, item.name);
      try {
        if (item.isDirectory() && !item.isSymbolicLink()) {
          stack.push(p);
        } else if (item.isFile()) {
          bytes += statSync(p).size;
          entries++;
        }
      } catch {
        /* 忽略无权限的条目 */
      }
    }
  }
  return { bytes, entries };
}

const HOME_ROOT = resolve(HOME);

function assertInsideHome(p) {
  const resolved = resolve(HOME_ROOT, String(p));
  const rel = relative(HOME_ROOT, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`拒绝操作家目录之外的路径：${resolved}`);
  }
  return resolved;
}

function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function status() {
  console.log('\nLinuxHelper 环境状态');
  console.log(`  家目录       ${HOME}`);
  console.log(`  平台         ${process.platform}`);
  console.log(`  备份目录     ${backupDir}\n`);
  let total = 0;
  for (const [name, dir] of Object.entries(dirs)) {
    const info = du(dir);
    total += info.bytes;
    const label = { data: '数据', cache: '缓存', config: '配置' }[name];
    console.log(`  ${label.padEnd(4, ' ')} ${existsSync(dir) ? human(info.bytes).padStart(9) : '   不存在'}  ${String(info.entries).padStart(5)} 个文件  ${dir}`);
  }
  console.log(`\n  合计 ${human(total)}`);
  const settingsFile = join(dirs.data, 'settings.json');
  console.log(`  设置文件     ${existsSync(settingsFile) ? '已存在' : '尚未创建（首次启动后生成）'}`);
  if (existsSync(backupDir)) {
    const list = readdirSync(backupDir).filter((f) => f.endsWith('.tar.gz'));
    console.log(`  历史备份     ${list.length ? list.join('\n               ') : '无'}`);
  }
  console.log('');
}

function pack() {
  const out = assertInsideHome(value('--out') || join(backupDir, `linux-assistant-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`));
  if (Object.values(dirs).some((dir) => isInside(out, dir))) {
    throw new Error('备份文件不能放在要备份的数据目录内，请换一个 --out 路径');
  }
  mkdirSync(dirname(out), { recursive: true });
  const includes = [dirs.data, dirs.config, ...(flag('--no-cache') ? [] : [dirs.cache])].filter(existsSync);
  if (!includes.length) {
    console.error('没有可备份的数据，请先启动一次应用。');
    process.exitCode = 1;
    return;
  }
  const manifest = `${out}.manifest.json`;
  writeFileSync(
    manifest,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        includeCache: !flag('--no-cache'),
        dirs
      },
      null,
      2
    )
  );
  const r = spawnSync('tar', [...tarCompat, '-czf', out, '-C', HOME, ...includes.map((d) => d.slice(HOME.length + 1)).filter(Boolean)], {
    stdio: 'inherit'
  });
  if (r.status !== 0) {
    console.error('打包失败：', r.error ? r.error.message : `tar 退出码 ${r.status}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n备份完成：${out}（${human(statSync(out).size)}）`);
  console.log('恢复命令：node tools/envpack.mjs restore ' + out);
}

function restore() {
  const file = args[1];
  if (!file || !existsSync(file)) {
    console.error('用法：node tools/envpack.mjs restore <备份文件.tar.gz>');
    process.exitCode = 1;
    return;
  }
  if (!flag('--yes')) {
    console.log(`将把 ${basename(file)} 解压覆盖到 ${HOME} 下的应用目录：`);
    Object.values(dirs).forEach((d) => console.log('  - ' + d));
    console.log('确认无误请加 --yes 重新执行。');
    return;
  }
  mkdirSync(HOME, { recursive: true });
  const r = spawnSync('tar', [...tarCompat, '-xzf', file, '-C', HOME, '--absolute-names'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('恢复失败：', r.error ? r.error.message : `tar 退出码 ${r.status}`);
    process.exitCode = 1;
    return;
  }
  console.log('恢复完成。重新启动 LinuxHelper 即可生效。');
}

function purge() {
  const targets = [dirs.data, ...(flag('--keep-config') ? [] : [dirs.config]), join(dirs.cache)];
  console.log('将要清除：');
  let total = 0;
  for (const dir of targets) {
    const info = du(dir);
    total += info.bytes;
    console.log(`  ${existsSync(dir) ? human(info.bytes).padStart(9) : '   不存在'}  ${dir}`);
  }
  console.log(`\n合计可释放 ${human(total)}`);
  if (flag('--dry-run')) {
    console.log('（dry-run，未删除任何文件）');
    return;
  }
  if (!flag('--yes')) {
    console.log('确认清除请加 --yes；这是不可恢复操作，建议先执行 pack。');
    return;
  }
  for (const dir of targets) {
    const safe = assertInsideHome(dir);
    if (existsSync(safe)) rmSync(safe, { recursive: true, force: true });
  }
  console.log('已清除。下次启动应用会重新生成默认配置。');
}

try {
  if (cmd === 'status') status();
  else if (cmd === 'pack') pack();
  else if (cmd === 'restore') restore();
  else if (cmd === 'purge') purge();
  else {
    console.log('用法：node tools/envpack.mjs <status|pack|restore|purge> [选项]');
    process.exitCode = 1;
  }
} catch (err) {
  console.error('错误：', err.message);
  process.exitCode = 1;
}