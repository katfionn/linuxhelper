#!/usr/bin/env node
/**
 * Electron 冒烟测试：真实启动应用，逐个打开所有页面，检查：
 *   - 每个页面都能渲染出内容（无「页面加载失败」横幅）
 *   - 渲染进程无 console.error / warning
 *   - 设置读写链路可用
 *
 * 用法：npm run smoke
 * Linux CI 无显示环境可配合 xvfb-run：xvfb-run -a npm run smoke
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(mkdtempSync(join(tmpdir(), 'lh-smoke-')), 'result.json');

const args = [root, '--no-sandbox', '--disable-gpu'];
const child = spawn(electronPath, args, {
  cwd: root,
  env: { ...process.env, LH_SMOKE: '1', LH_SMOKE_OUT: outFile, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => {
  stdout += d;
});
child.stderr.on('data', (d) => {
  stderr += d;
});

const timer = setTimeout(() => {
  console.error('冒烟测试超时（90s），强制结束');
  child.kill('SIGKILL');
}, 90_000);

child.on('exit', (code) => {
  clearTimeout(timer);
  let result = null;
  if (existsSync(outFile)) {
    try {
      result = JSON.parse(readFileSync(outFile, 'utf8'));
    } catch {
      /* ignore */
    }
  }
  if (result) {
    for (const [route, info] of Object.entries(result.routes)) {
      const ok = !info.errored && info.chars >= 40;
      console.log(`${ok ? '✓' : '✗'} ${route.padEnd(12)} ${String(info.chars).padStart(5)} 字符${info.banners.length ? '  banner: ' + info.banners.join(' | ') : ''}`);
    }
    console.log(`${result.settingsOk ? '✓' : '✗'} settings    设置读写链路`);
    if (result.errors.length) {
      console.log('\n渲染进程告警/错误：');
      result.errors.forEach((e) => console.log('  - ' + e));
    }
    if (result.fatal) console.log('\nfatal: ' + result.fatal);
  } else {
    console.log('未拿到冒烟测试结果，退出码：' + code);
    console.log(stdout.slice(-3000));
    console.log(stderr.slice(-3000));
  }
  try {
    rmSync(dirname(outFile), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const passed = Boolean(result && result.ok && result.errors.length === 0);
  console.log(passed ? '\n冒烟测试通过。' : '\n冒烟测试失败。');
  process.exit(passed ? 0 : 1);
});