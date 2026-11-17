// SPDX-License-Identifier: MPL-2.0
'use strict';

// 在隔离的临时家目录中运行，避免触碰开发者真实配置。
const settings = require('../../src/main/lib/settings');

const mode = process.argv[2] || 'read';

if (mode === 'mutate') {
  settings.updateGeneral({ theme: 'light', zoom: 9, closeToTray: true });
  settings.updateAI({
    activeProviderId: 'deepseek',
    temperature: 9,
    maxTokens: 999999,
    systemPrompt: '  只回答 Linux 问题  '
  });
  settings.setProviderKey('deepseek', 'sk-test-1234567890');
}

if (mode === 'reset') {
  settings.reset();
}

const pub = settings.publicSettings();
const active = settings.activeProvider();
process.stdout.write(JSON.stringify({
  general: pub.general,
  ai: pub.ai,
  paths: pub.paths,
  secret: settings.getProviderSecret('deepseek'),
  active: { id: active.id, hasApiKey: Boolean(active.apiKey) }
}));