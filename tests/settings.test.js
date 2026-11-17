// SPDX-License-Identifier: MPL-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'settings-child.cjs');

function isolatedHome() {
  return mkdtempSync(path.join(tmpdir(), 'linux-helper-settings-'));
}

function childEnv(home) {
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

function runChild(home, mode) {
  const result = spawnSync(process.execPath, [fixture, mode], {
    cwd: root,
    env: childEnv(home),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('设置读写、校验、密钥掩码与持久化（隔离家目录）', (t) => {
  const home = isolatedHome();
  mkdirSync(path.join(home, 'AppData', 'Roaming'), { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const changed = runChild(home, 'mutate');
  assert.equal(changed.general.theme, 'light');
  assert.equal(changed.general.zoom, 1.5, 'zoom 应被限制到 1.5');
  assert.equal(changed.general.closeToTray, true);

  assert.equal(changed.ai.activeProviderId, 'deepseek');
  assert.equal(changed.ai.temperature, 2, 'temperature 应被限制到 2');
  assert.equal(changed.ai.maxTokens, 16000, 'maxTokens 应被限制到 16000');
  assert.equal(changed.ai.systemPrompt, '  只回答 Linux 问题  ');
  assert.equal(changed.secret, 'sk-test-1234567890');
  assert.equal(changed.active.id, 'deepseek');
  assert.equal(changed.active.hasApiKey, true);

  const deepseek = changed.ai.providers.find((p) => p.id === 'deepseek');
  assert.ok(deepseek);
  assert.equal(deepseek.hasKey, true);
  assert.equal(deepseek.apiKeyMasked, '••••••••');
  assert.equal(Object.prototype.hasOwnProperty.call(deepseek, 'apiKey'), false);

  assert.ok(changed.paths.data.startsWith(home));
  assert.ok(existsSync(path.join(changed.paths.data, 'settings.json')));
  assert.ok(existsSync(path.join(changed.paths.data, 'secrets.json')));

  const reloaded = runChild(home, 'read');
  assert.equal(reloaded.general.theme, 'light');
  assert.equal(reloaded.general.zoom, 1.5);
  assert.equal(reloaded.secret, 'sk-test-1234567890');

  const reset = runChild(home, 'reset');
  assert.equal(reset.general.theme, 'dark');
  assert.equal(reset.secret, '');
  assert.equal(reset.active.hasApiKey, false);

  const secrets = JSON.parse(readFileSync(path.join(changed.paths.data, 'secrets.json'), 'utf8'));
  assert.deepEqual(secrets.providers, {});
});