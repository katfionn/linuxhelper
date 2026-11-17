// SPDX-License-Identifier: MPL-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JsonFile } = require('./jsonfile');
const paths = require('./paths');
const pkgs = require('./pkgs');
const httpx = require('./httpx');
const distro = require('./distro');
const { run, stream, commandExistsSync } = require('./exec');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');

function loadBundled(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch (err) {
    return { apps: [], items: [], error: String(err.message || err) };
  }
}

const appsData = loadBundled('apps.json');
const personalData = loadBundled('personalization.json');

const BUILTIN_SOURCE = {
  id: 'builtin',
  name: '内置应用源',
  url: '',
  type: 'builtin',
  enabled: true,
  builtin: true,
  description: '随应用打包的精选软件，离线可用'
};

const sourcesFile = new JsonFile(paths.files.sources, { sources: [BUILTIN_SOURCE], updatedAt: null });

/* ------------------------------- 应用源管理 ------------------------------- */

function slug(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function validateSource(raw) {
  const name = String(raw.name || '').trim().slice(0, 60);
  const url = String(raw.url || '').trim().slice(0, 500);
  if (!name) throw new Error('请填写应用源名称');
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('应用源地址必须以 http:// 或 https:// 开头');
  if (!/\.(json|JSON)(\?.*)?$/.test(url) && !url.includes('json')) {
    // 允许无扩展名的 API 地址，仅做提示不拦截
  }
  const id = raw.id && raw.id !== 'builtin' ? raw.id : `src-${slug(name) || 'source'}-${Math.random().toString(36).slice(2, 6)}`;
  return { id, name, url, type: 'json', enabled: raw.enabled !== false, builtin: false, description: String(raw.description || '').slice(0, 200) };
}

function listSources() {
  const { sources } = sourcesFile.get();
  return [BUILTIN_SOURCE, ...(sources || []).filter((s) => s.id !== 'builtin')];
}

function saveSources(list) {
  if (!Array.isArray(list)) throw new Error('应用源列表格式错误');
  if (list.length > 20) throw new Error('最多支持 20 个扩展源');
  const cleaned = list.filter((s) => s && s.id !== 'builtin' && !s.builtin).map(validateSource);
  const ids = new Set();
  for (const source of cleaned) {
    if (ids.has(source.id)) source.id = `${source.id}-${Math.random().toString(36).slice(2, 5)}`;
    ids.add(source.id);
  }
  sourcesFile.set({ sources: [BUILTIN_SOURCE, ...cleaned], updatedAt: new Date().toISOString() });
  return listSources();
}

function cacheFile(sourceId) {
  return path.join(paths.dirs.sources, `${slug(sourceId)}.json`);
}

function readSourceCache(sourceId, maxAgeMs) {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(sourceId), 'utf8'));
    if (maxAgeMs && Date.now() - raw.at > maxAgeMs) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeSourceCache(sourceId, payload) {
  try {
    fs.writeFileSync(cacheFile(sourceId), JSON.stringify({ at: Date.now(), payload }), 'utf8');
  } catch {
    /* cache is best effort */
  }
}

function normalizeCasaOsApp(app, source) {
  const name = String(app.title || app.name || '未命名应用').slice(0, 80);
  const portMap = String(app.port_map || app.ports || '').split(/[,;]\s*/).filter(Boolean);
  const volumeMap = String(app.volume_map || app.volumes || '').split(/[,;]\s*/).filter(Boolean);
  const envs = Array.isArray(app.envs)
    ? app.envs.map((e) => ({ name: String(e.name || e.key || ''), value: String(e.default ?? e.value ?? '') })).filter((e) => e.name)
    : [];
  return {
    id: `${source.id}:${slug(name)}`,
    name,
    summary: String(app.tagline || app.description || app.tips || '来自扩展源的应用').slice(0, 160),
    description: String(app.description || '').slice(0, 4000),
    category: String(app.category || '扩展应用').slice(0, 40),
    iconUrl: /^https?:\/\//i.test(String(app.icon || '')) ? String(app.icon) : '',
    icon: /^https?:\/\//i.test(String(app.icon || '')) ? '📦' : String(app.icon || '📦').slice(0, 4),
    version: String(app.version || '').slice(0, 40),
    author: String(app.author || '').slice(0, 80),
    homepage: /^https?:\/\//i.test(String(app.repo || app.homepage || '')) ? String(app.repo || app.homepage) : '',
    kind: 'docker',
    install: {
      dockerImage: String(app.image || '').slice(0, 200),
      ports: portMap,
      volumes: volumeMap,
      envs
    },
    sourceId: source.id,
    sourceName: source.name,
    sourceType: 'remote'
  };
}

function normalizeOwnApp(app, source) {
  return {
    ...app,
    id: `${source.id}:${app.id || slug(app.name)}`,
    kind: app.kind || 'package',
    summary: String(app.summary || '').slice(0, 160),
    description: String(app.description || app.summary || '').slice(0, 4000),
    category: String(app.category || '常用软件').slice(0, 40),
    icon: String(app.icon || '📦').slice(0, 4),
    sourceId: source.id,
    sourceName: source.name,
    sourceType: 'remote'
  };
}

async function fetchRemote(source, force = false) {
  const cached = force ? null : readSourceCache(source.id, 6 * 3600 * 1000);
  if (cached) return { ok: true, cached: true, apps: cached.payload, sourceId: source.id };
  const res = await httpx.fetchJson(source.url, { timeout: 25000, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(res.error || '拉取失败');
  const data = res.data;
  let apps = [];
  if (data && Array.isArray(data.apps)) {
    const looksCasaOs = data.apps.some((a) => a && (a.image || a.port_map || a.volume_map));
    apps = data.apps.map((app) => (looksCasaOs ? normalizeCasaOsApp(app, source) : normalizeOwnApp(app, source)));
  } else if (Array.isArray(data)) {
    apps = data.map((app) => normalizeOwnApp(app, source));
  } else if (data && data.schema === 'linux-helper-store/v1' && Array.isArray(data.items)) {
    apps = data.items.map((app) => normalizeOwnApp(app, source));
  } else {
    throw new Error('无法识别的应用源格式（支持 LinuxHelper v1 与 CasaOS 格式）');
  }
  writeSourceCache(source.id, apps);
  return { ok: true, cached: false, apps, sourceId: source.id, sourceName: source.name, count: apps.length };
}

async function remoteApps(force = false) {
  const enabled = listSources().filter((s) => s.enabled && !s.builtin);
  const results = [];
  for (const source of enabled) {
    try {
      const res = await fetchRemote(source, force);
      for (const app of res.apps) results.push(app);
      results.push({ __sourceInfo: true, id: source.id, name: source.name, count: res.apps.length, ok: true });
    } catch (err) {
      results.push({ __sourceInfo: true, id: source.id, name: source.name, count: 0, ok: false, error: String(err.message || err) });
    }
  }
  return results;
}

async function testSource(source) {
  const candidate = validateSource(source);
  const res = await fetchRemote(candidate, true);
  return { ok: true, count: res.apps.length, sample: res.apps.slice(0, 3).map((a) => a.name) };
}

/* ------------------------------- 内置应用库 ------------------------------- */

function builtinApps() {
  return (appsData.apps || []).map((app) => ({ ...app, kind: 'package', sourceId: 'builtin', sourceName: '内置应用源', sourceType: 'builtin' }));
}

async function installedState() {
  const { packages, demo } = await pkgs.listInstalled();
  const names = new Set(packages.map((p) => p.name.toLowerCase()));
  const flat = await pkgs.flatpakList();
  const flatIds = new Set((flat.apps || []).map((a) => a.id.toLowerCase()));
  return { names, flatIds, flatAvailable: flat.available, demo, family: pkgs.family() };
}

function appInstalled(app, state) {
  if (app.kind === 'docker') return false;
  const familyKey = { apt: 'apt', pacman: 'pacman', dnf: 'dnf', zypper: 'zypper', apk: 'apk' }[state.family];
  if (app.install && familyKey && app.install[familyKey] && state.names.has(String(app.install[familyKey]).toLowerCase())) return true;
  if (app.install && app.install.flatpak && state.flatIds.has(String(app.install.flatpak).toLowerCase())) return true;
  if (app.install && app.install.package && state.names.has(String(app.install.package).toLowerCase())) return true;
  return false;
}

/* --------------------------------- 安装 --------------------------------- */

function resolvePackageName(app, family) {
  const spec = app.install || {};
  return spec[family] || spec.package || '';
}

async function installApp(app, onLine) {
  if (!app || !app.id) return { ok: false, error: '应用信息缺失' };
  if (app.kind === 'docker') return installDockerApp(app, onLine);
  const fam = pkgs.family();
  const pkgName = resolvePackageName(app, fam);
  const emit = (line, kind) => onLine && onLine({ jobId: `app-${app.id}`, line, stream: kind });
  if (app.install && app.install.flatpak && !pkgName) {
    return pkgs.flatpakInstall(app.install.flatpak, emit);
  }
  if (!pkgName && app.install && app.install.flatpak) {
    const installed = await installedState();
    if (!installed.names.has(app.install.flatpak)) return pkgs.flatpakInstall(app.install.flatpak, emit);
  }
  if (!pkgName) return { ok: false, error: `当前系统（${fam}）没有为该应用配置安装源` };
  return pkgs.install([pkgName], emit);
}

async function uninstallApp(app, onLine) {
  if (!app || !app.id) return { ok: false, error: '应用信息缺失' };
  if (app.kind === 'docker') return removeDockerApp(app, onLine);
  const fam = pkgs.family();
  const pkgName = resolvePackageName(app, fam);
  const emit = (line, kind) => onLine && onLine({ jobId: `app-${app.id}`, line, stream: kind });
  if (app.install && app.install.flatpak) {
    const state = await installedState();
    if (state.flatIds.has(String(app.install.flatpak).toLowerCase())) return pkgs.flatpakRemove(app.install.flatpak, emit);
  }
  if (!pkgName) return { ok: false, error: '未找到对应的软件包' };
  return pkgs.remove([pkgName], emit);
}

/* --------------------------------- Docker --------------------------------- */

function safeToken(value, max = 200) {
  return String(value || '').replace(/[^\w./:@-]/g, '').slice(0, max);
}

function buildCompose(app) {
  const image = safeToken(app.install.dockerImage, 200);
  if (!/^[A-Za-z0-9][\w./:@-]*$/.test(image)) throw new Error('扩展源中的应用镜像名不合法');
  const name = `lh-${slug(app.name)}`.slice(0, 50);
  const ports = (app.install.ports || []).filter((p) => /^\d{1,5}:\d{1,5}(\/(tcp|udp))?$/.test(p));
  const volumes = (app.install.volumes || []).filter((v) => /^[^\n:]+:[^\n:]+(:ro|:rw)?$/.test(v));
  const envs = (app.install.envs || []).filter((e) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(e.name));
  const lines = ['services:', `  ${name}:`, `    image: ${image}`, `    container_name: ${name}`, '    restart: unless-stopped'];
  if (ports.length) {
    lines.push('    ports:');
    for (const p of ports) lines.push(`      - "${p}"`);
  }
  if (volumes.length) {
    lines.push('    volumes:');
    for (const v of volumes) lines.push(`      - "${v.replace(/"/g, '')}"`);
  }
  if (envs.length) {
    lines.push('    environment:');
    for (const e of envs) lines.push(`      ${e.name}: "${String(e.value).replace(/"/g, '')}"`);
  }
  return { yaml: `${lines.join('\n')}\n`, name };
}

async function installDockerApp(app, onLine) {
  const emit = (line, kind) => onLine && onLine({ jobId: `docker-${app.id}`, line, stream: kind });
  if (pkgs.isDemo()) {
    emit('[演示模式] 将生成 docker-compose.yml 并执行 docker compose up -d', 'out');
    return { ok: true, demo: true };
  }
  if (!commandExistsSync('docker')) {
    return { ok: false, error: '未安装 Docker。请先在应用市场安装 Docker，并确保当前用户在 docker 用户组中。' };
  }
  let compose;
  try {
    compose = buildCompose(app);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
  const dir = path.join(paths.dirs.docker, slug(app.id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), compose.yaml, 'utf8');
  emit(`已生成 compose 文件：${path.join(dir, 'docker-compose.yml')}`, 'out');
  const hasPlugin = commandExistsSync('docker-compose') ? false : true;
  const cmd = hasPlugin ? ['docker', ['compose', '-f', path.join(dir, 'docker-compose.yml'), 'up', '-d']] : ['docker-compose', ['-f', path.join(dir, 'docker-compose.yml'), 'up', '-d']];
  const code = await stream(cmd[0], cmd[1], emit, { timeout: 0, cwd: dir }).promise;
  if (code !== 0) return { ok: false, error: 'Docker 启动失败，请检查输出日志（可能需要将用户加入 docker 组）' };
  return { ok: true };
}

async function removeDockerApp(app, onLine) {
  const emit = (line, kind) => onLine && onLine({ jobId: `docker-${app.id}`, line, stream: kind });
  if (pkgs.isDemo()) return { ok: true, demo: true };
  const dir = path.join(paths.dirs.docker, slug(app.id));
  if (!fs.existsSync(path.join(dir, 'docker-compose.yml'))) return { ok: false, error: '未找到该应用的部署记录' };
  const hasComposePlugin = commandExistsSync('docker');
  const cmd = hasComposePlugin
    ? ['docker', ['compose', '-f', path.join(dir, 'docker-compose.yml'), 'down']]
    : ['docker-compose', ['-f', path.join(dir, 'docker-compose.yml'), 'down']];
  const code = await stream(cmd[0], cmd[1], emit, { timeout: 120000 }).promise;
  if (code === 0) fs.rmSync(dir, { recursive: true, force: true });
  return { ok: code === 0 };
}

/* ------------------------------- 个性化市场 ------------------------------- */

function desktopKey() {
  const raw = String(process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase();
  if (raw.includes('kde') || raw.includes('plasma')) return 'kde';
  if (raw.includes('xfce')) return 'xfce';
  if (raw.includes('cinnamon')) return 'cinnamon';
  if (raw.includes('mate')) return 'mate';
  if (raw.includes('gnome') || raw.includes('unity') || raw.includes('budgie') || raw.includes('pantheon')) return 'gnome';
  return 'other';
}

async function gs(schema, key) {
  const res = await run('gsettings', ['get', schema, key], { timeout: 5000 });
  return res.ok ? res.stdout.trim().replace(/^'|'$/g, '') : '';
}

async function currentStyle() {
  if (!paths.isLinux) {
    return { demo: true, desktop: 'gnome', theme: 'Adwaita (预览)', icons: 'Papirus (预览)', cursor: 'Adwaita', wallpaper: '' };
  }
  const desktop = desktopKey();
  if (desktop === 'gnome' || desktop === 'cinnamon' || desktop === 'mate') {
    const themeSchema = desktop === 'gnome' ? 'org.gnome.desktop.interface' : desktop === 'cinnamon' ? 'org.cinnamon.desktop.interface' : 'org.mate.interface';
    return {
      demo: false,
      desktop,
      theme: await gs(themeSchema, 'gtk-theme'),
      icons: await gs(themeSchema, 'icon-theme'),
      cursor: await gs(themeSchema, 'cursor-theme')
    };
  }
  if (desktop === 'kde') {
    return { demo: false, desktop, theme: (await run('kreadconfig6', ['--file', 'kdeglobals', '--group', 'KDE', '--key', 'LookAndFeelPackage'], { timeout: 4000 })).stdout.trim() || 'Breeze', icons: '', cursor: '' };
  }
  if (desktop === 'xfce') {
    return {
      demo: false,
      desktop,
      theme: (await run('xfconf-query', ['-c', 'xsettings', '-p', '/Net/ThemeName'], { timeout: 4000 })).stdout.trim(),
      icons: (await run('xfconf-query', ['-c', 'xsettings', '-p', '/Net/IconThemeName'], { timeout: 4000 })).stdout.trim(),
      cursor: (await run('xfconf-query', ['-c', 'xsettings', '-p', '/Gtk/CursorThemeName'], { timeout: 4000 })).stdout.trim()
    };
  }
  return { demo: false, desktop, theme: '', icons: '', cursor: '' };
}

function themeSearchDirs(type) {
  if (type === 'icon' || type === 'cursor') {
    return [path.join(paths.home, '.local', 'share', 'icons'), path.join(paths.home, '.icons'), '/usr/share/icons'];
  }
  return [path.join(paths.home, '.local', 'share', 'themes'), '/usr/share/themes'];
}

function isInstalled(item) {
  if (item.type === 'font') {
    try {
      const { spawnSync } = require('node:child_process');
      const res = spawnSync('fc-list', [':family'], { encoding: 'utf8', timeout: 5000 });
      if (res.status === 0) {
        const needle = String(item.applyValue || item.name).toLowerCase().split(' ')[0];
        return Boolean(needle) && res.stdout.toLowerCase().includes(needle);
      }
    } catch {
      /* ignore */
    }
    return false;
  }
  for (const dir of themeSearchDirs(item.type)) {
    if (fs.existsSync(path.join(dir, item.dirName || item.id))) return true;
  }
  if (item.type === 'wallpaper') {
    return fs.existsSync(path.join(paths.dirs.wallpapers, `${item.id}.svg`));
  }
  return false;
}

function listPersonalization() {
  const items = (personalData.items || []).map((item) => ({ ...item, installed: isInstalled(item) }));
  const groups = ['theme', 'icon', 'cursor', 'font', 'wallpaper'];
  return {
    items,
    groups: groups.map((id) => ({
      id,
      label: { theme: '桌面主题', icon: '图标包', cursor: '鼠标光标', font: '字体', wallpaper: '壁纸' }[id],
      count: items.filter((i) => i.type === id).length
    })),
    desktop: paths.isLinux ? desktopKey() : 'gnome'
  };
}

async function installPersonal(item, onLine) {
  const emit = (line, kind) => onLine && onLine({ jobId: `personal-${item.id}`, line, stream: kind });
  if (pkgs.isDemo()) {
    emit(`[演示模式] 安装 ${item.name}`, 'out');
    return { ok: true, demo: true };
  }
  const spec = item.install || {};
  if (spec.git) {
    if (!commandExistsSync('git')) return { ok: false, error: '需要 git，请先在应用市场安装 Git' };
    const base = (item.type === 'theme' ? paths.dirs.themes : paths.dirs.icons) + path.sep + (item.dirName || item.id);
    fs.mkdirSync(path.dirname(base), { recursive: true });
    if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
    const code = await stream('git', ['clone', '--depth', '1', spec.git, base], emit, { timeout: 0 }).promise;
    return { ok: code === 0, error: code === 0 ? '' : '下载失败，请检查网络或代理设置' };
  }
  if (spec.flatpak) return pkgs.flatpakInstall(spec.flatpak, emit);
  const pkgName = resolvePackageName({ install: spec }, pkgs.family());
  if (pkgName) return pkgs.install([pkgName], emit);
  return { ok: false, error: '该条目没有适用于当前系统的安装方式' };
}

function writeWallpaperSvg(item) {
  const gen = item.generate || { colors: ['#0f2027', '#203a43', '#2c5364'], style: 'mesh' };
  const [c1, c2, c3] = gen.colors;
  let shapes = '';
  if (gen.style === 'grid') {
    shapes = `<defs><pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1"/></pattern></defs><rect width="1920" height="1080" fill="url(#g)"/>`;
  } else {
    shapes = `
      <circle cx="1480" cy="240" r="520" fill="${c2}" opacity="0.55" filter="url(#blur)"/>
      <circle cx="380" cy="860" r="460" fill="${c3}" opacity="0.5" filter="url(#blur)"/>
      <circle cx="980" cy="520" r="320" fill="${c1}" opacity="0.45" filter="url(#blur)"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="0.55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/>
    </linearGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="120"/></filter>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  ${shapes}
  <text x="96" y="1010" font-family="sans-serif" font-size="26" fill="rgba(255,255,255,0.55)">Linux Helper · ${item.name}</text>
</svg>`;
  fs.mkdirSync(paths.dirs.wallpapers, { recursive: true });
  const file = path.join(paths.dirs.wallpapers, `${item.id}.svg`);
  fs.writeFileSync(file, svg, 'utf8');
  return file;
}

async function applyPersonal(item) {
  if (pkgs.isDemo()) return { ok: true, demo: true, message: `演示模式：已模拟应用「${item.name}」` };
  const desktop = desktopKey();
  const value = item.applyValue || item.dirName || item.name;
  const steps = [];
  const push = async (cmd, args) => {
    const res = await run(cmd, args, { timeout: 8000 });
    steps.push({ cmd: [cmd, ...args].join(' '), ok: res.ok, stderr: res.stderr.slice(0, 300) });
    return res.ok;
  };

  if (item.type === 'wallpaper') {
    const file = item.generate ? writeWallpaperSvg(item) : item.file;
    if (!file || !fs.existsSync(file)) return { ok: false, error: '壁纸文件不存在' };
    const uri = `file://${file}`;
    if (desktop === 'gnome') {
      await push('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri', uri]);
      await push('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri]);
      await push('gsettings', ['set', 'org.gnome.desktop.background', 'picture-options', 'zoom']);
    } else if (desktop === 'cinnamon') {
      await push('gsettings', ['set', 'org.cinnamon.desktop.background', 'picture-uri', uri]);
    } else if (desktop === 'mate') {
      await push('gsettings', ['set', 'org.mate.background', 'picture-filename', file]);
    } else if (desktop === 'xfce') {
      const list = await run('xfconf-query', ['-c', 'xfce4-desktop', '-l'], { timeout: 5000 });
      const props = (list.stdout || '').split('\n').filter((p) => p.trim().endsWith('last-image'));
      for (const prop of props) await push('xfconf-query', ['-c', 'xfce4-desktop', '-p', prop.trim(), '-s', file]);
    } else if (desktop === 'kde') {
      const bin = commandExistsSync('plasma-apply-wallpaperimage') ? 'plasma-apply-wallpaperimage' : null;
      if (bin) await push(bin, [file]);
      else steps.push({ cmd: 'kde', ok: false, stderr: '未找到 plasma-apply-wallpaperimage' });
    } else {
      return { ok: false, error: '当前桌面环境不支持自动更换壁纸，壁纸已保存到 ' + file };
    }
    return { ok: steps.some((s) => s.ok), message: '壁纸已应用到桌面', steps, file };
  }

  if (item.type === 'font') {
    const fontValue = item.applyValue || item.name;
    if (desktop === 'gnome' || desktop === 'cinnamon' || desktop === 'mate') {
      const schema = desktop === 'gnome' ? 'org.gnome.desktop.interface' : desktop === 'cinnamon' ? 'org.cinnamon.desktop.interface' : 'org.mate.interface';
      const key = item.fontKind === 'mono' ? 'monospace-font-name' : 'font-name';
      const ok = await push('gsettings', ['set', schema, key, fontValue]);
      return { ok, message: ok ? `字体已设置为 ${fontValue}` : '应用失败', steps };
    }
    return { ok: false, error: `字体已安装，请在系统字体设置中选择「${fontValue}」` };
  }

  if (desktop === 'gnome' || desktop === 'cinnamon' || desktop === 'mate') {
    const schema = desktop === 'gnome' ? 'org.gnome.desktop.interface' : desktop === 'cinnamon' ? 'org.cinnamon.desktop.interface' : 'org.mate.interface';
    const key = item.type === 'theme' ? 'gtk-theme' : item.type === 'icon' ? 'icon-theme' : item.type === 'cursor' ? 'cursor-theme' : '';
    if (!key) return { ok: false, error: '该条目不支持自动应用' };
    const ok = await push('gsettings', ['set', schema, key, value]);
    return { ok, message: ok ? '已应用到桌面，部分应用需重新打开才能生效' : '应用失败', steps };
  }
  if (desktop === 'xfce') {
    const prop = item.type === 'theme' ? '/Net/ThemeName' : item.type === 'icon' ? '/Net/IconThemeName' : '/Gtk/CursorThemeName';
    const ok = await push('xfconf-query', ['-c', 'xsettings', '-p', prop, '-s', value]);
    return { ok, message: ok ? '已应用到 Xfce 桌面' : '应用失败', steps };
  }
  if (desktop === 'kde') {
    if (item.type === 'theme' && commandExistsSync('plasma-apply-desktoptheme')) {
      const ok = await push('plasma-apply-desktoptheme', [value]);
      return { ok, message: ok ? '已应用 Plasma 全局主题' : '应用失败', steps };
    }
    if (item.type === 'icon') {
      const bin = commandExistsSync('kwriteconfig6') ? 'kwriteconfig6' : 'kwriteconfig5';
      const ok = await push(bin, ['--file', 'kdeglobals', '--group', 'Icons', '--key', 'Theme', value]);
      return { ok, message: ok ? '图标主题已写入，重新登录后生效' : '应用失败', steps };
    }
    return { ok: false, error: '当前 KDE 版本暂不支持自动应用该类型' };
  }
  return { ok: false, error: '未识别的桌面环境' };
}

async function uninstallPersonal(item, onLine) {
  const emit = (line, kind) => onLine && onLine({ jobId: `personal-${item.id}`, line, stream: kind });
  if (pkgs.isDemo()) return { ok: true, demo: true };
  if (item.type === 'wallpaper') {
    const file = path.join(paths.dirs.wallpapers, `${item.id}.svg`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  }
  const dir = themeSearchDirs(item.type).find((d) => d.startsWith(paths.home) && fs.existsSync(path.join(d, item.dirName || item.id)));
  if (!dir) return { ok: false, error: '未在当前用户目录中找到该条目（可能由系统包管理器安装）' };
  fs.rmSync(path.join(dir, item.dirName || item.id), { recursive: true, force: true });
  emit('已删除用户目录下的文件', 'out');
  return { ok: true };
}

module.exports = {
  listSources,
  saveSources,
  testSource,
  remoteApps,
  builtinApps,
  installedState,
  installApp,
  uninstallApp,
  installDockerApp,
  removeDockerApp,
  listPersonalization,
  installPersonal,
  uninstallPersonal,
  applyPersonal,
  currentStyle,
  desktopKey,
  isInstalled,
  buildCompose
};