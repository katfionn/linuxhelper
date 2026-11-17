'use strict';

(function () {
  const TABS = [
    { id: 'general', label: '通用', icon: 'settings' },
    { id: 'ai', label: 'AI 服务', icon: 'sparkles' },
    { id: 'data', label: '数据与隐私', icon: 'shield' },
    { id: 'about', label: '关于', icon: 'info' }
  ];

  const THEMES = [
    { value: 'dark', label: '深色', icon: 'moon' },
    { value: 'light', label: '浅色', icon: 'sun' },
    { value: 'system', label: '跟随系统', icon: 'settings' }
  ];

  const esc = (value) => UI.escapeHtml(value);

  function switchRow(attrs, title, desc, checked, disabled) {
    return `
      <div class="switch-row">
        <div class="switch-text"><strong>${esc(title)}</strong><span>${esc(desc)}</span></div>
        <label class="switch">
          <input type="checkbox" ${attrs} ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="${esc(title)}" />
        </label>
      </div>`;
  }

  function toast(message, kind) {
    UI.toast(message, kind || 'info');
  }

  window.LHViews = window.LHViews || {};
  window.LHViews.settings = {
    title: '设置',
    subtitle: '个性化助手，配置 AI 服务，管理本地数据',

    mount(root, ctx) {
      let settings = ctx.App.settings || ctx.settings || {};
      let tab = TABS.some((t) => t.id === ctx.App.settingsTab) ? ctx.App.settingsTab : 'general';
      ctx.App.settingsTab = '';
      let providerId = (settings.ai && settings.ai.activeProviderId) || '';
      let modelCache = {};
      let lastNotice = '';

      const platform = (window.lh.env && window.lh.env.platform) || '';
      const isLinux = platform === 'linux';
      const shell = document.createElement('div');
      shell.className = 'settings-layout';
      shell.innerHTML = `
        <div class="settings-nav">
          ${TABS.map(
            (t) =>
              `<button type="button" data-tab="${t.id}" class="${t.id === tab ? 'active' : ''}">${UI.icon(t.icon, 15)}<span>${t.label}</span></button>`
          ).join('')}
        </div>
        <div class="settings-panel" id="settings-panel"></div>`;
      root.appendChild(shell);

      const panel = shell.querySelector('#settings-panel');

      function currentProvider() {
        const list = (settings.ai && settings.ai.providers) || [];
        return list.find((p) => p.id === providerId) || list[0] || null;
      }

      function isLocal(provider) {
        return Boolean(provider && (provider.kind === 'local' || /localhost|127\.0\.0\.1/.test(provider.baseUrl || '')));
      }

      function commit(next) {
        if (!next) return null;
        settings = next;
        ctx.App.settings = next;
        try {
          ctx.App.applyTheme();
          ctx.App.renderChrome();
        } catch {
          /* 初始化阶段可能还没有 App 渲染器 */
        }
        return next;
      }

      async function saveGeneral(patch, silent) {
        try {
          const next = await window.lh.call('settings:update-general', patch);
          commit(next);
          if (!silent) toast('设置已保存', 'success');
          return next;
        } catch (err) {
          toast(String((err && err.message) || err), 'error');
          return null;
        }
      }

      async function saveAI(patch, silent) {
        try {
          const next = await window.lh.call('settings:update-ai', patch);
          commit(next);
          if (settings.ai && settings.ai.activeProviderId) providerId = settings.ai.activeProviderId;
          if (!silent) toast('AI 设置已保存', 'success');
          return next;
        } catch (err) {
          toast(String((err && err.message) || err), 'error');
          return null;
        }
      }

      function go(nextTab) {
        tab = nextTab;
        lastNotice = '';
        shell.querySelectorAll('[data-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
        render();
      }

      shell.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.tab)));

      /* ------------------------------- 通用设置 ------------------------------- */

      function renderGeneral() {
        const g = settings.general || {};
        const proxy = g.proxy || { enabled: false, url: 'http://127.0.0.1:7890' };
        const zoom = Number(g.zoom) || 1;
        const autostartChecked = typeof settings.autostartEnabled === 'boolean' ? settings.autostartEnabled : Boolean(g.autostart);
        panel.innerHTML = `
          <div class="card">
            <div class="card-head"><h3>外观</h3><span class="tag">立即生效</span></div>
            <div class="card-body">
              <div class="field">
                <span class="field-label">主题</span>
                <div class="segmented" id="theme-segmented">
                  ${THEMES.map(
                    (t) =>
                      `<button type="button" data-theme-value="${t.value}" class="${g.theme === t.value ? 'active' : ''}">${UI.icon(t.icon, 14)}<span>${t.label}</span></button>`
                  ).join('')}
                </div>
                <span class="field-hint">“跟随系统”会随桌面环境的深浅色自动切换。</span>
              </div>
              <div class="field mt-16">
                <span class="field-label">界面缩放</span>
                <div class="range-row" style="max-width:420px">
                  <input type="range" id="zoom" min="0.8" max="1.5" step="0.05" value="${zoom}" aria-label="界面缩放" />
                  <span class="range-value" id="zoom-value">${Math.round(zoom * 100)}%</span>
                </div>
                <span class="field-hint">适合高分屏或小屏幕，调整后整个界面会按比例缩放。</span>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>启动与提醒</h3><span class="tag">${isLinux ? '登录后后台运行' : '预览模式'}</span></div>
            <div class="card-body">
              ${switchRow(
                'data-general="autostart"',
                '开机自动启动',
                isLinux ? '登录桌面后静默启动，只显示托盘图标' : '仅 Linux 系统支持，当前为预览环境',
                autostartChecked,
                !isLinux
              )}
              ${switchRow('data-general="closeToTray"', '关闭窗口时最小化到托盘', '不会退出应用，随时可以从托盘唤起', Boolean(g.closeToTray))}
              ${switchRow('data-general="dailyTip"', '每天一条 Linux 小技巧', '启动时显示一条实用技巧', Boolean(g.dailyTip))}
              ${switchRow(
                'data-general="notifications"',
                '系统通知',
                '需要同时开启“小技巧”，才会在启动后弹出通知',
                Boolean(g.notifications)
              )}
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>网络代理</h3><span class="tag ${proxy.enabled ? 'ok' : ''}">${proxy.enabled ? '已启用' : '直连'}</span></div>
            <div class="card-body">
              ${switchRow('id="proxy-enabled"', '使用代理访问网络', 'AI 请求、应用市场与系统检测都会走代理', Boolean(proxy.enabled))}
              <div class="field mt-12">
                <span class="field-label">代理地址</span>
                <div style="display:flex;gap:8px">
                  <input class="input" id="proxy-url" value="${esc(proxy.url)}" placeholder="http://127.0.0.1:7890" ${proxy.enabled ? '' : 'disabled'} />
                  <button class="btn" id="btn-save-proxy" type="button" style="flex:none">${UI.icon('check', 14)} 保存并应用</button>
                </div>
                <span class="field-hint">支持 HTTP / HTTPS 代理，例如 http://127.0.0.1:7890。修改后立即应用到后续请求。</span>
              </div>
            </div>
          </div>`;

        panel.querySelectorAll('[data-theme-value]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const theme = btn.dataset.themeValue;
            const next = await saveGeneral({ theme }, true);
            if (!next) return;
            panel.querySelectorAll('[data-theme-value]').forEach((b) => b.classList.toggle('active', b.dataset.themeValue === theme));
            toast('主题已切换', 'success');
          })
        );

        const zoomInput = panel.querySelector('#zoom');
        const zoomLabel = panel.querySelector('#zoom-value');
        zoomInput.addEventListener('input', () => {
          const value = Number(zoomInput.value);
          zoomLabel.textContent = `${Math.round(value * 100)}%`;
          document.documentElement.style.zoom = value === 1 ? '' : String(value);
        });
        zoomInput.addEventListener('change', () => saveGeneral({ zoom: Number(zoomInput.value) }, true));

        panel.querySelectorAll('[data-general]').forEach((input) =>
          input.addEventListener('change', async () => {
            const key = input.dataset.general;
            const next = await saveGeneral({ [key]: input.checked }, true);
            if (!next) input.checked = !input.checked;
            else toast('设置已保存', 'success');
          })
        );

        const proxyToggle = panel.querySelector('#proxy-enabled');
        const proxyUrl = panel.querySelector('#proxy-url');
        const saveProxy = async () => {
          const enabled = proxyToggle.checked;
          const url = proxyUrl.value.trim() || 'http://127.0.0.1:7890';
          const next = await saveGeneral({ proxy: { enabled, url } }, true);
          if (!next) {
            proxyToggle.checked = !enabled;
            return;
          }
          proxyUrl.disabled = !enabled;
          toast(enabled ? '代理已启用' : '已切换为直连', 'success');
          render();
        };
        proxyToggle.addEventListener('change', saveProxy);
        panel.querySelector('#btn-save-proxy').addEventListener('click', saveProxy);
      }

      /* -------------------------------- AI 服务 -------------------------------- */

      function providerKeyHint(provider) {
        if (isLocal(provider)) return '本地服务通常无需 API Key，请确认服务已在运行。';
        if (provider.hasKey) return '已保存密钥（仅保存在本机），留空则保持不变。';
        return '密钥只保存在本机，不会随设置导出。';
      }

      function renderAI(notice) {
        const providers = (settings.ai && settings.ai.providers) || [];
        const active = currentProvider();
        if (!active) {
          panel.innerHTML = `<div class="card"><div class="card-body">${UI.empty('sparkles', '没有可用的 AI 服务商', '请重置设置以恢复内置服务商列表。')}</div></div>`;
          return;
        }
        providerId = active.id;
        const ai = settings.ai || {};
        const models = modelCache[active.id] || [];
        const configured = active.hasKey || isLocal(active);
        panel.innerHTML = `
          <div class="card">
            <div class="card-head"><h3>选择 AI 服务商</h3><span class="tag">${providers.length} 个可选</span></div>
            <div class="card-body">
              <div class="provider-list">
                ${providers
                  .map(
                    (p) => `
                  <button type="button" class="provider-item ${p.id === active.id ? 'active' : ''}" data-provider="${esc(p.id)}">
                    <span class="provider-radio"></span>
                    <span style="min-width:0;flex:1">
                      <strong>${esc(p.name)}</strong>
                      <span>${isLocal(p) ? '本地模型' : '云端 API'} · ${esc(p.model)}</span>
                      ${p.hint ? `<span style="display:block;color:var(--muted-2);font-size:10.5px">${esc(p.hint)}</span>` : ''}
                    </span>
                    <span class="tag ${isLocal(p) || p.hasKey ? 'ok' : ''}">${isLocal(p) ? '本地' : p.hasKey ? '已配置' : '未配置'}</span>
                  </button>`
                  )
                  .join('')}
              </div>
              <p class="text-xs text-muted mt-12">切换服务商后会立即用于新的对话；温度、系统提示词等设置对所有服务商通用。</p>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head">
              <div>
                <h3>${esc(active.name)}</h3>
                <p class="card-sub">${esc(active.hint || '')}</p>
              </div>
              <span class="tag ${configured ? 'ok' : 'warn'}">${isLocal(active) ? '本地服务' : active.hasKey ? '密钥已保存' : '待配置密钥'}</span>
            </div>
            <div class="card-body">
              <div class="form-grid">
                <div class="field">
                  <label class="field-label" for="provider-base">接口地址（Base URL）</label>
                  <input class="input" id="provider-base" value="${esc(active.baseUrl)}" placeholder="https://api.example.com/v1" />
                  <span class="field-hint">需要兼容 OpenAI 的 /chat/completions 接口。</span>
                </div>
                <div class="field">
                  <label class="field-label" for="provider-model">默认模型</label>
                  <div style="display:flex;gap:8px">
                    <input class="input" id="provider-model" list="provider-models" value="${esc(active.model)}" placeholder="模型名称" />
                    <button class="btn sm ghost" id="btn-models" type="button" style="flex:none;height:38px">${UI.icon('refresh', 13)} 模型</button>
                  </div>
                  <datalist id="provider-models">${models.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
                  <span class="field-hint">${models.length ? `已获取 ${models.length} 个可用模型，点击输入框可选择。` : '可手动填写，或先保存配置再获取模型列表。'}</span>
                </div>
                <div class="field full">
                  <label class="field-label" for="provider-key">API Key</label>
                  <div style="display:flex;gap:8px">
                    <input class="input" type="password" id="provider-key" autocomplete="off" placeholder="${
                      active.hasKey ? '••••••••（留空保持不变）' : isLocal(active) ? '本地服务可留空' : '粘贴服务商提供的 API Key'
                    }" />
                    <button class="btn primary" id="btn-save-key" type="button" style="flex:none">${UI.icon('key', 14)} 保存密钥</button>
                    ${active.hasKey ? '<button class="btn danger sm" id="btn-clear-key" type="button" style="flex:none">清除</button>' : ''}
                  </div>
                  <span class="field-hint">${esc(providerKeyHint(active))}</span>
                </div>
              </div>
              <div class="btn-row mt-16">
                <button class="btn primary" id="btn-save-provider" type="button">${UI.icon('check', 14)} 保存配置</button>
                <button class="btn" id="btn-test" type="button">${UI.icon('zap', 14)} 测试连接</button>
                ${active.docs ? `<button class="btn ghost" id="btn-docs" type="button">${UI.icon('external', 14)} 获取密钥</button>` : ''}
              </div>
              <div id="provider-status" class="text-xs text-muted mt-12">${notice || ''}</div>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head"><h3>回复风格与限制</h3><span class="tag">全局生效</span></div>
            <div class="card-body">
              <div class="form-grid">
                <div class="field">
                  <span class="field-label">温度（越高越发散）</span>
                  <div class="range-row">
                    <input type="range" id="temperature" min="0" max="2" step="0.1" value="${Number(ai.temperature || 0)}" aria-label="温度" />
                    <span class="range-value" id="temperature-value">${Number(ai.temperature || 0).toFixed(1)}</span>
                  </div>
                  <span class="field-hint">回答问题建议 0.2–0.5，创意写作可以调高。</span>
                </div>
                <div class="field">
                  <label class="field-label" for="max-tokens">单次最多生成 Tokens</label>
                  <input class="input" type="number" id="max-tokens" min="128" max="16000" step="128" value="${Number(ai.maxTokens || 1500)}" />
                  <span class="field-hint">命令解释一般 800–2000 足够。</span>
                </div>
                <div class="field full">
                  <label class="field-label" for="system-prompt">全局附加提示词（System Prompt）</label>
                  <textarea class="textarea" id="system-prompt" rows="4" placeholder="例如：回答尽量简洁，优先给出命令和注意事项。">${esc(ai.systemPrompt || '')}</textarea>
                  <span class="field-hint">会附加在内置的 Linux 专家提示词之后，对所有对话生效。</span>
                </div>
              </div>
              ${switchRow('id="stream"', '流式输出', '边生成边显示，长回答等待感更低', ai.stream !== false)}
              ${switchRow('id="tools-enabled"', '允许 AI 执行系统操作', '安装软件、清理缓存等操作都会先征求你的确认', ai.toolsEnabled !== false)}
              <div class="btn-row mt-16">
                <button class="btn primary" id="btn-save-params" type="button">${UI.icon('check', 14)} 保存生成参数</button>
              </div>
            </div>
          </div>`;

        bindAI(active);
      }

      function setProviderStatus(html) {
        const el = panel.querySelector('#provider-status');
        if (el) el.innerHTML = html;
      }

      function bindAI(active) {
        panel.querySelectorAll('[data-provider]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const id = btn.dataset.provider;
            if (id === providerId) return;
            const next = await saveAI({ activeProviderId: id }, true);
            if (!next) return;
            providerId = id;
            toast(`已切换到 ${(currentProvider() || {}).name || id}`, 'success');
            renderAI();
          })
        );

        async function saveProvider(silent) {
          const baseUrl = panel.querySelector('#provider-base').value.trim();
          const model = panel.querySelector('#provider-model').value.trim();
          const list = ((settings.ai && settings.ai.providers) || []).map((p) => (p.id === providerId ? { ...p, baseUrl, model } : p));
          const next = await saveAI({ providers: list }, silent);
          return next;
        }

        panel.querySelector('#btn-save-provider').addEventListener('click', async () => {
          const next = await saveProvider(true);
          if (!next) return;
          toast('服务商配置已保存', 'success');
          renderAI('<span class="tag ok">已保存</span> 新的接口地址与模型将用于下一次对话。');
        });

        panel.querySelector('#btn-save-key').addEventListener('click', async () => {
          const input = panel.querySelector('#provider-key');
          const key = input.value.trim();
          if (!key) {
            toast(active.hasKey ? '密钥已保存，如需更换请直接粘贴新密钥' : '请先粘贴 API Key', 'warn');
            return;
          }
          try {
            const next = await window.lh.call('settings:set-key', { id: providerId, key });
            commit(next);
            toast('API Key 已安全保存', 'success');
            renderAI('<span class="tag ok">已保存</span> 密钥已保存，可以点击“测试连接”验证。');
          } catch (err) {
            toast(String((err && err.message) || err), 'error');
          }
        });

        const clearBtn = panel.querySelector('#btn-clear-key');
        if (clearBtn) {
          clearBtn.addEventListener('click', async () => {
            const ok = await UI.confirmDialog({
              title: '清除 API Key',
              message: '清除后该服务商将无法使用，直到重新填写密钥。',
              danger: true,
              confirmText: '清除'
            });
            if (!ok) return;
            try {
              const next = await window.lh.call('settings:set-key', { id: providerId, key: '' });
              commit(next);
              toast('密钥已清除', 'success');
              renderAI('<span class="tag warn">已清除</span> 需要重新填写密钥才能使用该服务商。');
            } catch (err) {
              toast(String((err && err.message) || err), 'error');
            }
          });
        }

        panel.querySelector('#btn-models').addEventListener('click', async () => {
          const btn = panel.querySelector('#btn-models');
          const next = await saveProvider(true);
          if (!next) return;
          btn.disabled = true;
          const original = btn.innerHTML;
          btn.textContent = '获取中…';
          try {
            const res = await window.lh.call('settings:list-models', { id: providerId });
            if (!res || !res.ok) {
              setProviderStatus(`<span class="tag danger">获取失败</span> ${esc((res && res.error) || '未知错误')}`);
              toast('获取模型列表失败', 'error');
            } else {
              modelCache[providerId] = res.models || [];
              toast(`获取到 ${modelCache[providerId].length} 个模型`, 'success');
              renderAI(
                `<span class="tag ok">已获取</span> ${modelCache[providerId].length} 个可用模型，点击“默认模型”输入框选择。`
              );
            }
          } catch (err) {
            toast(String((err && err.message) || err), 'error');
          } finally {
            if (btn.isConnected) {
              btn.disabled = false;
              btn.innerHTML = original;
            }
          }
        });

        const testBtn = panel.querySelector('#btn-test');
        testBtn.addEventListener('click', async () => {
          const next = await saveProvider(true);
          if (!next) return;
          testBtn.disabled = true;
          const original = testBtn.innerHTML;
          testBtn.textContent = '测试中…';
          setProviderStatus('<span class="spinner"></span> 正在发送测试请求…');
          try {
            const res = await window.lh.call('settings:test-provider', { id: providerId });
            if (res && res.ok) {
              setProviderStatus(
                `<span class="tag ok">连接成功</span> 延迟 ${Number(res.latency) || 0} ms · 模型 ${esc(res.model || active.model)} · 回复「${esc(res.reply || '')}」`
              );
              toast('连接成功', 'success');
            } else {
              setProviderStatus(`<span class="tag danger">连接失败</span> ${esc((res && res.error) || '未知错误')}`);
              toast('连接失败，请检查接口地址与密钥', 'error');
            }
          } catch (err) {
            setProviderStatus(`<span class="tag danger">连接失败</span> ${esc(String((err && err.message) || err))}`);
            toast('连接失败', 'error');
          } finally {
            if (testBtn.isConnected) {
              testBtn.disabled = false;
              testBtn.innerHTML = original;
            }
          }
        });

        const docsBtn = panel.querySelector('#btn-docs');
        if (docsBtn) {
          docsBtn.addEventListener('click', () => {
            if (active.docs) window.lh.call('system:open-external', { url: active.docs });
          });
        }

        const temp = panel.querySelector('#temperature');
        const tempLabel = panel.querySelector('#temperature-value');
        temp.addEventListener('input', () => {
          tempLabel.textContent = Number(temp.value).toFixed(1);
        });

        panel.querySelector('#btn-save-params').addEventListener('click', async () => {
          const next = await saveAI(
            {
              temperature: Number(temp.value),
              maxTokens: Number(panel.querySelector('#max-tokens').value),
              systemPrompt: panel.querySelector('#system-prompt').value,
              stream: panel.querySelector('#stream').checked,
              toolsEnabled: panel.querySelector('#tools-enabled').checked
            },
            true
          );
          if (!next) return;
          toast('生成参数已保存', 'success');
        });

        ['#stream', '#tools-enabled'].forEach((selector) => {
          const input = panel.querySelector(selector);
          input.addEventListener('change', async () => {
            const key = selector === '#stream' ? 'stream' : 'toolsEnabled';
            const next = await saveAI({ [key]: input.checked }, true);
            if (!next) input.checked = !input.checked;
            else toast(input.checked ? '已开启' : '已关闭', 'success');
          });
        });
      }

      /* ------------------------------- 数据与隐私 ------------------------------- */

      function renderData() {
        const paths = (settings.paths) || (ctx.info && ctx.info.paths) || {};
        panel.innerHTML = `
          <div class="card">
            <div class="card-head">
              <h3>空间占用</h3>
              <button class="btn sm ghost" id="btn-usage-refresh" type="button">${UI.icon('refresh', 13)} 重新计算</button>
            </div>
            <div class="card-body">
              <div class="stat-grid">
                <div class="stat-card"><span class="stat-label">数据目录</span><strong class="stat-value" id="usage-data">—</strong><span class="stat-hint">设置、对话、个人数据</span></div>
                <div class="stat-card"><span class="stat-label">缓存目录</span><strong class="stat-value" id="usage-cache">—</strong><span class="stat-hint">可安全清理</span></div>
                <div class="stat-card"><span class="stat-label">日志目录</span><strong class="stat-value" id="usage-log">—</strong><span class="stat-hint">排错用，可随时删除</span></div>
              </div>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head"><h3>存储位置</h3><span class="tag">本机</span></div>
            <div class="card-body">
              <dl class="kv">
                <dt>数据目录</dt><dd>${esc(paths.data || '—')}</dd>
                <dt>缓存目录</dt><dd>${esc(paths.cache || '—')}</dd>
                <dt>配置目录</dt><dd>${esc(paths.config || '—')}</dd>
                <dt>日志目录</dt><dd>${esc(paths.logs || '—')}</dd>
              </dl>
              <div class="btn-row mt-16">
                <button class="btn sm" type="button" data-open-path="${esc(paths.data || '')}">${UI.icon('folder', 14)} 数据</button>
                <button class="btn sm" type="button" data-open-path="${esc(paths.cache || '')}">${UI.icon('folder', 14)} 缓存</button>
                <button class="btn sm" type="button" data-open-path="${esc(paths.config || '')}">${UI.icon('folder', 14)} 配置</button>
                <button class="btn sm" type="button" data-open-path="${esc(paths.logs || '')}">${UI.icon('folder', 14)} 日志</button>
              </div>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head"><h3>隐私说明</h3><span class="tag ok">${UI.icon('shield', 12)} 本地优先</span></div>
            <div class="card-body">
              <ul class="text-sm text-muted" style="margin:0;padding-left:18px;line-height:1.9">
                <li>对话记录、个人技能与应用来源只保存在本机数据目录，不会上传。</li>
                <li>API Key 保存在本机 <code>secrets.json</code>（权限 0600），界面上只显示掩码。</li>
                <li>只有你选定的 AI 服务商会收到对话内容；应用不包含遥测或统计上报。</li>
                <li>软件包查询与安装调用系统自带的包管理器，过程中的授权密码由系统弹窗直接处理，应用不会读取或保存密码。</li>
                <li>卸载应用不会自动删除以上目录，可在本页打开后手动清理。</li>
              </ul>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head"><h3>恢复默认设置</h3><span class="tag danger">不可撤销</span></div>
            <div class="card-body">
              <p class="text-muted" style="margin-top:0">将主题、AI 服务商配置、代理与全部已保存的 API Key 恢复为初始状态。本地对话记录与个人数据不会被删除。</p>
              <button class="btn danger" id="btn-reset" type="button">${UI.icon('refresh', 14)} 恢复默认设置</button>
            </div>
          </div>`;

        panel.querySelectorAll('[data-open-path]').forEach((btn) =>
          btn.addEventListener('click', () => {
            const target = btn.dataset.openPath;
            if (target) window.lh.call('system:open-path', { path: target });
          })
        );

        async function loadUsage() {
          const btn = panel.querySelector('#btn-usage-refresh');
          if (btn) btn.disabled = true;
          try {
            const usage = await window.lh.call('settings:usage');
            ['data', 'cache', 'log'].forEach((key) => {
              const el = panel.querySelector(`#usage-${key}`);
              if (el) el.textContent = UI.fmtBytes((usage && usage[key]) || 0);
            });
          } catch (err) {
            toast('读取空间占用失败', 'error');
          } finally {
            const reload = panel.querySelector('#btn-usage-refresh');
            if (reload) reload.disabled = false;
          }
        }
        loadUsage();
        panel.querySelector('#btn-usage-refresh').addEventListener('click', loadUsage);

        panel.querySelector('#btn-reset').addEventListener('click', async () => {
          const ok = await UI.confirmDialog({
            title: '恢复默认设置',
            message: '所有设置与保存的 API Key 都会恢复初始状态，应用会马上回到默认主题。确定继续吗？',
            danger: true,
            confirmText: '恢复默认'
          });
          if (!ok) return;
          try {
            const next = await window.lh.call('settings:reset');
            commit(next);
            providerId = (next.ai && next.ai.activeProviderId) || '';
            modelCache = {};
            toast('已恢复默认设置', 'success');
            go('general');
          } catch (err) {
            toast(String((err && err.message) || err), 'error');
          }
        });
      }

      /* --------------------------------- 关于 --------------------------------- */

      function renderAbout() {
        const info = ctx.info || {};
        const versions = info.versions || (window.lh.env && window.lh.env.versions) || {};
        const paths = info.paths || settings.paths || {};
        panel.innerHTML = `
          <div class="card">
            <div class="card-head">
              <div>
                <h3>Linux 使用助手</h3>
                <p class="card-sub">桌面 AI 使用助手 · 本地优先 · 无遥测</p>
              </div>
              <span class="tag">v${esc(info.appVersion || '—')}</span>
            </div>
            <div class="card-body">
              ${
                info.demo
                  ? `<div class="banner warn">${UI.icon('info', 15)}<span>当前不是 Linux 系统，正在以预览模式运行：系统信息与操作结果为模拟数据，安装到 Linux 后会连接真实系统。</span></div>`
                  : ''
              }
              <dl class="kv">
                <dt>系统版本</dt><dd>${esc(info.prettyName || info.name || '—')}</dd>
                <dt>桌面环境</dt><dd>${esc(info.desktop || '—')}${info.session ? ` · ${esc(String(info.session).toUpperCase())}` : ''}</dd>
                <dt>内核</dt><dd>${esc(info.kernel || '—')}</dd>
                <dt>架构</dt><dd>${esc(info.arch || '—')}</dd>
                <dt>包管理器</dt><dd>${esc(info.familyLabel || info.family || '—')}${info.pmVersion ? ` · ${esc(info.pmVersion)}` : ''}</dd>
                <dt>Electron</dt><dd>${esc(versions.electron || '—')}</dd>
                <dt>Chromium</dt><dd>${esc(versions.chrome || '—')}</dd>
                <dt>Node.js</dt><dd>${esc(versions.node || '—')}</dd>
                <dt>数据路径</dt><dd>${esc(paths.data || '—')}</dd>
              </dl>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head"><h3>使用建议</h3><span class="tag">上手提示</span></div>
            <div class="card-body">
              <div class="list">
                <div class="list-item">
                  <div class="list-item-main"><strong>先配置 AI 服务商</strong><span>点击顶栏右侧的服务商按钮即可回到 AI 设置。推荐国内直连的 DeepSeek，或在本地运行 Ollama。</span></div>
                </div>
                <div class="list-item">
                  <div class="list-item-main"><strong>系统操作需要确认</strong><span>AI 提议安装软件、清理缓存等操作时，会先展示命令与影响，只有你确认后才会执行。</span></div>
                </div>
                <div class="list-item">
                  <div class="list-item-main"><strong>遇到问题看日志</strong><span>在“数据与隐私”页可以打开日志目录，反馈问题时附上日志更容易定位。</span></div>
                </div>
              </div>
            </div>
          </div>`;
      }

      function render() {
        if (tab === 'general') renderGeneral();
        else if (tab === 'ai') renderAI(lastNotice);
        else if (tab === 'data') renderData();
        else renderAbout();
      }

      render();

      this.unmount = () => {
        // 设置页没有全局订阅；离开时无需额外清理
      };
    }
  };
})();