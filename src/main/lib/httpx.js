// SPDX-License-Identifier: MPL-2.0
'use strict';

// electron 只在真正发请求时才加载：纯 Node 环境（单元测试）不该触发它的二进制懒下载。
let electronApi = null;
function getElectron() {
  if (!electronApi) electronApi = require('electron');
  return electronApi;
}

const MAX_BODY = 6 * 1024 * 1024;

async function applyProxy(url) {
  const { session } = getElectron();
  const target = session.defaultSession;
  try {
    if (url) {
      await target.setProxy({ proxyRules: url, proxyBypassRules: '<local>' });
    } else {
      await target.setProxy({ mode: 'system' });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 通过 Electron net 发起请求：走系统/自定义代理，不受 CORS 限制。
 */
async function request(url, options = {}) {
  const { method = 'GET', headers = {}, body, timeout = 45000, signal } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    const { net } = getElectron();
    const res = await net.fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: 'no-store'
    });
    return res;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

async function fetchJson(url, options = {}) {
  const res = await request(url, {
    ...options,
    headers: { Accept: 'application/json', 'User-Agent': 'LinuxHelper/0.1', ...(options.headers || {}) }
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, body: text.slice(0, 2000) };
  }
  if (text.length > MAX_BODY) return { ok: false, status: res.status, error: '响应内容过大' };
  try {
    return { ok: true, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, error: '响应不是合法 JSON', body: text.slice(0, 500) };
  }
}

module.exports = { applyProxy, request, fetchJson };
