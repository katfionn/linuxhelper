// SPDX-License-Identifier: MPL-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JsonFile, deepMerge } = require('./jsonfile');
const paths = require('./paths');
const { run } = require('./exec');
const distro = require('./distro');
const httpx = require('./httpx');

const PROVIDER_PRESETS = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'cloud',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    docs: 'https://platform.openai.com/api-keys',
    hint: '官方 API，需要海外网络或代理'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 深度求索',
    kind: 'cloud',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    docs: 'https://platform.deepseek.com/api_keys',
    hint: '国内直连，性价比高，推荐新手使用'
  },
  {
    id: 'moonshot',
    name: 'Moonshot 月之暗面',
    kind: 'cloud',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    docs: 'https://platform.moonshot.cn/console/api-keys',
    hint: 'OpenAI 兼容接口'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    kind: 'cloud',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    docs: 'https://open.bigmodel.cn/usercenter/apikeys',
    hint: 'glm-4-flash 有免费额度'
  },
  {
    id: 'dashscope',
    name: '阿里云百炼通义千问',
    kind: 'cloud',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    docs: 'https://bailian.console.aliyun.com/',
    hint: 'OpenAI 兼容模式'
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    kind: 'cloud',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    docs: 'https://cloud.siliconflow.cn/account/ak',
    hint: '聚合多种开源模型'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'cloud',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    docs: 'https://openrouter.ai/keys',
    hint: '一个 Key 访问多家模型'
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    docs: 'https://ollama.com',
    hint: '本地运行，数据不出电脑'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio（本地）',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    docs: 'https://lmstudio.ai',
    hint: '在 LM Studio 中开启本地服务器'
  },
  {
    id: 'vllm',
    name: 'vLLM（本地）',
    kind: 'local',
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    docs: 'https://docs.vllm.ai',
    hint: '高性能推理引擎，可在应用内一键部署'
  },
  {
    id: 'custom',
    name: '自定义 OpenAI 兼容接口',
    kind: 'cloud',
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'model-name',
    docs: '',
    hint: '任何兼容 /chat/completions 的服务'
  }
];

const DEFAULTS = {
  general: {
    theme: 'dark',
    zoom: 1,
    autostart: false,
    closeToTray: true,
    dailyTip: true,
    notifications: false,
    proxy: { enabled: false, url: 'http://127.0.0.1:7890' }
  },
  ai: {
    activeProviderId: 'deepseek',
    providers: PROVIDER_PRESETS,
    temperature: 0.4,
    maxTokens: 1500,
    toolsEnabled: true,
    stream: true,
    systemPrompt: ''
  },
  store: {
    autoUpdateIndex: false,
    allowDocker: true
  },
  meta: {
    firstRun: true,
    installedAt: new Date().toISOString()
  }
};

const settingsFile = new JsonFile(paths.files.settings, DEFAULTS);
const secretsFile = new JsonFile(paths.files.secrets, { providers: {} }, { mode: 0o600 });

function sanitizeString(value, max = 400) {
  return String(value == null ? '' : value).slice(0, max);
}

function normalizeProvider(input, fallback) {
  const base = fallback || {};
  const baseUrl = sanitizeString(input.baseUrl || base.baseUrl, 500).replace(/\/+$/, '');
  if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new Error('接口地址必须以 http:// 或 https:// 开头');
  }
  return {
    id: sanitizeString(input.id || base.id, 60).replace(/[^a-z0-9-_]/gi, ''),
    name: sanitizeString(input.name || base.name, 80),
    kind: input.kind === 'local' || base.kind === 'local' ? 'local' : 'cloud',
    baseUrl,
    model: sanitizeString(input.model || base.model, 160),
    docs: sanitizeString(input.docs || base.docs, 300),
    hint: sanitizeString(input.hint || base.hint, 200)
  };
}

function publicSettings() {
  const data = settingsFile.get();
  const secrets = secretsFile.get();
  return {
    ...data,
    ai: {
      ...data.ai,
      providers: (data.ai.providers || []).map(({ apiKey, ...p }) => ({
        ...p,
        hasKey: Boolean(secrets.providers && secrets.providers[p.id]),
        apiKeyMasked: secrets.providers && secrets.providers[p.id] ? '••••••••' : ''
      }))
    },
    paths: { data: paths.dirs.data, cache: paths.dirs.cache, config: paths.dirs.config, logs: paths.dirs.logs }
  };
}

function getProviderSecret(id) {
  const secrets = secretsFile.get();
  return (secrets.providers && secrets.providers[id]) || '';
}

function setProviderKey(id, key) {
  const clean = sanitizeString(key, 500).trim();
  const secrets = secretsFile.get();
  secrets.providers = secrets.providers || {};
  if (clean) secrets.providers[id] = clean;
  else delete secrets.providers[id];
  secretsFile.save();
  return publicSettings();
}

function updateGeneral(patch) {
  const allowed = ['theme', 'zoom', 'autostart', 'closeToTray', 'dailyTip', 'notifications', 'proxy'];
  const next = {};
  for (const key of allowed) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
  }
  if (next.theme && !['dark', 'light', 'system'].includes(next.theme)) delete next.theme;
  if (next.zoom != null) next.zoom = Math.min(1.5, Math.max(0.8, Number(next.zoom) || 1));
  if (next.proxy) {
    const url = sanitizeString(next.proxy.url, 300);
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('代理地址格式不正确，例如 http://127.0.0.1:7890');
    next.proxy = { enabled: Boolean(next.proxy.enabled), url };
  }
  const updated = settingsFile.update({ general: next });
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'autostart')) {
    setAutostart(Boolean(updated.general.autostart));
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'proxy')) {
    applyProxySettings(updated.general.proxy);
  }
  return publicSettings();
}

function updateAI(patch) {
  const allowed = ['activeProviderId', 'temperature', 'maxTokens', 'toolsEnabled', 'stream', 'systemPrompt'];
  const next = {};
  for (const key of allowed) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
  }
  if (next.temperature != null) next.temperature = Math.min(2, Math.max(0, Number(next.temperature) || 0));
  if (next.maxTokens != null) next.maxTokens = Math.min(16000, Math.max(128, Number(next.maxTokens) || 1500));
  if (next.systemPrompt != null) next.systemPrompt = sanitizeString(next.systemPrompt, 4000);
  if (patch && Array.isArray(patch.providers)) {
    const current = settingsFile.get().ai.providers || [];
    next.providers = patch.providers.map((item, index) =>
      normalizeProvider(item, current.find((p) => p.id === item.id) || PROVIDER_PRESETS[index] || PROVIDER_PRESETS[0])
    );
  }
  return publicSettingsFrom(settingsFile.update({ ai: next }));
}

function publicSettingsFrom(data) {
  const secrets = secretsFile.get();
  return {
    ...data,
    ai: {
      ...data.ai,
      providers: (data.ai.providers || []).map(({ apiKey, ...p }) => ({
        ...p,
        hasKey: Boolean(secrets.providers && secrets.providers[p.id]),
        apiKeyMasked: secrets.providers && secrets.providers[p.id] ? '••••••••' : ''
      }))
    },
    paths: { data: paths.dirs.data, cache: paths.dirs.cache, config: paths.dirs.config, logs: paths.dirs.logs }
  };
}

async function applyProxySettings(proxy) {
  const url = proxy && proxy.enabled ? proxy.url : '';
  return httpx.applyProxy(url);
}

function activeProvider() {
  const data = settingsFile.get();
  const list = data.ai.providers || [];
  const provider = list.find((p) => p.id === data.ai.activeProviderId) || list[0];
  return { ...provider, apiKey: getProviderSecret(provider.id) };
}

function autostartPath() {
  return path.join(paths.configDir, 'autostart', 'linux-helper.desktop');
}

function setAutostart(enabled) {
  if (!paths.isLinux) return { ok: false, reason: '仅 Linux 支持开机自启' };
  const file = autostartPath();
  try {
    if (!enabled) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { ok: true, enabled: false };
    }
    const exec = process.env.APPIMAGE || process.execPath;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `[Desktop Entry]
Type=Application
Name=Linux Helper
Name[zh_CN]=Linux 使用助手
Comment=Linux 桌面 AI 使用助手
Exec="${exec}" --hidden
Icon=linux-helper
Terminal=false
Categories=Utility;System;
X-GNOME-Autostart-enabled=true
`,
      'utf8'
    );
    return { ok: true, enabled: true, path: file };
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
}

function autostartEnabled() {
  return paths.isLinux && fs.existsSync(autostartPath());
}

function reset() {
  settingsFile.set(JSON.parse(JSON.stringify(DEFAULTS)));
  secretsFile.set({ providers: {} });
  return publicSettings();
}

async function dataDirUsage() {
  const { duBytes } = require('./exec');
  return {
    data: duBytes(paths.dirs.data) || 0,
    cache: duBytes(paths.dirs.cache) || 0,
    log: duBytes(paths.dirs.logs) || 0
  };
}

module.exports = {
  PROVIDER_PRESETS,
  publicSettings,
  updateGeneral,
  updateAI,
  setProviderKey,
  getProviderSecret,
  activeProvider,
  applyProxySettings,
  setAutostart,
  autostartEnabled,
  reset,
  dataDirUsage,
  DEFAULT_PROVIDERS: PROVIDER_PRESETS
};