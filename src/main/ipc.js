// SPDX-License-Identifier: MPL-2.0
'use strict';

const { ipcMain, shell, app, Notification } = require('electron');
const path = require('node:path');
const distro = require('./lib/distro');
const settings = require('./lib/settings');
const pkgs = require('./lib/pkgs');
const catalog = require('./lib/catalog');
const files = require('./lib/files');
const ai = require('./lib/ai');
const cleanup = require('./lib/cleanup');
const data = require('./lib/data');
const paths = require('./lib/paths');

function register(getWindow) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const handlers = {
    /* -------------------------------- 系统 -------------------------------- */
    'system:info': async () => {
      const info = await distro.summary();
      return {
        ...info,
        stats: await distro.stats(),
        appVersion: app.getVersion(),
        versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
        paths: { data: paths.dirs.data, cache: paths.dirs.cache, config: paths.dirs.config, logs: paths.dirs.logs, home: paths.home },
        autostart: settings.autostartEnabled()
      };
    },
    'system:open-external': async (_e, { url }) => {
      if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: '仅支持 http(s) 链接' };
      await shell.openExternal(url);
      return { ok: true };
    },
    'system:open-path': async (_e, payload) => files.open(payload.path),
    'system:reveal': async (_e, payload) => files.reveal(payload.path),
    'system:notify': async (_e, { title, body }) => {
      if (!Notification.isSupported()) return { ok: false };
      new Notification({ title: String(title || 'Linux 使用助手').slice(0, 80), body: String(body || '').slice(0, 300) }).show();
      return { ok: true };
    },
    'system:home': async () => paths.home,
    'system:app-info': async () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      paths: paths.dirs
    }),

    /* -------------------------------- 设置 -------------------------------- */
    'settings:get': async () => ({
      ...settings.publicSettings(),
      autostartEnabled: settings.autostartEnabled(),
      providers: settings.PROVIDER_PRESETS
    }),
    'settings:update-general': async (_e, patch) => settings.updateGeneral(patch || {}),
    'settings:update-ai': async (_e, patch) => settings.updateAI(patch || {}),
    'settings:set-key': async (_e, { id, key }) => settings.setProviderKey(String(id || ''), String(key || '')),
    'settings:test-provider': async (_e, { id }) => ai.testProvider(String(id || '')),
    'settings:list-models': async (_e, { id }) => ai.listModels(String(id || '')),
    'settings:reset': async () => settings.reset(),
    'settings:usage': async () => settings.dataDirUsage(),

    /* ------------------------------ 软件包管理 ------------------------------ */
    'pkg:installed': async (_e, opts) => pkgs.listInstalled(Boolean(opts && opts.force)),
    'pkg:search': async (_e, { query, limit }) => pkgs.search(query, limit),
    'pkg:info': async (_e, { name }) => pkgs.info(name),
    'pkg:install': async (_e, { packages }) => pkgs.install(packages, (payload) => send('pkg:progress', payload)),
    'pkg:remove': async (_e, { packages, purge }) => pkgs.remove(packages, (payload) => send('pkg:progress', payload), Boolean(purge)),
    'pkg:update-index': async () => pkgs.updateIndex((payload) => send('pkg:progress', payload)),
    'pkg:upgrade': async () => pkgs.upgradeAll((payload) => send('pkg:progress', payload)),
    'pkg:upgrades': async () => pkgs.upgrades(),
    'pkg:orphans': async () => pkgs.orphans(),
    'pkg:autoremove': async () => pkgs.autoremove((payload) => send('pkg:progress', payload)),
    'pkg:cancel': async (_e, { jobId }) => pkgs.cancelJob(String(jobId || '')),

    /* ------------------------------- 应用市场 ------------------------------- */
    'store:bootstrap': async () => {
      const [state, style] = await Promise.all([catalog.installedState(), catalog.currentStyle()]);
      return {
        apps: catalog.builtinApps(),
        sources: catalog.listSources(),
        personalization: catalog.listPersonalization(),
        style,
        installed: { family: state.family, names: [...state.names], flatpak: [...state.flatIds], flatpakAvailable: state.flatAvailable },
        demo: pkgs.isDemo()
      };
    },
    'store:remote': async (_e, { force }) => catalog.remoteApps(Boolean(force)),
    'store:install': async (_e, { app }) => catalog.installApp(app, (payload) => send('store:progress', payload)),
    'store:uninstall': async (_e, { app }) => catalog.uninstallApp(app, (payload) => send('store:progress', payload)),
    'store:personal-install': async (_e, { item }) => catalog.installPersonal(item, (payload) => send('store:progress', payload)),
    'store:personal-apply': async (_e, { item }) => catalog.applyPersonal(item),
    'store:personal-uninstall': async (_e, { item }) => catalog.uninstallPersonal(item, (payload) => send('store:progress', payload)),
    'store:sources': async () => catalog.listSources(),
    'store:sources-save': async (_e, { sources }) => catalog.saveSources(sources),
    'store:sources-test': async (_e, { source }) => catalog.testSource(source),
    'store:style': async () => catalog.currentStyle(),

    /* -------------------------------- 文件 -------------------------------- */
    'files:search': async (_e, opts) => files.search(opts || {}),
    'files:open': async (_e, { path: target }) => files.open(target),
    'files:reveal': async (_e, { path: target }) => files.reveal(target),
    'files:shortcuts': async () => files.shortcuts(),

    /* --------------------------------- AI --------------------------------- */
    'ai:get-conversation': async () => ai.getConversation(),
    'ai:clear': async () => ai.clearConversation(),
    'ai:chat': async (_e, { requestId, messages }) => {
      const controller = new AbortController();
      controllers.set(requestId, controller);
      try {
        const result = await ai.chat({
          messages,
          signal: controller.signal,
          onDelta: (delta) => send('ai:delta', { requestId, delta }),
          onTool: (payload) => send('ai:tool', { requestId, ...payload }),
          requestApproval: (request) => waitApproval(requestId, request)
        });
        if (result && result.messages) ai.saveConversation(result.messages);
        send('ai:done', { requestId, ok: true });
        return { ok: true, content: result.content, messages: result.messages, steps: result.steps };
      } catch (err) {
        const message = String(err.message || err);
        send('ai:done', { requestId, ok: false, error: message, code: err.code || '' });
        return { ok: false, error: message, code: err.code || '' };
      } finally {
        controllers.delete(requestId);
        for (const [key, value] of approvals) {
          if (key.startsWith(`${requestId}:`)) {
            value.resolve(false);
            approvals.delete(key);
          }
        }
      }
    },
    'ai:abort': async (_e, { requestId }) => {
      const controller = controllers.get(requestId);
      if (controller) {
        controller.abort();
        return { ok: true };
      }
      return { ok: false };
    },
    'ai:approve': async (_e, { approvalId, approved }) => {
      const pending = approvals.get(approvalId);
      if (!pending) return { ok: false, error: '该确认请求已失效' };
      pending.resolve(Boolean(approved));
      approvals.delete(approvalId);
      return { ok: true };
    },
    'ai:detect-local': async () => ai.detectLocal(),
    'ai:vllm-status': async () => ai.vllmStatus(),
    'ai:vllm-install': async () => ai.vllmInstall((payload) => send('ai:progress', payload)),
    'ai:vllm-start': async (_e, { model, port }) => ai.vllmStart(model, port, (payload) => send('ai:progress', payload)),
    'ai:vllm-stop': async () => ai.vllmStop(),
    'ai:ollama-pull': async (_e, { model }) => ai.ollamaPull(model, (payload) => send('ai:progress', payload)),
    'ai:ollama-serve': async () => ai.ollamaServe((payload) => send('ai:progress', payload)),
    'ai:job-status': async (_e, { jobId }) => ai.jobStatus(String(jobId || '')),
    'ai:job-cancel': async (_e, { jobId }) => ai.cancelJob(String(jobId || '')),

    /* ------------------------------- 清理维护 ------------------------------- */
    'cleanup:scan': async () => cleanup.scan(),
    'cleanup:clean': async (_e, { ids }) => cleanup.clean(ids, (payload) => send('cleanup:progress', payload)),
    'cleanup:orphans': async () => cleanup.cleanOrphans((payload) => send('cleanup:progress', payload)),

    /* ------------------------------- 内置内容 ------------------------------- */
    'data:daily-tip': async () => data.dailyTip(),
    'data:tip': async (_e, { index }) => data.tipByIndex(index),
    'data:knowledge': async () => data.knowledgeMeta(),
    'data:article': async (_e, { id }) => data.article(String(id || '')),
    'data:search-knowledge': async (_e, { query }) => data.searchKnowledge(query)
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }

  return handlers;
}

const controllers = new Map();
const approvals = new Map();

function waitApproval(requestId, request) {
  const approvalId = `${requestId}:${request.id || Date.now()}`;
  return new Promise((resolve) => {
    approvals.set(approvalId, { resolve });
    const win = require('electron').BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('ai:approval', { ...request, approvalId, requestId });
    setTimeout(() => {
      if (approvals.has(approvalId)) {
        approvals.delete(approvalId);
        resolve(false);
      }
    }, 5 * 60 * 1000);
  });
}

module.exports = { register };