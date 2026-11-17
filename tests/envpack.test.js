// SPDX-License-Identifier: MPL-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'tools', 'envpack.mjs');

function envFor(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_CONFIG_HOME: path.join(home, '.config')
  };
}

function run(home, args) {
  return spawnSync(process.execPath, [tool, ...args], {
    cwd: root,
    env: envFor(home),
    encoding: 'utf8'
  });
}

test('envpack status/pack/purge 在隔离家目录内工作', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'linux-helper-envpack-'));
  const isLinux = process.platform === 'linux';
  const dataDir = isLinux ? path.join(home, '.local', 'share', 'linux-assistant') : path.join(home, '.linux-assistant');
  const cacheDir = isLinux ? path.join(home, '.cache', 'linux-assistant') : path.join(home, '.linux-assistant-cache');
  const configDir = isLinux ? path.join(home, '.config', 'linux-assistant') : path.join(home, '.linux-assistant-config');
  t.after(() => rmSync(home, { recursive: true, force: true }));

  for (const dir of [dataDir, cacheDir, configDir]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'marker.txt'), dir, 'utf8');
  }
  writeFileSync(path.join(dataDir, 'settings.json'), '{"theme":"dark"}', 'utf8');

  const status = run(home, ['status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /LinuxHelper 环境状态/);
  assert.match(status.stdout, /设置文件/);

  const backup = path.join(home, 'backup.tar.gz');
  const packed = run(home, ['pack', '--out', backup]);
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  assert.ok(existsSync(backup));
  assert.ok(existsSync(`${backup}.manifest.json`));

  const listing = spawnSync('tar', [...(process.platform === 'win32' ? ['--force-local'] : []), '-tzf', backup], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /linux-assistant\/settings\.json|\.linux-assistant\/settings\.json/);

  const dry = run(home, ['purge', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /未删除任何文件/);
  assert.ok(existsSync(dataDir) && existsSync(cacheDir) && existsSync(configDir));

  const purged = run(home, ['purge', '--yes', '--keep-config']);
  assert.equal(purged.status, 0, purged.stderr);
  assert.equal(existsSync(dataDir), false);
  assert.equal(existsSync(cacheDir), false);
  assert.equal(existsSync(configDir), true, '--keep-config 应保留配置目录');
});

test('envpack 拒绝把家目录之外的路径当作备份目标', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'linux-helper-envpack-'));
  mkdirSync(path.join(home, '.linux-assistant'), { recursive: true });
  writeFileSync(path.join(home, '.linux-assistant', 'settings.json'), '{}', 'utf8');
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const outside = path.join(tmpdir(), 'linux-helper-should-not-exist.tar.gz');
  const result = run(home, ['pack', '--out', outside]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /拒绝操作家目录之外的路径/);
  assert.equal(existsSync(outside), false);
});