'use strict';

(function () {
  window.LHViews = window.LHViews || {};

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function pct(used, total) {
    if (!total) return 0;
    return Math.min(100, Math.round((used / total) * 100));
  }

  function barClass(value) {
    if (value >= 90) return 'danger';
    if (value >= 72) return 'warn';
    return '';
  }

  window.LHViews.home = {
    title: '首页',
    subtitle: '系统概览、每日技巧与快捷入口',

    async mount(root, ctx) {
      const info = ctx.info || {};
      const stats = info.stats || {};
      const memo = pct(stats.memUsed, stats.memTotal);
      const disk = pct((stats.diskTotal || 0) - (stats.diskFree || 0), stats.diskTotal);
      const load = (stats.load && stats.load[0]) || 0;
      const loadPct = Math.min(100, Math.round((load / Math.max(stats.cores || 1, 1)) * 100));

      let tip = null;
      try {
        tip = await window.lh.call('data:daily-tip');
      } catch {
        /* ignore */
      }

      const distroChip = info.demo ? '预览模式' : info.prettyName;
      root.innerHTML = `
        <section class="hero">
          <span class="hero-eyebrow">🐧 ${UI.escapeHtml(greeting())}，欢迎使用 Linux 使用助手</span>
          <h2>${UI.escapeHtml(info.demo ? '先从了解 Linux 开始' : `你的 ${info.name || 'Linux'} 已经准备就绪`)}</h2>
          <p>不熟悉命令行也没关系。问一句「怎么装微信」「磁盘满了怎么办」，AI 会先解释原因，再帮你执行——涉及修改系统的操作都会先征求你的同意。</p>
          <div class="hero-ask">
            <input class="input" id="hero-input" placeholder="例如：帮我安装中文输入法，并说明怎么切换到拼音" />
            <button class="btn primary lg" id="hero-send">${UI.icon('sparkles', 16)} 问 AI</button>
          </div>
          <div class="hero-meta">
            <span>发行版 <b>${UI.escapeHtml(distroChip || '—')}</b></span>
            <span>桌面 <b>${UI.escapeHtml(info.desktop || '—')}</b></span>
            <span>包管理 <b>${UI.escapeHtml(info.familyLabel || '—')}</b></span>
            <span>内核 <b>${UI.escapeHtml(info.kernel || '—')}</b></span>
          </div>
        </section>

        <div class="grid cols-3 mt-16">
          <div class="card stat-card">
            <div class="stat-label">内存占用</div>
            <div class="stat-value">${UI.fmtBytes(stats.memUsed)}<small>/ ${UI.fmtBytes(stats.memTotal)}</small></div>
            <div class="stat-bar"><i class="${barClass(memo)}" style="width:${memo}%"></i></div>
            <div class="stat-foot">已使用 ${memo}% · ${stats.cores || '—'} 核心 CPU</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">磁盘空间（/）</div>
            <div class="stat-value">${UI.fmtBytes(stats.diskFree)}<small>可用</small></div>
            <div class="stat-bar"><i class="${barClass(disk)}" style="width:${disk}%"></i></div>
            <div class="stat-foot">已使用 ${disk}% · 共 ${UI.fmtBytes(stats.diskTotal)}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">系统负载</div>
            <div class="stat-value">${Number(load).toFixed(2)}<small>1 分钟</small></div>
            <div class="stat-bar"><i class="${barClass(loadPct)}" style="width:${loadPct}%"></i></div>
            <div class="stat-foot">已运行 ${UI.fmtUptime(stats.uptime)} · ${UI.escapeHtml(stats.hostname || '')}</div>
          </div>
        </div>

        <div class="grid cols-2 mt-16">
          <div class="card">
            <div class="card-head">
              <div>
                <h3 class="card-title">${UI.icon('zap', 16)} 每日一个小技巧</h3>
                <p class="card-sub">每天 0 点自动更换 · 共 ${tip ? tip.total : 0} 条</p>
              </div>
              <button class="btn sm ghost" id="tip-next">换一条</button>
            </div>
            <div class="tip-card" id="tip-card">${renderTip(tip)}</div>
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <h3 class="card-title">${UI.icon('package', 16)} 快捷入口</h3>
                <p class="card-sub">常用功能一步直达</p>
              </div>
            </div>
            <div class="quick-grid">
              <button class="quick-card" data-go="ai">
                <span class="quick-icon">✨</span>
                <span><strong>AI 助手</strong><span>描述需求，自动完成系统操作</span></span>
              </button>
              <button class="quick-card" data-go="store">
                <span class="quick-icon">🛍️</span>
                <span><strong>应用市场</strong><span>安装常用软件与扩展源</span></span>
              </button>
              <button class="quick-card" data-go="store:personal">
                <span class="quick-icon">🎨</span>
                <span><strong>个性化市场</strong><span>主题、图标、光标与壁纸</span></span>
              </button>
              <button class="quick-card" data-go="files">
                <span class="quick-icon">🔍</span>
                <span><strong>文件查找</strong><span>快速定位下载的文件</span></span>
              </button>
              <button class="quick-card" data-go="maintenance">
                <span class="quick-icon">🧹</span>
                <span><strong>系统清理</strong><span>缓存与无用依赖</span></span>
              </button>
              <button class="quick-card" data-go="knowledge">
                <span class="quick-icon">📚</span>
                <span><strong>Linux 知识</strong><span>从 Windows 迁移必读</span></span>
              </button>
            </div>
          </div>
        </div>

        <div class="grid cols-2 mt-16">
          <div class="card">
            <div class="card-head">
              <div>
                <h3 class="card-title">${UI.icon('cpu', 16)} 系统信息</h3>
                <p class="card-sub">所有应用数据均保存在家目录</p>
              </div>
            </div>
            <dl class="kv">
              <dt>发行版</dt><dd>${UI.escapeHtml(info.prettyName || '—')}</dd>
              <dt>包管理器</dt><dd>${UI.escapeHtml(info.familyLabel || '—')}</dd>
              <dt>桌面环境</dt><dd>${UI.escapeHtml(info.desktop || '—')} ${info.session ? `(${UI.escapeHtml(info.session)})` : ''}</dd>
              <dt>架构 / 内核</dt><dd>${UI.escapeHtml(info.arch || '—')} · ${UI.escapeHtml(info.kernel || '—')}</dd>
              <dt>数据目录</dt><dd class="mono">${UI.escapeHtml((info.paths && info.paths.data) || '—')}</dd>
              <dt>缓存目录</dt><dd class="mono">${UI.escapeHtml((info.paths && info.paths.cache) || '—')}</dd>
            </dl>
            <div class="btn-row mt-12">
              <button class="btn sm ghost" id="open-data">打开数据目录</button>
              <button class="btn sm ghost" id="open-cache">打开缓存目录</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <div>
                <h3 class="card-title">${UI.icon('globe', 16)} 从 Windows 过来？先看这三篇</h3>
                <p class="card-sub">迁移期最容易卡住的地方</p>
              </div>
            </div>
            <div class="list">
              ${[
                ['filesystem', 'Linux 的文件系统长什么样', '没有 C 盘 D 盘？先搞懂 /home'],
                ['install-ways', 'Linux 装软件的四种方式', '软件源、Flatpak、AppImage 怎么选'],
                ['input-method', '中文输入法配置', 'fcitx5 从安装到能打字']
              ]
                .map(
                  ([id, title, desc]) => `
                <div class="list-item" style="cursor:pointer" data-article="${id}">
                  <div class="list-item-main"><strong>${UI.escapeHtml(title)}</strong><span>${UI.escapeHtml(desc)}</span></div>
                  ${UI.icon('chevron', 16)}
                </div>`
                )
                .join('')}
            </div>
            <div class="btn-row mt-12">
              <button class="btn sm" data-go="knowledge">查看全部知识</button>
            </div>
          </div>
        </div>

        <div class="grid cols-2 mt-16">
          <div class="card">
            <div class="card-head">
              <h3 class="card-title">${UI.icon('shield', 16)} 安全与授权</h3>
            </div>
            <div class="banner info">
              安装、卸载、清理缓存等操作需要管理员授权（polkit 弹窗）。AI 每次执行前都会把要运行的命令展示给你，确认后才会执行。
            </div>
          </div>
          <div class="card">
            <div class="card-head">
              <h3 class="card-title">${UI.icon('sparkles', 16)} AI 模型</h3>
              <button class="btn sm ghost" data-go="settings">去配置</button>
            </div>
            <p class="text-sm text-muted" id="ai-summary">加载中…</p>
            <div class="btn-row mt-12">
              <button class="btn sm" data-go="ai">开始对话</button>
              <button class="btn sm ghost" id="local-detect">检测本地模型</button>
            </div>
          </div>
        </div>
      `;

      UI.hydrateIcons(root);

      const send = () => {
        const input = root.querySelector('#hero-input');
        const text = (input.value || '').trim();
        App.pendingPrompt = text;
        window.location.hash = '#/ai';
      };
      root.querySelector('#hero-send').addEventListener('click', send);
      root.querySelector('#hero-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') send();
      });

      let tipIndex = tip ? tip.index : 0;
      root.querySelector('#tip-next').addEventListener('click', async () => {
        tipIndex += 1;
        try {
          const next = await window.lh.call('data:tip', { index: tipIndex });
          root.querySelector('#tip-card').innerHTML = renderTip(next);
        } catch {
          /* ignore */
        }
      });

      root.querySelectorAll('[data-go]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.go;
          if (target === 'store:personal') {
            App.storeTab = 'personal';
            window.location.hash = '#/store';
          } else {
            window.location.hash = `#/${target}`;
          }
        });
      });

      root.querySelectorAll('[data-article]').forEach((item) => {
        item.addEventListener('click', () => {
          App.openArticleId = item.dataset.article;
          window.location.hash = '#/knowledge';
        });
      });

      root.querySelector('#open-data').addEventListener('click', () => window.lh.call('system:open-path', { path: info.paths.data }));
      root.querySelector('#open-cache').addEventListener('click', () => window.lh.call('system:open-path', { path: info.paths.cache }));

      const settings = ctx.settings;
      const active = settings && settings.ai.providers.find((p) => p.id === settings.ai.activeProviderId);
      const configured = active && (active.hasKey || active.kind === 'local');
      root.querySelector('#ai-summary').innerHTML = active
        ? `${UI.escapeHtml(active.name)} · <span class="mono">${UI.escapeHtml(active.model)}</span><br><span class="text-muted">${configured ? '已配置，可以开始对话' : '尚未填写 API Key，请到设置中完成配置'}</span>`
        : '尚未配置 AI 服务商';

      root.querySelector('#local-detect').addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        btn.disabled = true;
        try {
          const res = await window.lh.call('ai:detect-local');
          const found = res.endpoints.filter((e) => e.running);
          if (found.length) {
            UI.toast(`发现本地模型服务：${found.map((f) => f.name).join('、')}`, 'success');
          } else {
            UI.toast('未发现运行中的本地模型（Ollama / LM Studio / vLLM）', 'info');
          }
        } catch (err) {
          UI.toast(String(err.message || err), 'error');
        } finally {
          btn.disabled = false;
        }
      });
    }
  };

  function renderTip(tip) {
    if (!tip) return '<div class="text-muted">暂无技巧数据</div>';
    return `
      <div class="tip-title">${UI.escapeHtml(tip.title)}</div>
      <div class="tip-body">${UI.escapeHtml(tip.body)}</div>
      ${tip.command ? UI.codeBlock(tip.command, '试试这条命令') : ''}
      <div class="btn-row"><span class="tag">${UI.escapeHtml(tip.category || '技巧')}</span><span class="text-sm text-muted">第 ${tip.index + 1} / ${tip.total} 条</span></div>
    `;
  }
})();