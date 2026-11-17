// SPDX-License-Identifier: MPL-2.0
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const isLinux = process.platform === 'linux';

function baseEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  // 避免继承开发机的 locale，导致 apt/dpkg 输出无法解析
  if (isLinux) {
    env.LC_ALL = env.LC_ALL || 'C.UTF-8';
    env.LANG = env.LANG || 'C.UTF-8';
  }
  return env;
}

/**
 * 执行命令，永不 reject，超时自动 kill。
 */
function run(cmd, args = [], opts = {}) {
  const { timeout = 30000, cwd, env, maxBuffer = 8 * 1024 * 1024 } = opts;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: baseEnv(env), windowsHide: true });
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(err && err.message ? err.message : err), error: true });
      return;
    }
    const timer =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill('SIGKILL');
            } catch {
              /* ignore */
            }
          }, timeout)
        : null;

    const append = (target, chunk) => {
      const next = target + chunk;
      return next.length > maxBuffer ? next.slice(-maxBuffer) : next;
    };

    child.stdout?.on('data', (d) => (stdout = append(stdout, d.toString())));
    child.stderr?.on('data', (d) => (stderr = append(stderr, d.toString())));

    const finish = (code, error) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({
        ok: !error && code === 0 && !timedOut,
        code,
        stdout,
        stderr,
        timedOut,
        error: Boolean(error),
        message: error || (timedOut ? `命令执行超时 (${timeout}ms)` : '')
      });
    };

    child.on('error', (err) => finish(-1, err.message));
    child.on('close', (code) => finish(code == null ? -1 : code));
  });
}

/**
 * 流式执行，逐行回调，用于安装/构建等长任务。
 */
function stream(cmd, args = [], onLine, opts = {}) {
  const { cwd, env } = opts;
  let child;
  try {
    child = spawn(cmd, args, { cwd, env: baseEnv(env), windowsHide: true });
  } catch (err) {
    onLine(String(err && err.message ? err.message : err), 'error');
    return { promise: Promise.resolve(1), cancel() {}, pid: null };
  }

  let buffer = '';
  const handle = (chunk, kind) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) onLine(line, kind);
    }
  };
  child.stdout?.on('data', (d) => handle(d, 'out'));
  child.stderr?.on('data', (d) => handle(d, 'err'));

  const promise = new Promise((resolve) => {
    child.on('error', (err) => {
      onLine(String(err && err.message ? err.message : err), 'error');
      resolve(1);
    });
    child.on('close', (code) => {
      if (buffer.trim()) onLine(buffer, 'out');
      resolve(code == null ? 1 : code);
    });
  });

  return {
    promise,
    pid: child.pid,
    cancel() {
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, 3000);
      } catch {
        /* ignore */
      }
    }
  };
}

function commandExistsSync(bin) {
  if (process.platform === 'win32') {
    const res = spawnSync('where', [bin], { windowsHide: true });
    return res.status === 0;
  }
  const res = spawnSync('sh', ['-c', `command -v -- ${JSON.stringify(bin)}`], { windowsHide: true });
  return res.status === 0;
}

async function commandExists(bin) {
  return commandExistsSync(bin);
}

function isRoot() {
  return isLinux && typeof process.getuid === 'function' && process.getuid() === 0;
}

/**
 * 需要 root 的操作统一走 polkit（pkexec），避免在 GUI 中卡住等待 sudo 密码。
 * 安装类命令会以非交互模式运行。
 */
function privileged(cmd, args = [], opts = {}) {
  if (!isLinux) {
    return Promise.resolve({ ok: false, code: -1, stdout: '', stderr: '该操作仅在 Linux 上可用', error: true });
  }
  if (isRoot()) return run(cmd, args, opts);
  if (commandExistsSync('pkexec')) {
    return run('pkexec', ['env', 'DEBIAN_FRONTEND=noninteractive', 'DEBCONF_NONINTERACTIVE_SEEN=true', cmd, ...args], opts);
  }
  return Promise.resolve({
    ok: false,
    code: -1,
    stdout: '',
    stderr: '未检测到 pkexec（polkit）。请安装 polkit 或在终端手动执行：sudo ' + [cmd, ...args].join(' '),
    error: true
  });
}

function privilegedStream(cmd, args = [], onLine, opts = {}) {
  if (!isLinux) {
    onLine('该操作仅在 Linux 上可用', 'error');
    return { promise: Promise.resolve(1), cancel() {} };
  }
  if (isRoot()) return stream(cmd, args, onLine, opts);
  if (commandExistsSync('pkexec')) {
    return stream(
      'pkexec',
      ['env', 'DEBIAN_FRONTEND=noninteractive', 'DEBCONF_NONINTERACTIVE_SEEN=true', cmd, ...args],
      onLine,
      opts
    );
  }
  onLine('未检测到 pkexec（polkit），请在终端手动执行：sudo ' + [cmd, ...args].join(' '), 'error');
  return { promise: Promise.resolve(1), cancel() {} };
}

function readText(file, max = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > max) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function duBytes(target) {
  const res = spawnSync('du', ['-sb', '--', target], { windowsHide: true, timeout: 20000 });
  if (res.status !== 0) return null;
  const value = Number.parseInt(String(res.stdout).split(/\s+/)[0], 10);
  return Number.isFinite(value) ? value : null;
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return require('node:os').homedir();
  if (p.startsWith('~/')) return path.join(require('node:os').homedir(), p.slice(2));
  return p;
}

module.exports = {
  run,
  stream,
  privileged,
  privilegedStream,
  commandExists,
  commandExistsSync,
  isRoot,
  readText,
  duBytes,
  expandHome
};