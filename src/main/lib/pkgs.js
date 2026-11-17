// SPDX-License-Identifier: MPL-2.0
'use strict';

const { run, stream, privileged, privilegedStream } = require('./exec');
const distro = require('./distro');

const NAME_RE = /^[a-z0-9][a-z0-9+._:@/-]*$/i;

const DEMO_INSTALLED = [
  { name: 'firefox', version: '128.4.0', summary: '网页浏览器' },
  { name: 'git', version: '2.43.0', summary: '版本控制工具' },
  { name: 'vim', version: '9.1', summary: '文本编辑器' },
  { name: 'curl', version: '8.5.0', summary: '命令行网络工具' },
  { name: 'vlc', version: '3.0.20', summary: '多媒体播放器' }
];

function family() {
  return distro.infoSync().family;
}

function isDemo() {
  return !distro.infoSync().isLinux;
}

function normalizeNames(list) {
  if (!Array.isArray(list)) return { ok: false, error: '软件包列表格式错误' };
  const names = [...new Set(list.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!names.length) return { ok: false, error: '软件包列表为空' };
  const bad = names.find((n) => !NAME_RE.test(n) || n.startsWith('-'));
  if (bad) return { ok: false, error: `非法软件包名：${bad}` };
  return { ok: true, names };
}

function clampLimit(limit, max = 80) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return max;
  return Math.min(Math.floor(n), max);
}

/* ------------------------------- 已安装列表 ------------------------------- */

async function aptInstalled() {
  const res = await run('dpkg-query', ['-W', '-f=${Package}\\t${Version}\\t${db:Status-Abbrev}\\t${binary:Summary}\\n'], {
    timeout: 25000
  });
  if (!res.ok) return [];
  return res.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 3 && cols[2].trim().startsWith('ii'))
    .map((cols) => ({ name: cols[0], version: cols[1], summary: (cols[3] || '').trim(), source: 'apt' }));
}

async function pacmanInstalled() {
  const res = await run('pacman', ['-Q'], { timeout: 20000 });
  if (!res.ok) return [];
  return res.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2)
    .map((cols) => ({ name: cols[0], version: cols[1], summary: '', source: 'pacman' }));
}

async function rpmInstalled() {
  const res = await run('rpm', ['-qa', '--qf', '%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{SUMMARY}\\n'], { timeout: 25000 });
  if (!res.ok) return [];
  return res.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 2)
    .map((cols) => ({ name: cols[0], version: cols[1], summary: (cols[2] || '').trim(), source: 'rpm' }));
}

let installedCache = { at: 0, data: null };

async function listInstalled(force = false) {
  if (isDemo()) return { demo: true, packages: DEMO_INSTALLED };
  if (!force && installedCache.data && Date.now() - installedCache.at < 60000) {
    return { demo: false, packages: installedCache.data };
  }
  let packages = [];
  switch (family()) {
    case 'apt':
      packages = await aptInstalled();
      break;
    case 'pacman':
      packages = await pacmanInstalled();
      break;
    case 'dnf':
    case 'zypper':
      packages = await rpmInstalled();
      break;
    case 'apk':
      packages = [];
      break;
    default:
      packages = [];
  }
  installedCache = { at: Date.now(), data: packages };
  return { demo: false, packages, family: family() };
}

async function installedSet() {
  const { packages } = await listInstalled();
  return new Set(packages.map((p) => p.name.toLowerCase()));
}

/* --------------------------------- 搜索 --------------------------------- */

async function search(query, limit) {
  const q = String(query || '').trim();
  const max = clampLimit(limit, 60);
  if (!q) return { packages: [] };
  if (isDemo()) {
    const demoCatalog = [
      ['firefox', 'Mozilla Firefox 浏览器'], ['chromium', '开源 Chromium 浏览器'], ['vlc', 'VLC 多媒体播放器'],
      ['libreoffice', '办公套件'], ['gimp', '图像编辑'], ['inkscape', '矢量绘图'], ['krita', '数字绘画'],
      ['obs-studio', '录屏与直播'], ['telegram-desktop', 'Telegram 客户端'], ['code', 'Visual Studio Code'],
      ['timeshift', '系统快照备份'], ['flatpak', 'Flatpak 应用支持'], ['neofetch', '系统信息展示'],
      ['htop', '进程监视器'], ['btop', '现代化资源监视器'], ['nodejs', 'Node.js 运行时'], ['python3', 'Python 解释器'],
      ['docker.io', '容器引擎'], ['wine', '运行 Windows 程序'], ['steam', '游戏平台'], ['timeshift', '快照工具']
    ].filter(([name, desc]) => name.includes(q.toLowerCase()) || desc.includes(q));
    return { demo: true, packages: demoCatalog.slice(0, max).map(([name, summary]) => ({ name, summary })) };
  }

  const fam = family();
  let packages = [];
  if (fam === 'apt') {
    const res = await run('apt-cache', ['search', '--names-only', '--', q], { timeout: 15000 });
    packages = (res.stdout || '')
      .split('\n')
      .map((line) => line.match(/^([^\s]+)\s+-\s+(.*)$/))
      .filter(Boolean)
      .map((m) => ({ name: m[1], summary: m[2].trim() }));
  } else if (fam === 'pacman') {
    const res = await run('pacman', ['-Ss', '--', q], { timeout: 15000 });
    const lines = (res.stdout || '').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const head = lines[i].match(/^\S+\/(\S+)\s+(\S+)/);
      if (head) {
        packages.push({
          name: head[1],
          version: head[2],
          summary: (lines[i + 1] || '').trim(),
          repo: lines[i].split('/')[0]
        });
      }
    }
  } else if (fam === 'dnf') {
    const res = await run('dnf', ['-q', 'search', q], { timeout: 25000 });
    const lines = (res.stdout || '').split('\n');
    for (const line of lines) {
      const m = line.match(/^([\w.+-]+)\.(\w+)\s+:\s+(.*)$/);
      if (m && !packages.some((p) => p.name === m[1])) packages.push({ name: m[1], summary: m[3].trim() });
    }
  } else if (fam === 'apk') {
    const res = await run('apk', ['search', '-v', q], { timeout: 15000 });
    packages = (res.stdout || '')
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 2)
      .map((cols) => ({ name: cols[0], version: cols[1], summary: '' }));
  } else if (fam === 'zypper') {
    const res = await run('zypper', ['--non-interactive', 'search', q], { timeout: 25000 });
    packages = (res.stdout || '')
      .split('\n')
      .map((line) => line.match(/^\S+\s*\|\s*(\S+)\s*\|\s*(\S*)\s*\|\s*(\S+)\s*\|\s*(.*)$/))
      .filter(Boolean)
      .map((m) => ({ name: m[3], version: m[2], summary: (m[4] || '').trim() }));
  }
  return { packages: packages.slice(0, max), family: fam };
}

async function info(name) {
  const check = normalizeNames([name]);
  if (!check.ok) return { ok: false, error: check.error };
  const pkg = check.names[0];
  if (isDemo()) {
    return {
      ok: true,
      demo: true,
      info: {
        name: pkg,
        version: '1.0.0',
        description: '演示模式下的软件包信息。安装到真实 Linux 系统后会显示真实的包元数据。',
        size: '—',
        homepage: '',
        installed: DEMO_INSTALLED.some((p) => p.name === pkg)
      }
    };
  }
  const fam = family();
  if (fam === 'apt') {
    const res = await run('apt-cache', ['show', '--', pkg], { timeout: 12000 });
    if (!res.ok) return { ok: false, error: res.stderr || '未找到该软件包' };
    const get = (key) => {
      const m = res.stdout.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return m ? m[1].trim() : '';
    };
    return {
      ok: true,
      info: {
        name: pkg,
        version: get('Version'),
        description: get('Description'),
        size: get('Installed-Size') ? `${Math.round(Number(get('Installed-Size')) / 1024)} MB` : '',
        homepage: get('Homepage'),
        installed: (await installedSet()).has(pkg.toLowerCase())
      }
    };
  }
  if (fam === 'pacman') {
    const res = await run('pacman', ['-Si', '--', pkg], { timeout: 12000 });
    if (!res.ok) return { ok: false, error: res.stderr || '未找到该软件包' };
    const get = (key) => {
      const m = res.stdout.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'));
      return m ? m[1].trim() : '';
    };
    return {
      ok: true,
      info: {
        name: pkg,
        version: get('Version'),
        description: get('Description'),
        size: get('Installed Size') || get('Download Size'),
        homepage: get('URL'),
        installed: (await installedSet()).has(pkg.toLowerCase())
      }
    };
  }
  const cmd = fam === 'dnf' ? ['dnf', ['-q', 'info', pkg]] : ['zypper', ['--non-interactive', 'info', pkg]];
  const res = await run(cmd[0], cmd[1], { timeout: 20000 });
  return { ok: res.ok, info: { name: pkg, description: res.stdout.slice(0, 4000) }, error: res.ok ? '' : res.stderr };
}

/* --------------------------------- 安装 --------------------------------- */

const jobs = new Map();

function startJob(kind, names, onLine) {
  const jobId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const id = jobId;
  const emit = (line, streamKind) => {
    if (onLine) onLine({ jobId: id, line, stream: streamKind });
  };
  let handle;
  const fam = family();

  if (isDemo()) {
    emit(`[演示模式] 模拟执行：${names.join(' ')}`, 'out');
    handle = { promise: Promise.resolve(0), cancel() {} };
    jobs.set(id, handle);
    return { jobId: id, handle };
  }

  if (kind === 'install') {
    if (fam === 'apt') handle = privilegedStream('apt-get', ['install', '-y', '--no-install-recommends', ...names], emit, { timeout: 0 });
    else if (fam === 'pacman') handle = privilegedStream('pacman', ['-S', '--noconfirm', '--needed', ...names], emit, { timeout: 0 });
    else if (fam === 'dnf') handle = privilegedStream('dnf', ['install', '-y', ...names], emit, { timeout: 0 });
    else if (fam === 'zypper') handle = privilegedStream('zypper', ['--non-interactive', 'install', ...names], emit, { timeout: 0 });
    else if (fam === 'apk') handle = privilegedStream('apk', ['add', ...names], emit, { timeout: 0 });
  } else if (kind === 'remove') {
    if (fam === 'apt') handle = privilegedStream('apt-get', ['remove', '-y', ...names], emit, { timeout: 0 });
    else if (fam === 'pacman') handle = privilegedStream('pacman', ['-Rns', '--noconfirm', ...names], emit, { timeout: 0 });
    else if (fam === 'dnf') handle = privilegedStream('dnf', ['remove', '-y', ...names], emit, { timeout: 0 });
    else if (fam === 'zypper') handle = privilegedStream('zypper', ['--non-interactive', 'remove', ...names], emit, { timeout: 0 });
    else if (fam === 'apk') handle = privilegedStream('apk', ['del', ...names], emit, { timeout: 0 });
  } else if (kind === 'upgrade') {
    if (fam === 'apt') handle = privilegedStream('apt-get', ['upgrade', '-y'], emit, { timeout: 0 });
    else if (fam === 'pacman') handle = privilegedStream('pacman', ['-Syu', '--noconfirm'], emit, { timeout: 0 });
    else if (fam === 'dnf') handle = privilegedStream('dnf', ['upgrade', '-y'], emit, { timeout: 0 });
  } else if (kind === 'update-index') {
    if (fam === 'apt') handle = privilegedStream('apt-get', ['update'], emit, { timeout: 0 });
    else if (fam === 'pacman') handle = privilegedStream('pacman', ['-Sy'], emit, { timeout: 0 });
    else if (fam === 'dnf') handle = privilegedStream('dnf', ['-y', 'makecache'], emit, { timeout: 0 });
    else if (fam === 'zypper') handle = privilegedStream('zypper', ['--non-interactive', 'refresh'], emit, { timeout: 0 });
    else if (fam === 'apk') handle = privilegedStream('apk', ['update'], emit, { timeout: 0 });
  } else if (kind === 'autoremove') {
    if (fam === 'apt') handle = privilegedStream('apt-get', ['autoremove', '-y'], emit, { timeout: 0 });
    else if (fam === 'pacman') handle = privilegedStream('pacman', ['-Rns', '--noconfirm', ...names], emit, { timeout: 0 });
    else if (fam === 'dnf') handle = privilegedStream('dnf', ['autoremove', '-y'], emit, { timeout: 0 });
  }

  if (!handle) {
    emit('当前系统的包管理器暂不支持该操作', 'error');
    handle = { promise: Promise.resolve(1), cancel() {} };
  }
  jobs.set(id, handle);
  handle.promise.finally(() => {
    installedCache = { at: 0, data: null };
    setTimeout(() => jobs.delete(id), 60000);
  });
  return { jobId: id, handle };
}

async function install(list, onLine) {
  const check = normalizeNames(list);
  if (!check.ok) return { ok: false, error: check.error };
  const { jobId, handle } = startJob('install', check.names, onLine);
  const code = await handle.promise;
  return { ok: code === 0, code, jobId, packages: check.names };
}

async function remove(list, onLine, purge = false) {
  const check = normalizeNames(list);
  if (!check.ok) return { ok: false, error: check.error };
  if (purge && family() === 'apt' && !isDemo()) {
    const jobId = `purge-${Date.now()}`;
    const emit = (line, kind) => onLine && onLine({ jobId, line, stream: kind });
    const handle = privilegedStream('apt-get', ['purge', '-y', ...check.names], emit, { timeout: 0 });
    jobs.set(jobId, handle);
    const code = await handle.promise;
    installedCache = { at: 0, data: null };
    return { ok: code === 0, code, jobId };
  }
  const { jobId, handle } = startJob('remove', check.names, onLine);
  const code = await handle.promise;
  return { ok: code === 0, code, jobId };
}

async function updateIndex(onLine) {
  const { jobId, handle } = startJob('update-index', [], onLine);
  const code = await handle.promise;
  return { ok: code === 0, code, jobId };
}

async function upgradeAll(onLine) {
  const { jobId, handle } = startJob('upgrade', [], onLine);
  const code = await handle.promise;
  installedCache = { at: 0, data: null };
  return { ok: code === 0, code, jobId };
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.cancel();
  return true;
}

/* ------------------------------- 可升级 / 孤儿 ------------------------------- */

async function upgrades() {
  if (isDemo()) return { packages: [{ name: 'firefox', current: '128.4.0', next: '129.0.1' }] };
  const fam = family();
  let packages = [];
  if (fam === 'apt') {
    const res = await run('apt', ['list', '--upgradable'], { timeout: 30000, env: { LC_ALL: 'C' } });
    packages = (res.stdout || '')
      .split('\n')
      .map((line) => line.match(/^([^\s/]+)\/\S+\s+(\S+)\s+\S+/))
      .filter(Boolean)
      .map((m) => ({ name: m[1], next: m[2] }));
  } else if (fam === 'pacman') {
    const res = await run('pacman', ['-Qu'], { timeout: 20000 });
    packages = (res.stdout || '')
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 4)
      .map((cols) => ({ name: cols[0], current: cols[1], next: cols[3] }));
  } else if (fam === 'dnf') {
    const res = await run('dnf', ['-q', 'check-update'], { timeout: 60000 });
    packages = (res.stdout || '')
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 3 && /^\S+\.\S+$/.test(cols[0]))
      .map((cols) => ({ name: cols[0].split('.')[0], next: cols[1] }));
  }
  return { packages: packages.slice(0, 200), family: fam };
}

async function orphans() {
  if (isDemo()) return { packages: [{ name: 'libexample-unused', version: '1.2', size: '4.1 MB' }] };
  const fam = family();
  let packages = [];
  if (fam === 'apt') {
    const res = await run('apt-get', ['-s', '--no-install-recommends', 'autoremove'], { timeout: 30000, env: { LC_ALL: 'C' } });
    const sizes = new Map();
    const sizeLines = (res.stdout || '').split('\n');
    for (const line of sizeLines) {
      const m = line.match(/after this operation, ([\d.,]+)\s*([kKmMgG]B)/);
      if (m) sizes.set('total', `${m[1]} ${m[2]}`);
    }
    const names = sizeLines
      .map((line) => line.match(/^Remv\s+(\S+)/))
      .filter(Boolean)
      .map((m) => m[1]);
    packages = names.map((name) => ({ name, version: '', size: '' }));
    return { packages, total: sizes.get('total') || '', family: fam, raw: res.stdout.slice(0, 4000) };
  }
  if (fam === 'pacman') {
    const res = await run('pacman', ['-Qdtq'], { timeout: 15000 });
    packages = (res.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, version: '', size: '' }));
    return { packages, family: fam };
  }
  if (fam === 'dnf') {
    const res = await run('dnf', ['-q', 'repoquery', '--unneeded'], { timeout: 45000 });
    packages = (res.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, version: '', size: '' }));
    return { packages, family: fam };
  }
  return { packages: [], family: fam };
}

async function autoremove(onLine) {
  const { packages } = await orphans();
  const names = packages.map((p) => p.name);
  if (!names.length) return { ok: true, removed: 0 };
  const { jobId, handle } = startJob('autoremove', names, onLine);
  const code = await handle.promise;
  installedCache = { at: 0, data: null };
  return { ok: code === 0, code, jobId, count: names.length };
}

/* --------------------------------- Flatpak --------------------------------- */

async function flatpakList() {
  if (isDemo() || !distro.tools().flatpak) return { available: false, apps: [] };
  const res = await run('flatpak', ['list', '--app', '--columns=application,name,version,branch'], { timeout: 20000 });
  const apps = (res.stdout || '')
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cols) => cols[0])
    .map((cols) => ({ id: cols[0], name: cols[1] || cols[0], version: cols[2] || '', branch: cols[3] || '' }));
  return { available: true, apps };
}

async function flatpakInstall(appId, onLine) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(appId))) return { ok: false, error: '非法的 Flatpak ID' };
  if (isDemo()) return { ok: true, demo: true };
  if (!distro.tools().flatpak) return { ok: false, error: '系统未安装 Flatpak' };
  const emit = (line, kind) => onLine && onLine({ jobId: 'flatpak', line, stream: kind });
  const handle = stream('flatpak', ['install', '-y', '--noninteractive', 'flathub', appId], emit, { timeout: 0 });
  const code = await handle.promise;
  return { ok: code === 0, code };
}

async function flatpakRemove(appId, onLine) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(appId))) return { ok: false, error: '非法的 Flatpak ID' };
  if (isDemo()) return { ok: true, demo: true };
  const emit = (line, kind) => onLine && onLine({ jobId: 'flatpak', line, stream: kind });
  const handle = stream('flatpak', ['uninstall', '-y', appId], emit, { timeout: 0 });
  const code = await handle.promise;
  return { ok: code === 0, code };
}

module.exports = {
  family,
  isDemo,
  listInstalled,
  installedSet,
  search,
  info,
  install,
  remove,
  updateIndex,
  upgradeAll,
  upgrades,
  orphans,
  autoremove,
  cancelJob,
  flatpakList,
  flatpakInstall,
  flatpakRemove,
  normalizeNames
};