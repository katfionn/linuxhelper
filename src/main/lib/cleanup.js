// SPDX-License-Identifier: MPL-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run, privileged, duBytes, commandExistsSync } = require('./exec');
const pkgs = require('./pkgs');
const paths = require('./paths');

function home(rel) {
  return path.join(paths.home, rel);
}

function buildTargets() {
  return [
    {
      id: 'app-cache',
      label: '应用自身缓存',
      path: paths.dirs.cache,
      desc: 'AI 对话缓存、缩略图、应用源快照、下载的临时文件',
      risk: 'low',
      kind: 'user'
    },
    {
      id: 'thumbnails',
      label: '文件管理器缩略图',
      path: home('.cache/thumbnails'),
      desc: '删除后会自动重建，不影响文件',
      risk: 'low',
      kind: 'user'
    },
    {
      id: 'trash',
      label: '回收站',
      path: home('.local/share/Trash/files'),
      desc: '清空后删除的文件无法恢复',
      risk: 'medium',
      kind: 'user'
    },
    {
      id: 'npm-cache',
      label: 'npm 缓存',
      path: paths.isLinux ? home('.npm') : '',
      desc: 'Node.js 依赖下载缓存',
      risk: 'low',
      kind: 'user'
    },
    {
      id: 'pip-cache',
      label: 'pip 缓存',
      path: home('.cache/pip'),
      desc: 'Python 包下载缓存',
      risk: 'low',
      kind: 'user'
    },
    {
      id: 'flatpak-cache',
      label: 'Flatpak 缓存',
      path: home('.cache/flatpak'),
      desc: 'Flatpak 运行时缓存',
      risk: 'low',
      kind: 'user'
    },
    {
      id: 'apt-archives',
      label: 'APT 安装包缓存',
      path: '/var/cache/apt/archives',
      desc: '系统软件安装包（.deb），清理后如需重装会重新下载',
      risk: 'low',
      kind: 'system',
      cleanCmd: ['apt-get', ['clean']]
    },
    {
      id: 'pacman-cache',
      label: 'Pacman 安装包缓存',
      path: '/var/cache/pacman/pkg',
      desc: '系统软件安装包，只保留最近一个版本更安全',
      risk: 'low',
      kind: 'system',
      cleanCmd: ['pacman', ['-Sc', '--noconfirm']]
    },
    {
      id: 'dnf-cache',
      label: 'DNF 缓存',
      path: '/var/cache/dnf',
      desc: '软件源元数据与安装包缓存',
      risk: 'low',
      kind: 'system',
      cleanCmd: ['dnf', ['clean', 'all']]
    },
    {
      id: 'journal',
      label: '系统日志',
      path: '/var/log/journal',
      desc: '只保留最近 100MB 日志，便于排查问题',
      risk: 'medium',
      kind: 'system',
      cleanCmd: ['journalctl', ['--vacuum-size=100M']]
    }
  ];
}

function dirSize(target) {
  if (!target || !fs.existsSync(target)) return 0;
  const bytes = duBytes(target);
  if (bytes != null) return bytes;
  return 0;
}

function countEntries(dir) {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

async function scan() {
  const targets = buildTargets()
    .filter((t) => t.path && fs.existsSync(t.path))
    .map((t) => {
      const size = dirSize(t.path);
      const exists = true;
      return {
        id: t.id,
        label: t.label,
        desc: t.desc,
        path: t.path,
        risk: t.risk,
        kind: t.kind,
        size,
        entries: countEntries(t.path),
        exists
      };
    });

  let orphans = { packages: [], total: '' };
  try {
    orphans = await pkgs.orphans();
  } catch {
    /* ignore */
  }

  const total = targets.reduce((sum, t) => sum + t.size, 0);
  return {
    demo: pkgs.isDemo(),
    targets,
    total,
    orphans: {
      count: orphans.packages.length,
      total: orphans.total || '',
      packages: orphans.packages.slice(0, 80),
      family: orphans.family || pkgs.family()
    },
    appData: {
      data: dirSize(paths.dirs.data),
      cache: dirSize(paths.dirs.cache),
      logs: dirSize(paths.dirs.logs)
    }
  };
}

async function removeUserPath(target) {
  if (!target || !target.startsWith(paths.home + path.sep)) return { ok: false, error: '路径不在用户目录内' };
  try {
    if (!fs.existsSync(target)) return { ok: true, skipped: true };
    for (const entry of fs.readdirSync(target)) {
      fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function clean(ids, onLine) {
  const selected = new Set(Array.isArray(ids) ? ids : []);
  const targets = buildTargets().filter((t) => selected.has(t.id));
  const results = [];
  let freed = 0;
  const emit = (line, kind) => onLine && onLine({ jobId: 'clean', line, stream: kind });

  if (pkgs.isDemo()) {
    for (const t of targets) results.push({ id: t.id, label: t.label, ok: true, freed: 0, demo: true });
    emit('[演示模式] 已模拟清理，未修改任何文件', 'out');
    return { ok: true, demo: true, results, freed: 0 };
  }

  for (const target of targets) {
    const before = dirSize(target.path);
    emit(`清理：${target.label} (${target.path})`, 'out');
    if (target.id === 'app-cache') {
      // 保留目录本身与设置文件
      const res = await removeUserPath(target.path);
      results.push({ id: target.id, label: target.label, ...res, freed: before });
      if (res.ok) freed += before;
      continue;
    }
    if (target.kind === 'system' && target.cleanCmd) {
      const res = await privileged(target.cleanCmd[0], target.cleanCmd[1], { timeout: 180000 });
      const after = dirSize(target.path);
      const delta = Math.max(0, before - after);
      results.push({
        id: target.id,
        label: target.label,
        ok: res.ok,
        freed: delta,
        error: res.ok ? '' : (res.stderr || '').slice(-400)
      });
      if (res.ok) freed += delta;
      continue;
    }
    const res = await removeUserPath(target.path);
    results.push({ id: target.id, label: target.label, ...res, freed: before });
    if (res.ok) freed += before;
  }
  return { ok: results.every((r) => r.ok), results, freed };
}

async function cleanOrphans(onLine) {
  if (pkgs.isDemo()) return { ok: true, demo: true };
  return pkgs.autoremove(onLine);
}

module.exports = { scan, clean, cleanOrphans, buildTargets };