// SPDX-License-Identifier: MPL-2.0
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = [
  'system:info',
  'system:open-external',
  'system:open-path',
  'system:reveal',
  'system:notify',
  'system:home',
  'system:app-info',
  'settings:get',
  'settings:update-general',
  'settings:update-ai',
  'settings:set-key',
  'settings:test-provider',
  'settings:list-models',
  'settings:reset',
  'settings:usage',
  'pkg:installed',
  'pkg:search',
  'pkg:info',
  'pkg:install',
  'pkg:remove',
  'pkg:update-index',
  'pkg:upgrade',
  'pkg:upgrades',
  'pkg:orphans',
  'pkg:autoremove',
  'pkg:cancel',
  'store:bootstrap',
  'store:remote',
  'store:install',
  'store:uninstall',
  'store:personal-install',
  'store:personal-apply',
  'store:personal-uninstall',
  'store:sources',
  'store:sources-save',
  'store:sources-test',
  'store:style',
  'files:search',
  'files:open',
  'files:reveal',
  'files:shortcuts',
  'ai:get-conversation',
  'ai:clear',
  'ai:chat',
  'ai:abort',
  'ai:approve',
  'ai:detect-local',
  'ai:vllm-status',
  'ai:vllm-install',
  'ai:vllm-start',
  'ai:vllm-stop',
  'ai:ollama-pull',
  'ai:ollama-serve',
  'ai:job-status',
  'ai:job-cancel',
  'cleanup:scan',
  'cleanup:clean',
  'cleanup:orphans',
  'data:daily-tip',
  'data:tip',
  'data:knowledge',
  'data:article',
  'data:search-knowledge'
];

const EVENT_CHANNELS = [
  'pkg:progress',
  'store:progress',
  'cleanup:progress',
  'ai:delta',
  'ai:tool',
  'ai:approval',
  'ai:done',
  'ai:progress',
  'ui:navigate'
];

const invokeSet = new Set(INVOKE_CHANNELS);
const eventSet = new Set(EVENT_CHANNELS);

contextBridge.exposeInMainWorld('lh', {
  call(channel, payload) {
    if (!invokeSet.has(channel)) return Promise.reject(new Error(`未授权的通道: ${channel}`));
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, callback) {
    if (!eventSet.has(channel)) return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  env: {
    platform: process.platform,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }
  }
});