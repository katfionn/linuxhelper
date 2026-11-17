// SPDX-License-Identifier: MPL-2.0
'use strict';

const os = require('node:os');
const fs = require('node:fs');
const { commandExistsSync, run } = require('./exec');

const APT_IDS = new Set([
  'debian', 'ubuntu', 'linuxmint', 'pop', 'kali', 'raspbian', 'elementary', 'zorin', 'deepin',
  'neon', 'devuan', 'mx', 'mxlinux', 'parrot', 'trisquel', 'pureos', 'ubuntu-core', 'linuxmint'
]);
const PACMAN_IDS = new Set(['arch', 'manjaro', 'endeavouros', 'garuda', 'artix', 'cachyos', 'arcolinux', 'archarm']);
const DNF_IDS = new Set(['fedora', 'rhel', 'centos', 'rocky', 'almalinux', 'alma', 'nobara', 'bazzite', 'ol']);
const ZYPPER_IDS = new Set(['opensuse', 'opensuse-tumbleweed', 'opensuse-leap', 'suse', 'sles', 'sled']);
const APK_IDS = new Set(['alpine', 'postmarketos']);

const FAMILY_LABEL = {
  apt: 'APT · Debian / Ubuntu 系',
  pacman: 'Pacman · Arch 系',
  dnf: 'DNF · Fedora / RHEL 系',
  zypper: 'Zypper · openSUSE 系',
  apk: 'APK · Alpine 系',
  unknown: '未知包管理器'
};

function parseOsRelease(text) {
  const out = {};
  for (const raw of String(text).split('\n')) {
    const m = raw.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function familyFromId(id, idLike) {
  const tokens = [id, ...String(idLike || '').split(/\s+/)]
    .map((s) => String(s || '').toLowerCase())
    .filter(Boolean);
  for (const token of tokens) {
    if (APT_IDS.has(token)) return 'apt';
    if (PACMAN_IDS.has(token)) return 'pacman';
    if (DNF_IDS.has(token)) return 'dnf';
    if (ZYPPER_IDS.has(token)) return 'zypper';
    if (APK_IDS.has(token)) return 'apk';
  }
  return 'unknown';
}

const DESKTOP_NAMES = {
  gnome: 'GNOME',
  ubuntu: 'GNOME (Ubuntu)',
  kde: 'KDE Plasma',
  xfce: 'Xfce',
  cinnamon: 'Cinnamon',
  mate: 'MATE',
  lxqt: 'LXQt',
  lxde: 'LXDE',
  budgie: 'Budgie',
  pantheon: 'Pantheon',
  deepin: 'Deepin DE',
  sway: 'Sway',
  hyprland: 'Hyprland',
  i3: 'i3',
  cosmic: 'COSMIC',
  unity: 'Unity'
};

function desktopLabel(raw, session) {
  if (!raw) return session === 'wayland' ? 'Wayland 会话' : session === 'x11' ? 'X11 会话' : '未知桌面';
  const last = String(raw).toLowerCase().split(':').pop();
  const token = last.split('-')[0];
  return DESKTOP_NAMES[token] || last;
}

function readOsRelease() {
  for (const file of ['/etc/os-release', '/usr/lib/os-release']) {
    try {
      return parseOsRelease(fs.readFileSync(file, 'utf8'));
    } catch {
      /* try next */
    }
  }
  return {};
}

let cachedSync = null;

/** 同步基础信息（不探测外部命令），用于启动早期与协同模块。 */
function infoSync() {
  if (cachedSync) return cachedSync;
  if (process.platform !== 'linux') {
    cachedSync = {
      isLinux: false,
      demo: true,
      id: 'demo',
      name: 'Demo',
      prettyName: 'Linux 预览模式（当前不是 Linux）',
      versionId: '',
      family: 'apt',
      familyLabel: FAMILY_LABEL.apt,
      desktop: 'GNOME (预览)',
      desktopRaw: 'gnome',
      session: 'x11',
      kernel: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      kernelName: 'Linux (模拟)'
    };
    return cachedSync;
  }
  const rel = readOsRelease();
  const id = (rel.ID || '').toLowerCase();
  const family = familyFromId(id, rel.ID_LIKE);
  cachedSync = {
    isLinux: true,
    demo: false,
    id: id || 'linux',
    name: rel.NAME || id || 'Linux',
    prettyName: rel.PRETTY_NAME || rel.NAME || 'Linux',
    versionId: rel.VERSION_ID || rel.BUILD_ID || '',
    family,
    familyLabel: FAMILY_LABEL[family] || FAMILY_LABEL.unknown,
    desktopRaw: process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '',
    desktop: desktopLabel(process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION, process.env.XDG_SESSION_TYPE),
    session: process.env.XDG_SESSION_TYPE || '',
    kernel: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    kernelName: 'Linux'
  };
  return cachedSync;
}

function tools() {
  return {
    pkexec: commandExistsSync('pkexec'),
    flatpak: commandExistsSync('flatpak'),
    snap: commandExistsSync('snap'),
    docker: commandExistsSync('docker'),
    git: commandExistsSync('git'),
    fd: commandExistsSync('fd') || commandExistsSync('fdfind'),
    locate: commandExistsSync('locate'),
    python3: commandExistsSync('python3'),
    curl: commandExistsSync('curl'),
    unzip: commandExistsSync('unzip'),
    ollama: commandExistsSync('ollama'),
    gsettings: commandExistsSync('gsettings'),
    plasma: commandExistsSync('plasmashell'),
    xfconf: commandExistsSync('xfconf-query')
  };
}

async function stats() {
  const info = infoSync();
  if (!info.isLinux) {
    return {
      demo: true,
      cpu: os.cpus()[0]?.model?.trim() || 'CPU',
      cores: os.cpus().length,
      memTotal: os.totalmem(),
      memUsed: os.totalmem() - os.freemem(),
      diskTotal: 512 * 1024 ** 3,
      diskFree: 268 * 1024 ** 3,
      uptime: os.uptime(),
      load: os.loadavg(),
      hostname: os.hostname()
    };
  }
  let diskTotal = 0;
  let diskFree = 0;
  try {
    const st = fs.statfsSync('/');
    diskTotal = st.blocks * st.bsize;
    diskFree = st.bavail * st.bsize;
  } catch {
    /* ignore */
  }
  let memTotal = os.totalmem();
  let memUsed = memTotal - os.freemem();
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const total = Number((meminfo.match(/MemTotal:\s+(\d+)/) || [])[1]) * 1024;
    const avail = Number((meminfo.match(/MemAvailable:\s+(\d+)/) || [])[1]) * 1024;
    if (total && avail) {
      memTotal = total;
      memUsed = total - avail;
    }
  } catch {
    /* ignore */
  }
  return {
    demo: false,
    cpu: os.cpus()[0]?.model?.trim() || 'CPU',
    cores: os.cpus().length,
    memTotal,
    memUsed,
    diskTotal,
    diskFree,
    uptime: os.uptime(),
    load: os.loadavg(),
    hostname: os.hostname()
  };
}

async function packageManagerVersion() {
  const info = infoSync();
  const cmd = { apt: 'apt-get', pacman: 'pacman', dnf: 'dnf', zypper: 'zypper', apk: 'apk' }[info.family];
  if (!cmd) return '';
  const res = await run(cmd, ['--version'], { timeout: 5000 });
  return res.ok ? (res.stdout.split('\n')[0] || '').trim() : '';
}

async function summary() {
  const info = infoSync();
  return { ...info, tools: tools(), pmVersion: await packageManagerVersion() };
}

module.exports = { infoSync, stats, summary, tools, familyFromId, parseOsRelease, FAMILY_LABEL };