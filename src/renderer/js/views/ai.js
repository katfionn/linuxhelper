'use strict';

(function () {
  window.LHViews = window.LHViews || {};

  window.LHViews.ai = {
    title: 'AI 助手',
    subtitle: '用一句话管理系统：安装软件、查找文件、清理缓存、换主题',

    async mount(root, ctx) {
      const settings = ctx.settings;
      const providers = (settings && settings.ai && settings.ai.providers) || [];
      let messages = [];
      try {
        const conv = await window.lh.call('ai:get-conversation');
        messages = (conv.messages || []).filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content));
      } catch {
        /* ignore */
      }

      let busy = false;
      let requestId = null;
      let assistantBuffer = '';
      let assistantEl = null;
      let toolBox = null;
      const toolNodes = new Map();

      root.innerHTML = `
        <div class="ai-shell">
          <section class="chat-panel">
            <div class="chat-head">
              <div style="display:flex;align-items:center;gap:10px">
                <span class="tag accent">${UI.icon('sparkles', 13)} AI</span>
                <select class="select" id="provider-select" style="height:32px;font-size:12px;width:250px">
                  ${providers
                    .map(
                      (p) =>
                        `<option value="${UI.escapeHtml(p.id)}" ${p.id === settings.ai.activeProviderId ? 'selected' : ''}>${UI.escapeHtml(p.name)} · ${UI.escapeHtml(p.model)}</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div class="btn-row">
                <button class="btn sm ghost" id="btn-new">新对话</button>
                <button class="btn sm ghost" id="btn-ai-settings">${UI.icon('settings', 14)} 模型配置</button>
              </div>
            </div>
            <div class="chat-scroll" id="chat-scroll"></div>
            <div class="composer">
              <div class="composer-box">
                <textarea id="composer-input" rows="1" placeholder="描述你想做的事，例如：帮我安装 VLC，并把默认视频播放器换成它"></textarea>
                <button class="btn primary" id="btn-send" style="height:34px">${UI.icon('send', 15)} 发送</button>
                <button class="btn danger hidden" id="btn-stop" style="height:34px">${UI.icon('stop', 15)} 停止</button>
              </div>
              <div class="composer-hint">
                <span>Enter 发送 · Shift + Enter 换行 · 安装/删除类操作会先弹窗确认</span>
                <span id="chat-status">就绪</span>
              </div>
            </div>
          </section>

          <aside class="ai-side">
            <div class="side-card">
              <h3>${UI.icon('shield', 14)} 操作权限</h3>
              <p class="text-sm text-muted" style="margin:0">AI 可以查询系统；安装、卸载、清理、执行命令前都会展示具体操作并等待你确认。</p>
              <button class="btn sm block" id="btn-policy">查看可用工具</button>
            </div>
            <div class="side-card">
              <h3>${UI.icon('zap', 14)} 试试这样问</h3>
              ${[
                '帮我安装中文输入法，并说明怎么切换',
                '磁盘快满了，哪些东西可以安全清理？',
                '推荐一个看图的软件并帮我安装',
                '把我的桌面换成深色主题和 Papirus 图标',
                '我的 U 盘插上没反应，帮我排查'
              ]
                .map((text) => `<button class="suggestion" data-suggest="${UI.escapeHtml(text)}">${UI.escapeHtml(text)}</button>`)
                .join('')}
            </div>
            <div class="side-card">
              <h3>${UI.icon('server', 14)} 本地模型</h3>
              <div id="local-status" class="text-sm text-muted">点击检测 Ollama / LM Studio / vLLM 是否在运行</div>
              <button class="btn sm block" id="btn-detect">检测本地服务</button>
            </div>
          </aside>
        </div>
      `;

      UI.hydrateIcons(root);
      const scroll = root.querySelector('#chat-scroll');
      const input = root.querySelector('#composer-input');
      const sendBtn = root.querySelector('#btn-send');
      const stopBtn = root.querySelector('#btn-stop');
      const statusEl = root.querySelector('#chat-status');

      const scrollBottom = () => {
        scroll.scrollTop = scroll.scrollHeight;
      };

      function renderWelcome() {
        scroll.innerHTML = `
          <div class="empty" style="border:none;background:transparent">
            <div class="empty-icon">✨</div>
            <strong>你好，我是你的 Linux 助手</strong>
            <p>可以帮你安装软件、查文件、清理磁盘、调整桌面；遇到报错也可以直接把日志贴给我。</p>
            <div class="btn-row" style="justify-content:center">
              <span class="tag">安装软件</span><span class="tag">系统清理</span><span class="tag">桌面美化</span><span class="tag">故障排查</span>
            </div>
          </div>`;
      }

      function appendMessage(role, content) {
        const wrap = document.createElement('div');
        wrap.className = `msg ${role}`;
        wrap.innerHTML = `<div class="msg-avatar">${role === 'user' ? '🙋' : '🐧'}</div><div class="msg-bubble"></div>`;
        const bubble = wrap.querySelector('.msg-bubble');
        if (role === 'assistant') bubble.innerHTML = UI.md(content || '');
        else bubble.textContent = content;
        scroll.appendChild(wrap);
        scrollBottom();
        return bubble;
      }

      if (messages.length) {
        for (const message of messages) appendMessage(message.role, message.content || '');
      } else {
        renderWelcome();
      }

      const activeProvider = () => {
        const current = App.settings.ai.providers.find((p) => p.id === App.settings.ai.activeProviderId);
        return current || providers[0];
      };

      function ensureAssistant() {
        if (assistantEl) return assistantEl;
        if (scroll.querySelector('.empty')) scroll.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'msg assistant';
        wrap.innerHTML = `<div class="msg-avatar">🐧</div><div class="msg-bubble typing"></div>`;
        scroll.appendChild(wrap);
        assistantEl = wrap.querySelector('.msg-bubble');
        scrollBottom();
        return assistantEl;
      }

      function toolChip(payload) {
        if (!toolBox) {
          toolBox = document.createElement('div');
          toolBox.className = 'msg-tools';
          const host = ensureAssistant().parentElement;
          host.appendChild(toolBox);
        }
        let node = toolNodes.get(payload.id);
        if (!node) {
          node = document.createElement('div');
          node.className = 'tool-chip';
          node.innerHTML = `<span class="spinner"></span><span class="tool-text"></span>`;
          toolBox.appendChild(node);
          toolNodes.set(payload.id, node);
        }
        const text = node.querySelector('.tool-text');
        if (payload.phase === 'call') text.textContent = `准备：${payload.title || payload.name}`;
        else if (payload.phase === 'progress') text.textContent = String(payload.line || '').slice(0, 160);
        else if (payload.phase === 'result') {
          node.querySelector('.spinner')?.remove();
          node.innerHTML = `${UI.icon(payload.ok ? 'check' : 'x', 13)}<span class="tool-text">${UI.escapeHtml(payload.summary || '')}</span>`;
        }
        scrollBottom();
      }

      async function sendMessage() {
        const text = (input.value || '').trim();
        if (!text || busy) return;
        const provider = activeProvider();
        if (!provider || (!provider.hasKey && provider.kind !== 'local' && !/localhost|127\.0\.0\.1/.test(provider.baseUrl || ''))) {
          UI.toast('当前 AI 服务商还没有配置 API Key', 'error');
          App.settingsTab = 'ai';
          window.location.hash = '#/settings';
          return;
        }
        if (scroll.querySelector('.empty')) scroll.innerHTML = '';
        input.value = '';
        input.style.height = 'auto';
        appendMessage('user', text);
        messages.push({ role: 'user', content: text });

        busy = true;
        requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        assistantBuffer = '';
        assistantEl = null;
        toolBox = null;
        toolNodes.clear();
        ensureAssistant();
        sendBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        statusEl.textContent = 'AI 正在思考…';

        try {
          const result = await window.lh.call('ai:chat', { requestId, messages });
          if (!result.ok) {
            if (assistantEl) assistantEl.classList.remove('typing');
            const hint =
              result.code === 'MISSING_KEY'
                ? '请先到「设置 → AI 模型」填写 API Key，或切换到本地模型。'
                : String(result.error || '请求失败');
            appendMessage('assistant', `⚠️ ${hint}`);
            messages.pop();
            statusEl.textContent = '出错';
          } else {
            messages = result.messages || messages;
            if (assistantEl) assistantEl.classList.remove('typing');
            statusEl.textContent = '完成';
          }
        } catch (err) {
          if (assistantEl) assistantEl.classList.remove('typing');
          appendMessage('assistant', `⚠️ ${String(err.message || err)}`);
          statusEl.textContent = '出错';
        } finally {
          busy = false;
          sendBtn.classList.remove('hidden');
          stopBtn.classList.add('hidden');
          scrollBottom();
        }
      }

      const offDelta = window.lh.on('ai:delta', (payload) => {
        if (payload.requestId !== requestId) return;
        assistantBuffer += payload.delta || '';
        const bubble = ensureAssistant();
        bubble.classList.add('typing');
        bubble.innerHTML = UI.md(assistantBuffer);
        scrollBottom();
      });

      const offTool = window.lh.on('ai:tool', (payload) => {
        if (payload.requestId !== requestId) return;
        toolChip(payload);
      });

      App.aiApprovalHandler = async (payload) => {
        const prettyArgs = JSON.stringify(payload.args || {}, null, 2);
        const approved = await UI.modal({
          title: `需要你确认：${payload.title || payload.tool}`,
          subtitle: payload.risk,
          body: `
            <div class="banner warn" style="margin-bottom:10px">${UI.icon('shield', 14)} AI 请求执行一项会修改系统的操作</div>
            <pre class="code" style="padding:12px">${UI.escapeHtml(prettyArgs)}</pre>
            <p class="text-sm text-muted" style="margin-top:8px">只有点击「允许执行」后才会真正执行。你可以拒绝，AI 会给出替代方案。</p>
          `,
          actions: [
            { label: '拒绝', value: false, kind: 'ghost' },
            { label: '允许执行', value: true, kind: 'primary' }
          ]
        });
        await window.lh.call('ai:approve', { approvalId: payload.approvalId, approved: Boolean(approved) });
      };

      const doSend = () => sendMessage();
      sendBtn.addEventListener('click', doSend);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          doSend();
        }
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
      });

      stopBtn.addEventListener('click', async () => {
        if (requestId) {
          await window.lh.call('ai:abort', { requestId });
          statusEl.textContent = '已停止';
        }
      });

      root.querySelector('#btn-new').addEventListener('click', async () => {
        if (busy) await window.lh.call('ai:abort', { requestId });
        await window.lh.call('ai:clear');
        messages = [];
        assistantEl = null;
        toolBox = null;
        renderWelcome();
        statusEl.textContent = '新对话';
      });

      root.querySelector('#btn-ai-settings').addEventListener('click', () => {
        App.settingsTab = 'ai';
        window.location.hash = '#/settings';
      });

      root.querySelector('#provider-select').addEventListener('change', async (event) => {
        try {
          await window.lh.call('settings:update-ai', { activeProviderId: event.target.value });
          await ctx.refreshSettings();
          UI.toast('已切换 AI 服务商', 'success');
        } catch (err) {
          UI.toast(String(err.message || err), 'error');
        }
      });

      root.querySelector('#btn-policy').addEventListener('click', () => {
        const rows = [
          ['get_system_info', '读取发行版、内存、磁盘信息'],
          ['search_packages / get_package_info', '搜索软件包与查看详情'],
          ['list_installed_packages', '列出已安装软件'],
          ['install_packages / remove_packages', '安装或卸载软件（需确认）'],
          ['search_files', '在主目录按名称查找文件'],
          ['get_disk_usage / list_cleanup_targets', '查看空间与可清理项目'],
          ['clean_cache', '清理缓存与孤儿包（需确认）'],
          ['list_store_apps / apply_desktop_style', '应用市场条目与桌面美化'],
          ['run_shell', '执行自定义命令（需确认）']
        ];
        UI.modal({
          title: 'AI 可调用的工具',
          subtitle: '所有修改类操作都需要你的确认',
          body: `<div class="list">${rows
            .map(
              ([name, desc]) =>
                `<div class="list-item"><div class="list-item-main"><strong class="mono">${UI.escapeHtml(name)}</strong><span>${UI.escapeHtml(desc)}</span></div></div>`
            )
            .join('')}</div>`,
          actions: [{ label: '知道了', value: true, kind: 'primary' }]
        });
      });

      root.querySelector('#btn-detect').addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        btn.disabled = true;
        const box = root.querySelector('#local-status');
        box.innerHTML = '<span class="spinner"></span> 正在探测本机模型服务…';
        try {
          const res = await window.lh.call('ai:detect-local');
          const items = res.endpoints
            .map(
              (item) =>
                `<div class="list-item" style="padding:8px 10px"><div class="list-item-main"><strong>${UI.escapeHtml(item.name)}</strong><span>${item.running ? `运行中 · ${item.models.length} 个模型` : '未运行'} · ${UI.escapeHtml(item.base)}</span></div><span class="tag ${item.running ? 'ok' : ''}">${item.running ? '在线' : '离线'}</span></div>`
            )
            .join('');
          box.innerHTML = `<div class="list">${items}</div>`;
        } catch (err) {
          box.innerHTML = `<span class="text-muted">${UI.escapeHtml(String(err.message || err))}</span>`;
        } finally {
          btn.disabled = false;
        }
      });

      root.querySelectorAll('[data-suggest]').forEach((btn) => {
        btn.addEventListener('click', () => {
          input.value = btn.dataset.suggest;
          input.focus();
          sendMessage();
        });
      });

      if (App.pendingPrompt) {
        const pending = App.pendingPrompt;
        App.pendingPrompt = '';
        input.value = pending;
        setTimeout(() => sendMessage(), 150);
      }

      input.focus();

      this.unmount = () => {
        offDelta();
        offTool();
        App.aiApprovalHandler = null;
      };
    }
  };
})();