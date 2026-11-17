// SPDX-License-Identifier: MPL-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JsonFile } = require('./jsonfile');
const paths = require('./paths');
const settings = require('./settings');
const pkgs = require('./pkgs');
const catalog = require('./catalog');
const files = require('./files');
const cleanup = require('./cleanup');
const distro = require('./distro');
const httpx = require('./httpx');
const { run, stream, commandExistsSync } = require('./exec');

/* ------------------------------- 对话存储 ------------------------------- */

const conversationFile = new JsonFile(paths.files.conversation, { messages: [], updatedAt: null, title: '' });

function getConversation() {
  return conversationFile.get();
}

function saveConversation(messages) {
  const trimmed = (messages || []).slice(-40).map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : '',
    tool_calls: m.tool_calls || undefined,
    tool_call_id: m.tool_call_id || undefined,
    name: m.name || undefined
  }));
  return conversationFile.set({ messages: trimmed, updatedAt: new Date().toISOString() });
}

function clearConversation() {
  return conversationFile.set({ messages: [], updatedAt: null, title: '' });
}

/* --------------------------------- 工具定义 --------------------------------- */

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_system_info',
      description: '获取当前 Linux 发行版、桌面环境、内存、磁盘、可用的包管理器与工具信息。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_installed_packages',
      description: '列出系统已安装的软件包，可按关键字过滤。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选，按名称过滤' },
          limit: { type: 'number', description: '最多返回多少条，默认 40' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_packages',
      description: '在系统软件源中搜索可安装的软件包。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_package_info',
      description: '查询某个软件包的版本、描述、大小与是否已安装。',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'install_packages',
      description: '安装一个或多个软件包。属于修改系统的操作，必须由用户确认。',
      parameters: {
        type: 'object',
        properties: {
          packages: { type: 'array', items: { type: 'string' }, description: '软件包名列表' },
          reason: { type: 'string', description: '向用户解释为什么要安装' }
        },
        required: ['packages', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_packages',
      description: '卸载一个或多个软件包。属于修改系统的操作，必须由用户确认。',
      parameters: {
        type: 'object',
        properties: {
          packages: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' }
        },
        required: ['packages', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在用户主目录中按文件名查找文件或文件夹。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          dir: { type: 'string', description: '可选，搜索起点目录' },
          kind: { type: 'string', enum: ['any', 'file', 'dir'] }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_disk_usage',
      description: '查看磁盘、内存占用以及本应用数据/缓存占用。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_cleanup_targets',
      description: '列出可清理的缓存目录、软件包缓存与无用依赖（孤儿包）。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clean_cache',
      description: '清理指定的缓存目录（使用 list_cleanup_targets 返回的 id）。属于删除操作，必须由用户确认。',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          orphans: { type: 'boolean', description: '是否同时移除无用依赖' }
        },
        required: ['ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_store_apps',
      description: '列出应用市场中的推荐软件或个性化条目。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选，按名称/分类过滤' },
          scope: { type: 'string', enum: ['apps', 'personalization'], description: '默认 apps' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_desktop_style',
      description: '应用桌面主题、图标包、光标或壁纸（使用 list_store_apps 个性化中的 id）。',
      parameters: {
        type: 'object',
        properties: { itemId: { type: 'string', description: '个性化条目 id，如 theme-arc' } },
        required: ['itemId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: '执行一条 shell 命令用于诊断或高级操作。必须由用户确认，输出会展示给用户。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['command', 'reason']
      }
    }
  }
];

const NEEDS_APPROVAL = new Set(['install_packages', 'remove_packages', 'clean_cache', 'run_shell']);
const RISK_LABEL = {
  install_packages: '将修改系统：安装软件包（需要管理员授权）',
  remove_packages: '将修改系统：卸载软件包（需要管理员授权）',
  clean_cache: '将删除缓存文件，部分内容删除后需要重新下载',
  run_shell: '将执行自定义 shell 命令，请仔细检查命令内容'
};

function toolTitle(tool, args) {
  if (tool === 'install_packages') return `安装 ${(args.packages || []).join(', ')}`;
  if (tool === 'remove_packages') return `卸载 ${(args.packages || []).join(', ')}`;
  if (tool === 'clean_cache') return `清理缓存：${(args.ids || []).join(', ')}`;
  if (tool === 'run_shell') return `执行命令：${String(args.command || '').slice(0, 120)}`;
  return tool;
}

/* ------------------------------- 提供商请求 ------------------------------- */

function isLocalUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(String(url || ''));
}

function buildHeaders(provider) {
  const headers = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  return headers;
}

function endpoint(provider, suffix) {
  const base = String(provider.baseUrl || '').replace(/\/+$/, '');
  return `${base}${suffix}`;
}

function assertProvider(provider) {
  if (!provider || !provider.baseUrl) throw new Error('尚未配置 AI 服务商，请到「设置 → AI 模型」中添加。');
  if (!provider.model) throw new Error('尚未选择模型，请到「设置 → AI 模型」中填写模型名称。');
  if (provider.kind !== 'local' && !provider.apiKey && !isLocalUrl(provider.baseUrl)) {
    const err = new Error('当前服务商还没有填写 API Key');
    err.code = 'MISSING_KEY';
    throw err;
  }
}

async function postChat(provider, body, signal) {
  const res = await httpx.request(endpoint(provider, '/chat/completions'), {
    method: 'POST',
    headers: buildHeaders(provider),
    body: JSON.stringify(body),
    signal,
    timeout: 300000
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const data = JSON.parse(text);
      message = data.error?.message || data.message || message;
    } catch {
      if (text) message += `: ${text.slice(0, 300)}`;
    }
    throw new Error(message);
  }
  return res;
}

async function streamCompletion(provider, body, onDelta, signal) {
  const res = await postChat(provider, { ...body, stream: true }, signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      for (const line of block.split(/\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          /* 忽略不完整的分片 */
        }
      }
    }
  }
  return full;
}

async function typeOut(text, onDelta, signal) {
  const chunkSize = 14;
  for (let i = 0; i < text.length; i += chunkSize) {
    if (signal && signal.aborted) throw Object.assign(new Error('已取消'), { code: 'ABORTED' });
    onDelta(text.slice(i, i + chunkSize));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/* -------------------------------- 工具执行 -------------------------------- */

async function executeTool(name, args, emitProgress) {
  try {
    if (name === 'get_system_info') {
      return { ok: true, info: await distro.summary(), stats: await distro.stats() };
    }
    if (name === 'list_installed_packages') {
      const { packages } = await pkgs.listInstalled();
      const q = String(args.query || '').toLowerCase();
      const list = (q ? packages.filter((p) => p.name.toLowerCase().includes(q)) : packages).slice(0, Math.min(Number(args.limit) || 40, 100));
      return { ok: true, total: packages.length, packages: list };
    }
    if (name === 'search_packages') {
      const res = await pkgs.search(args.query, args.limit);
      return { ok: true, packages: res.packages };
    }
    if (name === 'get_package_info') {
      return await pkgs.info(args.name);
    }
    if (name === 'install_packages') {
      const res = await pkgs.install(args.packages, ({ line }) => emitProgress && emitProgress(line));
      return { ...res, message: res.ok ? '安装完成' : '安装失败，请查看日志' };
    }
    if (name === 'remove_packages') {
      const res = await pkgs.remove(args.packages, ({ line }) => emitProgress && emitProgress(line));
      return { ...res, message: res.ok ? '卸载完成' : '卸载失败，请查看日志' };
    }
    if (name === 'search_files') {
      const res = await files.search({ query: args.query, dir: args.dir, kind: args.kind, limit: 30 });
      return { ok: true, results: (res.results || []).map((r) => ({ path: r.path, isDir: r.isDir, size: r.size })) };
    }
    if (name === 'get_disk_usage') {
      const scan = await cleanup.scan();
      return { ok: true, stats: await distro.stats(), cleanup: { total: scan.total, appData: scan.appData } };
    }
    if (name === 'list_cleanup_targets') {
      const scan = await cleanup.scan();
      return { ok: true, targets: scan.targets.map((t) => ({ id: t.id, label: t.label, size: t.size, desc: t.desc, risk: t.risk })), orphans: scan.orphans };
    }
    if (name === 'clean_cache') {
      const res = await cleanup.clean(args.ids || [], ({ line }) => emitProgress && emitProgress(line));
      let orphans = null;
      if (args.orphans) orphans = await cleanup.cleanOrphans(({ line }) => emitProgress && emitProgress(line));
      return { ...res, orphans, message: `清理完成，释放约 ${(res.freed / 1024 / 1024).toFixed(1)} MB` };
    }
    if (name === 'list_store_apps') {
      const q = String(args.query || '').toLowerCase();
      if (args.scope === 'personalization') {
        const data = catalog.listPersonalization();
        const items = q ? data.items.filter((i) => `${i.name} ${i.description || ''} ${i.type}`.toLowerCase().includes(q)) : data.items;
        return { ok: true, items: items.map((i) => ({ id: i.id, name: i.name, type: i.type, installed: i.installed, description: i.description })) };
      }
      const apps = catalog.builtinApps().filter((a) => !q || `${a.name} ${a.summary} ${a.category}`.toLowerCase().includes(q));
      return { ok: true, apps: apps.slice(0, 40).map((a) => ({ id: a.id, name: a.name, summary: a.summary, category: a.category })) };
    }
    if (name === 'apply_desktop_style') {
      const data = catalog.listPersonalization();
      const item = data.items.find((i) => i.id === args.itemId);
      if (!item) return { ok: false, error: '没有找到该个性化条目' };
      if (!item.installed) {
        const install = await catalog.installPersonal(item, ({ line }) => emitProgress && emitProgress(line));
        if (!install.ok) return { ok: false, error: install.error || '安装失败' };
      }
      return await catalog.applyPersonal(item);
    }
    if (name === 'run_shell') {
      const command = String(args.command || '');
      if (!command.trim()) return { ok: false, error: '命令为空' };
      const res = await run('sh', ['-c', command], { timeout: 90000 });
      return {
        ok: res.ok,
        code: res.code,
        stdout: (res.stdout || '').slice(-4000),
        stderr: (res.stderr || '').slice(-2000),
        message: res.ok ? '命令执行成功' : '命令返回非零退出码'
      };
    }
    return { ok: false, error: `未知工具：${name}` };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/* --------------------------------- 主对话流程 --------------------------------- */

function buildSystemPrompt() {
  const info = distro.infoSync();
  const userPrompt = settings.publicSettings().ai.systemPrompt || '';
  return [
    '你是「Linux 使用助手」的 AI 助理，服务对象是从 Windows 迁移到 Linux 的新手。',
    '回答要口语化、分步骤、给出可以直接复制执行的命令，并解释每条命令的作用。',
    `当前系统：${info.prettyName}（${info.familyLabel}），桌面环境：${info.desktop}，架构：${info.arch}。`,
    '你可以调用工具查询与管理系统：软件包搜索/安装/卸载、文件查找、磁盘与缓存清理、应用市场与桌面个性化。',
    '原则：1) 先查询再修改；2) 修改系统前用一句话说明影响；3) 不虚构不存在的包名；4) 用户拒绝的操作立即停止并给出替代方案；5) 涉及删除或卸载时提醒备份。',
    '回答使用简体中文，Markdown 格式，命令行请用代码块。',
    userPrompt ? `用户自定义要求：${userPrompt}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function chat(ctx) {
  const { messages, onDelta, onTool, requestApproval, signal } = ctx;
  const provider = settings.activeProvider();
  assertProvider(provider);
  const ai = settings.publicSettings().ai;
  let working = (messages || []).slice(-24);
  const steps = [];
  const emitTool = (payload) => onTool && onTool(payload);

  if (!ai.toolsEnabled) {
    const body = {
      model: provider.model,
      messages: [{ role: 'system', content: buildSystemPrompt() }, ...working],
      temperature: ai.temperature,
      max_tokens: ai.maxTokens
    };
    if (ai.stream) {
      const content = await streamCompletion(provider, body, onDelta, signal);
      working.push({ role: 'assistant', content });
      return { ok: true, content, messages: working, steps };
    }
    const res = await postChat(provider, body, signal);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    await typeOut(content, onDelta, signal);
    working.push({ role: 'assistant', content });
    return { ok: true, content, messages: working, steps };
  }

  for (let round = 0; round < 5; round += 1) {
    const res = await postChat(
      provider,
      {
        model: provider.model,
        messages: [{ role: 'system', content: buildSystemPrompt() }, ...working],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: ai.temperature,
        max_tokens: ai.maxTokens,
        stream: false
      },
      signal
    );
    const data = await res.json();
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('AI 返回内容为空');
    const toolCalls = message.tool_calls || [];
    if (!toolCalls.length) {
      const content = message.content || '（模型未返回文本内容）';
      await typeOut(content, onDelta, signal);
      working.push({ role: 'assistant', content });
      return { ok: true, content, messages: working, steps };
    }
    working.push({ role: 'assistant', content: message.content || '', tool_calls: toolCalls });
    for (const call of toolCalls) {
      const name = call.function?.name || 'unknown';
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }
      emitTool({ phase: 'call', id: call.id, name, args, title: toolTitle(name, args) });
      let result;
      if (NEEDS_APPROVAL.has(name)) {
        const approved = await requestApproval({
          id: call.id,
          tool: name,
          args,
          title: toolTitle(name, args),
          risk: RISK_LABEL[name] || '该操作将修改系统'
        });
        if (!approved) {
          result = { ok: false, error: '用户拒绝执行该操作' };
        } else {
          result = await executeTool(name, args, (line) => emitTool({ phase: 'progress', id: call.id, name, line }));
        }
      } else {
        result = await executeTool(name, args, (line) => emitTool({ phase: 'progress', id: call.id, name, line }));
      }
      steps.push({ name, args, result });
      emitTool({
        phase: 'result',
        id: call.id,
        name,
        ok: result.ok !== false,
        summary: result.message || result.error || '已完成'
      });
      working.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 8000)
      });
    }
  }
  const fallback = '操作轮次过多，已停止。请把需求拆成更小的步骤再试。';
  await typeOut(fallback, onDelta, signal);
  working.push({ role: 'assistant', content: fallback });
  return { ok: true, content: fallback, messages: working, steps, exhausted: true };
}

/* ------------------------------ 模型与连通性 ------------------------------ */

async function listModels(providerId) {
  const provider = providerId ? { ...settings.PROVIDER_PRESETS.find((p) => p.id === providerId), ...settings.activeProvider(), id: providerId } : settings.activeProvider();
  if (!provider.baseUrl) return { ok: false, error: '未配置接口地址' };
  try {
    const res = await httpx.request(endpoint(provider, '/models'), { headers: buildHeaders(provider), timeout: 15000 });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.data || data.models || []).map((m) => m.id || m.name || m.model).filter(Boolean);
    return { ok: true, models, provider: provider.id };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function testProvider(providerId) {
  const base = settings.publicSettings().ai.providers.find((p) => p.id === providerId) || settings.activeProvider();
  const provider = { ...base, apiKey: settings.getProviderSecret(base.id) };
  const started = Date.now();
  try {
    assertProvider(provider);
    const res = await postChat(provider, {
      model: provider.model,
      messages: [{ role: 'user', content: '只回复两个字：可用' }],
      max_tokens: 24,
      stream: false
    }, undefined);
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || '';
    return { ok: true, latency: Date.now() - started, reply: String(reply).slice(0, 80), model: provider.model };
  } catch (err) {
    return { ok: false, error: String(err.message || err), code: err.code || '' };
  }
}

/* ------------------------------- 本地模型部署 ------------------------------- */

async function probeEndpoint(base) {
  try {
    const res = await httpx.request(`${base.replace(/\/+$/, '')}/models`, { timeout: 2000 });
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json();
    const models = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  }
}

async function detectLocal() {
  const candidates = [
    { id: 'ollama', name: 'Ollama', base: 'http://127.0.0.1:11434/v1', port: 11434 },
    { id: 'lmstudio', name: 'LM Studio', base: 'http://127.0.0.1:1234/v1', port: 1234 },
    { id: 'vllm', name: 'vLLM', base: 'http://127.0.0.1:8000/v1', port: 8000 },
    { id: 'llamacpp', name: 'llama.cpp', base: 'http://127.0.0.1:8080/v1', port: 8080 }
  ];
  const results = [];
  for (const item of candidates) {
    const probe = await probeEndpoint(item.base);
    results.push({ ...item, running: probe.ok, models: probe.models.slice(0, 20) });
  }
  return {
    endpoints: results,
    runtimes: {
      ollama: commandExistsSync('ollama'),
      python3: commandExistsSync('python3'),
      docker: commandExistsSync('docker')
    }
  };
}

const localJobs = new Map();
const vllmDir = path.join(paths.dirs.runtimes, 'vllm');
const vllmBin = path.join(vllmDir, 'bin', 'vllm');
const vllmPython = path.join(vllmDir, 'bin', 'python');

function logPathFor(name) {
  return path.join(paths.dirs.logs, `${name}.log`);
}

function startJob(kind, onLine, runner) {
  const id = `${kind}-${Date.now()}`;
  const logFile = logPathFor(kind);
  const sink = fs.createWriteStream(logFile, { flags: 'a' });
  const job = { id, kind, status: 'running', lines: [], startedAt: Date.now(), logFile, cancel: null };
  localJobs.set(id, job);
  const emit = (line, streamKind) => {
    const text = String(line).slice(0, 2000);
    job.lines.push(text);
    if (job.lines.length > 500) job.lines.shift();
    try {
      sink.write(`${text}\n`);
    } catch {
      /* ignore */
    }
    if (onLine) onLine({ jobId: id, line: text, stream: streamKind });
  };
  Promise.resolve()
    .then(() => runner(emit, job))
    .then((result) => {
      job.status = result && result.ok === false ? 'failed' : 'done';
      job.result = result;
      emit(job.status === 'done' ? '✅ 任务完成' : `❌ 任务失败：${result?.error || ''}`, 'out');
    })
    .catch((err) => {
      job.status = 'failed';
      job.result = { ok: false, error: String(err.message || err) };
      emit(`❌ 任务失败：${err.message || err}`, 'error');
    })
    .finally(() => {
      sink.end();
      setTimeout(() => {
        job.status = job.status === 'running' ? 'done' : job.status;
      }, 1000);
    });
  return { jobId: id };
}

async function vllmStatus() {
  const installed = fs.existsSync(vllmBin);
  let version = '';
  if (installed) {
    const res = await run(vllmBin, ['--version'], { timeout: 30000 });
    version = (res.stdout || res.stderr || '').trim().split('\n')[0];
  }
  const probe = await probeEndpoint('http://127.0.0.1:8000/v1');
  const server = localServers.get('vllm');
  return {
    installed,
    version,
    running: probe.ok,
    models: probe.models,
    path: vllmDir,
    managedPid: server && server.child ? server.child.pid : null
  };
}

function vllmInstall(onLine) {
  if (!paths.isLinux) {
    return startJob('vllm-install', onLine, async (emit) => {
      emit('[演示模式] 将创建虚拟环境并安装 vLLM', 'out');
      return { ok: true, demo: true };
    });
  }
  return startJob('vllm-install', onLine, async (emit) => {
    if (!commandExistsSync('python3')) {
      return { ok: false, error: '未找到 python3，请先安装 Python 3.10+（sudo apt install python3 python3-venv）' };
    }
    fs.mkdirSync(paths.dirs.runtimes, { recursive: true });
    emit(`创建虚拟环境：${vllmDir}`, 'out');
    const venv = await run('python3', ['-m', 'venv', vllmDir], { timeout: 180000 });
    if (!venv.ok) {
      return { ok: false, error: '创建虚拟环境失败，请安装 python3-venv 后重试：' + (venv.stderr || '').slice(-300) };
    }
    const pip = path.join(vllmDir, 'bin', 'pip');
    emit('升级 pip…', 'out');
    await stream(pip, ['install', '--upgrade', 'pip'], emit, { timeout: 600000 }).promise;
    emit('开始安装 vLLM（体积较大，约 1~3GB，请保持网络畅通）…', 'out');
    const code = await stream(pip, ['install', 'vllm'], emit, { timeout: 0 }).promise;
    if (code !== 0) return { ok: false, error: 'pip 安装失败，请查看日志' };
    return { ok: true };
  });
}

const localServers = new Map();

async function vllmStart(model, port = 8000, onLine) {
  if (!paths.isLinux) return { ok: true, demo: true };
  if (!fs.existsSync(vllmBin)) return { ok: false, error: '尚未安装 vLLM，请先点击「安装 vLLM」' };
  if (localServers.has('vllm')) return { ok: false, error: 'vLLM 已在运行' };
  const logFile = logPathFor('vllm-server');
  const sink = fs.createWriteStream(logFile, { flags: 'a' });
  const args = ['serve', model || 'Qwen/Qwen2.5-7B-Instruct', '--host', '127.0.0.1', '--port', String(port)];
  const handle = stream(vllmBin, args, (line, kind) => {
    sink.write(`${line}\n`);
    if (onLine) onLine({ jobId: 'vllm-server', line, stream: kind });
  }, { timeout: 0 });
  localServers.set('vllm', { child: handle, logFile, model, port, startedAt: Date.now() });
  handle.promise.then(() => {
    localServers.delete('vllm');
    sink.end();
  });
  return { ok: true, pid: handle.pid, model, port, logFile };
}

function vllmStop() {
  const server = localServers.get('vllm');
  if (!server) return { ok: false, error: 'vLLM 未在运行' };
  server.child.cancel();
  localServers.delete('vllm');
  return { ok: true };
}

async function ollamaPull(model, onLine) {
  if (!paths.isLinux) return { ok: true, demo: true };
  if (!commandExistsSync('ollama')) return { ok: false, error: '未安装 Ollama，请先访问 https://ollama.com/download 安装' };
  return startJob('ollama-pull', onLine, async (emit) => {
    const code = await stream('ollama', ['pull', String(model || 'qwen2.5:7b')], emit, { timeout: 0 }).promise;
    return { ok: code === 0, error: code === 0 ? '' : '拉取失败' };
  });
}

async function ollamaServe(onLine) {
  if (!paths.isLinux) return { ok: true, demo: true };
  if (!commandExistsSync('ollama')) return { ok: false, error: '未安装 Ollama' };
  const probe = await probeEndpoint('http://127.0.0.1:11434/v1');
  if (probe.ok) return { ok: true, already: true };
  const handle = stream('ollama', ['serve'], (line, kind) => onLine && onLine({ jobId: 'ollama-serve', line, stream: kind }), { timeout: 0 });
  localServers.set('ollama', { child: handle, startedAt: Date.now() });
  return { ok: true, pid: handle.pid };
}

function jobStatus(jobId) {
  const job = localJobs.get(jobId);
  if (!job) return null;
  return { id: job.id, status: job.status, lines: job.lines.slice(-80), result: job.result || null, logFile: job.logFile };
}

function cancelJob(jobId) {
  const job = localJobs.get(jobId);
  if (!job) return false;
  if (job.cancel) job.cancel();
  job.status = 'cancelled';
  return true;
}

module.exports = {
  TOOLS,
  chat,
  listModels,
  testProvider,
  detectLocal,
  vllmStatus,
  vllmInstall,
  vllmStart,
  vllmStop,
  ollamaPull,
  ollamaServe,
  jobStatus,
  cancelJob,
  getConversation,
  saveConversation,
  clearConversation,
  buildSystemPrompt,
  executeTool
};