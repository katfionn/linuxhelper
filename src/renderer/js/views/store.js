'use strict';

(function () {
  window.LHViews = window.LHViews || {};

  const FAMILY_KEY = { apt: 'apt', pacman: 'pacman', dnf: 'dnf', zypper: 'zypper', apk: 'apk' };

  function appInstalled(app, state) {
    if (!state) return false;
    const key = FAMILY_KEY[state.family];
    const spec = app.install || {};
    if (key && spec[key] && state.names.includes(String(spec[key]).toLowerCase())) return true;
    if (spec.flatpak && state.flatpak.includes(String(spec.flatpak).toLowerCase())) return true;
    if (spec.package && state.names.includes(String(spec.package).toLowerCase())) return true;
    return false;
  }

  function iconHtml(app) {
    const url = String(app.iconUrl || '');
    if (/^https:\/\//i.test(url)) return `<img src="${UI.escapeHtml(url)}" alt="" loading="lazy" />`;
    return UI.escapeHtml(app.icon || '📦');
  }

  window.LHViews.store = {
    title: '应用市场',
    subtitle: '常用软件、桌面个性化与扩展源',

    async mount(root, ctx) {
      let tab = ctx.App.storeTab || 'apps';
      ctx.App.storeTab = 'apps';
      let data = null;
      let query = '';
      let category = '全部';
      let remote = null;
      let remoteLoading = false;
      let busy = false;
      const log = UI.createLog();

      root.innerHTML = `
        <div class="toolbar" style="justify-content:space-between">
          <div class="tabs">
            <button class="tab ${tab === 'apps' ? 'active' : ''}" data-tab="apps">常用软件</button>
            <button class="tab ${tab === 'personal' ? 'active' : ''}" data-tab="personal">个性化</button>
            <button class="tab ${tab === 'sources' ? 'active' : ''}" data-tab="sources">应用源</button>
          </div>
          <div class="btn-row">
            <div class="chip" id="family-chip">—</div>
            <button class="btn sm ghost" id="btn-refresh">${UI.icon('refresh', 14)} 刷新</button>
          </div>
        </div>
        <div id="tab-body" class="mt-16"><div class="loading-row"><span class="spinner"></span><span>正在读取应用目录…</span></div></div>
      `;

      const body = root.querySelector('#tab-body');
      const familyChip = root.querySelector('#family-chip');

      const offProgress = window.lh.on('store:progress', (payload) => {
        log.append(payload.line, payload.stream);
      });

      async function load(keepTab = true) {
        UI.busy(body, '正在读取应用目录…');
        try {
          data = await window.lh.call('store:bootstrap');
          familyChip.textContent = `${data.installed.family} · ${data.installed.names.length} 个已安装包`;
          render();
        } catch (err) {
          body.innerHTML = `<div class="banner danger">读取失败：${UI.escapeHtml(err.message || err)}</div>`;
        }
      }

      function render() {
        if (!data) return;
        if (tab === 'apps') renderApps();
        else if (tab === 'personal') renderPersonal();
        else renderSources();
      }

      /* -------------------------------- 常用软件 -------------------------------- */
      function renderApps() {
        const categories = ['全部', ...new Set(data.apps.map((a) => a.category))];
        const filtered = data.apps.filter((app) => {
          const matchQuery = !query || `${app.name} ${app.summary} ${app.category} ${(app.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase());
          const matchCat = category === '全部' || app.category === category;
          return matchQuery && matchCat;
        });

        body.innerHTML = `
          <div class="toolbar">
            <input class="input" id="store-search" placeholder="搜索应用，如输入法、播放器、浏览器…" style="max-width:360px" value="${UI.escapeHtml(query)}" />
            <span class="spacer"></span>
            <span class="text-sm text-muted">共 ${filtered.length} 个应用 · 安装走系统源 / Flatpak</span>
          </div>
          <div class="scroll-x mt-12">
            ${categories.map((c) => `<button class="chip chip-button ${c === category ? 'active' : ''}" data-cat="${UI.escapeHtml(c)}">${UI.escapeHtml(c)}</button>`).join('')}
          </div>
          <div class="mt-16" id="job-log" hidden></div>
          <div class="app-grid mt-16">
            ${filtered.length ? filtered.map((app) => appCard(app)).join('') : UI.empty('🔍', '没有匹配的应用', '换个关键词，或到「应用源」添加扩展源')}
          </div>
          <div class="banner info mt-16">
            ${UI.icon('info', 15)}
            <span>安装需要管理员授权（polkit 弹窗）。Flatpak 应用首次使用前需要在「应用源」中确认 Flathub 已启用。扩展源中的应用可能以 Docker 方式运行。</span>
          </div>
        `;

        const input = body.querySelector('#store-search');
        input.addEventListener('input', () => {
          query = input.value;
          renderApps();
          const next = body.querySelector('#store-search');
          if (next) {
            next.focus();
            next.setSelectionRange(query.length, query.length);
          }
        });
        body.querySelectorAll('[data-cat]').forEach((btn) =>
          btn.addEventListener('click', () => {
            category = btn.dataset.cat;
            renderApps();
          })
        );
        body.querySelectorAll('[data-install]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const app = data.apps.find((a) => a.id === btn.dataset.install);
            if (app) await installApp(app, 'install');
          })
        );
        body.querySelectorAll('[data-remove]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const app = data.apps.find((a) => a.id === btn.dataset.remove);
            if (app) await installApp(app, 'uninstall');
          })
        );
        body.querySelectorAll('[data-detail]').forEach((btn) =>
          btn.addEventListener('click', () => showDetail(data.apps.find((a) => a.id === btn.dataset.detail)))
        );
        const jobLog = body.querySelector('#job-log');
        if (jobLog) jobLog.replaceWith(log.el);
      }

      function appCard(app) {
        const installed = appInstalled(app, data.installed);
        const remoteBadge = app.sourceType === 'remote' ? `<span class="tag">${UI.escapeHtml(app.sourceName || '扩展源')}</span>` : '';
        return `
          <div class="app-card">
            <div class="app-head">
              <div class="app-icon">${iconHtml(app)}</div>
              <div class="app-meta">
                <strong>${UI.escapeHtml(app.name)}</strong>
                <span>${UI.escapeHtml(app.summary)}</span>
              </div>
            </div>
            <div class="app-desc">${UI.escapeHtml(app.description || app.summary || '')}</div>
            <div class="app-foot">
              <div class="btn-row">
                <span class="tag">${UI.escapeHtml(app.category || '应用')}</span>
                ${app.size ? `<span class="tag">${UI.escapeHtml(app.size)}</span>` : ''}
                ${remoteBadge}
              </div>
              <div class="btn-row">
                <button class="btn sm ghost" data-detail="${UI.escapeHtml(app.id)}">详情</button>
                ${
                  installed
                    ? `<button class="btn sm danger" data-remove="${UI.escapeHtml(app.id)}">卸载</button>`
                    : `<button class="btn sm primary" data-install="${UI.escapeHtml(app.id)}">${UI.icon('download', 13)} 安装</button>`
                }
              </div>
            </div>
          </div>`;
      }

      function showDetail(app) {
        if (!app) return;
        const installed = appInstalled(app, data.installed);
        UI.modal({
          title: app.name,
          subtitle: `${app.category || ''}${app.size ? ' · ' + app.size : ''}`,
          body: `
            <p style="margin-top:0;white-space:pre-wrap">${UI.escapeHtml(app.description || app.summary || '')}</p>
            <dl class="kv mt-12">
              <dt>安装来源</dt><dd>${app.kind === 'docker' ? 'Docker 容器（扩展源）' : '系统软件源 / Flatpak'}</dd>
              <dt>状态</dt><dd>${installed ? '已安装' : '未安装'}</dd>
              ${app.homepage ? `<dt>主页</dt><dd><a href="${UI.escapeHtml(app.homepage)}" data-external="${UI.escapeHtml(app.homepage)}">${UI.escapeHtml(app.homepage)}</a></dd>` : ''}
            </dl>
          `,
          actions: [
            { label: '关闭', value: false, kind: 'ghost' },
            installed
              ? { label: '卸载', value: 'remove', kind: 'danger' }
              : { label: '安装', value: 'install', kind: 'primary' }
          ]
        }).then((value) => {
          if (value === 'install') installApp(app, 'install');
          if (value === 'remove') installApp(app, 'uninstall');
        });
      }

      async function installApp(app, action) {
        if (busy) {
          UI.toast('已有安装任务在进行中', 'info');
          return;
        }
        if (action === 'uninstall') {
          const ok = await UI.confirmDialog({
            title: `卸载 ${app.name}？`,
            message: '卸载会移除软件及其依赖。个人配置文件通常保留，如需彻底清理可在系统维护中处理。',
            confirmText: '确认卸载',
            danger: true
          });
          if (!ok) return;
        }
        busy = true;
        log.clear();
        log.el.hidden = false;
        log.append(`${action === 'install' ? '开始安装' : '开始卸载'}：${app.name}`, 'out');
        try {
          const res = await window.lh.call(action === 'install' ? 'store:install' : 'store:uninstall', { app });
          if (res.ok) {
            UI.toast(`${app.name} ${action === 'install' ? '安装完成' : '卸载完成'}`, 'success');
          } else {
            UI.toast(res.error || '操作失败，请查看日志', 'error');
            log.append(res.error || '操作失败', 'error');
          }
        } catch (err) {
          UI.toast(String(err.message || err), 'error');
          log.append(String(err.message || err), 'error');
        } finally {
          busy = false;
          const fresh = await window.lh.call('store:bootstrap').catch(() => null);
          if (fresh) {
            data = fresh;
            render();
            const host = body.querySelector('#job-log');
            if (host) host.replaceWith(log.el);
          }
        }
      }

      /* -------------------------------- 个性化 -------------------------------- */
      function renderPersonal() {
        const personal = data.personalization || { items: [], groups: [] };
        const groups = personal.groups || [];
        const style = data.style || {};

        body.innerHTML = `
          <div class="banner info">
            ${UI.icon('palette', 15)}
            <span>当前桌面：<b>${UI.escapeHtml(style.desktop || '未知')}</b>${style.theme ? ` · 主题 ${UI.escapeHtml(style.theme)}` : ''}${style.icons ? ` · 图标 ${UI.escapeHtml(style.icons)}` : ''}。主题与图标安装到 <code>~/.local/share</code>，不需要系统权限。</span>
          </div>
          <div class="mt-16">
            ${groups
              .map((group) => {
                const items = personal.items.filter((item) => item.type === group.id);
                if (!items.length) return '';
                return `
                <div class="section-title"><div><h2>${UI.escapeHtml(group.label)}</h2><p>${items.length} 个条目</p></div></div>
                <div class="app-grid">
                  ${items.map((item) => personalCard(item)).join('')}
                </div>`;
              })
              .join('')}
          </div>
          <div class="banner warn mt-16">
            ${UI.icon('info', 15)}
            <span>部分主题需要与桌面环境版本匹配。应用失败时会给出提示，主题文件已下载到用户目录，可在系统设置中手动选择。</span>
          </div>
        `;

        body.querySelectorAll('[data-pinstall]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const item = personal.items.find((i) => i.id === btn.dataset.pinstall);
            await personalAction(item, 'install');
          })
        );
        body.querySelectorAll('[data-papply]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const item = personal.items.find((i) => i.id === btn.dataset.papply);
            await personalAction(item, 'apply');
          })
        );
        body.querySelectorAll('[data-premove]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const item = personal.items.find((i) => i.id === btn.dataset.premove);
            await personalAction(item, 'uninstall');
          })
        );
      }

      function personalCard(item) {
        const colors = (item.preview && item.preview.colors) || ['#1f2937', '#334155', '#0f172a'];
        return `
          <div class="theme-card">
            <div class="theme-preview" style="background:linear-gradient(135deg, ${colors.map((c) => UI.escapeHtml(c)).join(', ')})">${UI.escapeHtml((item.preview && item.preview.emoji) || '🎨')}</div>
            <div class="theme-body">
              <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
                <strong style="font-size:13.5px">${UI.escapeHtml(item.name)}</strong>
                <span class="tag ${item.installed ? 'ok' : ''}">${item.installed ? '已就绪' : UI.escapeHtml(item.size || '')}</span>
              </div>
              <div class="app-desc" style="-webkit-line-clamp:2">${UI.escapeHtml(item.description || '')}</div>
              <div class="btn-row" style="justify-content:flex-end">
                ${item.type !== 'wallpaper' ? `<button class="btn sm ghost" data-puninstall="${UI.escapeHtml(item.id)}">移除</button>` : ''}
                <button class="btn sm ${item.installed ? '' : 'ghost'}" data-pinstall="${UI.escapeHtml(item.id)}">${item.installed ? '重新安装' : '安装'}</button>
                <button class="btn sm primary" data-papply="${UI.escapeHtml(item.id)}">应用</button>
              </div>
            </div>
          </div>`;
      }

      async function personalAction(item, action) {
        if (!item || busy) return;
        busy = true;
        log.clear();
        log.el.hidden = false;
        log.append(`${action === 'install' ? '安装' : action === 'apply' ? '应用' : '移除'}：${item.name}`, 'out');
        try {
          let res;
          if (action === 'install') res = await window.lh.call('store:personal-install', { item });
          else if (action === 'apply') res = await window.lh.call('store:personal-apply', { item });
          else res = await window.lh.call('store:personal-uninstall', { item });
          if (res.ok) {
            UI.toast(res.message || `${item.name} 操作成功`, 'success');
            if (action === 'apply' && res.file) log.append(`壁纸文件：${res.file}`, 'out');
          } else {
            UI.toast(res.error || '操作失败', 'error');
            log.append(res.error || '操作失败', 'error');
          }
        } catch (err) {
          UI.toast(String(err.message || err), 'error');
          log.append(String(err.message || err), 'error');
        } finally {
          busy = false;
          const fresh = await window.lh.call('store:bootstrap').catch(() => null);
          if (fresh) {
            data = fresh;
            render();
            const host = body.querySelector('#job-log');
            if (host) host.replaceWith(log.el);
          }
        }
      }

      /* -------------------------------- 应用源 -------------------------------- */
      function renderSources() {
        const sources = data.sources || [];
        body.innerHTML = `
          <div class="banner info">
            ${UI.icon('link', 15)}
            <span>参考 CasaOS 的扩展源机制：添加一个 JSON 地址即可把第三方应用集合接入本应用市场。支持 LinuxHelper 格式与 CasaOS 应用源格式（含 Docker 应用）。</span>
          </div>

          <div class="section-title">
            <div><h2>已配置的应用源</h2><p>启用后会出现在「常用软件」中，可随时停用</p></div>
            <button class="btn sm" id="btn-add-source">${UI.icon('plus', 14)} 添加应用源</button>
          </div>
          <div class="grid cols-2">
            ${sources
              .map(
                (source) => `
              <div class="source-card">
                <div class="source-head">
                  <div>
                    <strong style="font-size:13.5px">${UI.escapeHtml(source.name)} ${source.builtin ? '<span class="badge ok">内置</span>' : ''}</strong>
                    <div class="source-url">${UI.escapeHtml(source.url || '随应用打包，无需联网')}</div>
                  </div>
                  ${
                    source.builtin
                      ? '<span class="tag ok">已启用</span>'
                      : `<label class="switch"><input type="checkbox" data-srctoggle="${UI.escapeHtml(source.id)}" ${source.enabled ? 'checked' : ''} /><span></span></label>`
                  }
                </div>
                <div class="btn-row">
                  ${source.builtin ? '' : `<button class="btn sm ghost" data-srctest="${UI.escapeHtml(source.id)}">测试连接</button><button class="btn sm ghost" data-srcedit="${UI.escapeHtml(source.id)}">编辑</button><button class="btn sm danger" data-srcdel="${UI.escapeHtml(source.id)}">删除</button>`}
                </div>
              </div>`
              )
              .join('')}
          </div>

          <div class="section-title">
            <div><h2>扩展应用</h2><p>从已启用的远程源拉取，Docker 应用需要本机安装 Docker</p></div>
            <button class="btn sm" id="btn-remote">${UI.icon('refresh', 14)} ${remoteLoading ? '加载中…' : '拉取扩展应用'}</button>
          </div>
          <div id="remote-area">
            ${
              remote
                ? renderRemote()
                : `<div class="empty">${UI.icon('store', 24)}<strong>尚未拉取扩展应用</strong><p>添加应用源后点击「拉取扩展应用」。远程源会被缓存到本地，离线时也能查看上次结果。</p></div>`
            }
          </div>

          <div class="card mt-16">
            <div class="card-head"><h3 class="card-title">${UI.icon('book', 15)} 应用源格式</h3></div>
            <div class="card-body">
              <p class="text-sm text-muted" style="margin:0">最小格式示例（LinuxHelper v1），CasaOS 格式也支持：</p>
              <pre class="code">{
  "schema": "linux-helper-store/v1",
  "name": "我的应用源",
  "apps": [
    {
      "id": "my-app",
      "name": "示例应用",
      "summary": "一句话介绍",
      "category": "工具",
      "install": { "apt": "example", "pacman": "example" }
    }
  ]
}</pre>
              <p class="text-sm text-muted" style="margin:0">CasaOS 格式会读取 image / port_map / volume_map 字段，并以 docker compose 方式部署到 <code>~/.local/share/linux-assistant/docker</code>。</p>
            </div>
          </div>
        `;

        body.querySelector('#btn-add-source').addEventListener('click', () => editSource(null));
        body.querySelector('#btn-remote').addEventListener('click', fetchRemote);
        body.querySelectorAll('[data-srctoggle]').forEach((input) =>
          input.addEventListener('change', async () => {
            const list = data.sources.map((s) => (s.id === input.dataset.srctoggle ? { ...s, enabled: input.checked } : s));
            await saveSources(list);
          })
        );
        body.querySelectorAll('[data-srctest]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const source = data.sources.find((s) => s.id === btn.dataset.srctest);
            btn.disabled = true;
            try {
              const res = await window.lh.call('store:sources-test', { source });
              UI.toast(`连接成功，发现 ${res.count} 个应用`, 'success');
            } catch (err) {
              UI.toast(`连接失败：${err.message || err}`, 'error');
            } finally {
              btn.disabled = false;
            }
          })
        );
        body.querySelectorAll('[data-srcedit]').forEach((btn) =>
          btn.addEventListener('click', () => editSource(data.sources.find((s) => s.id === btn.dataset.srcedit)))
        );
        body.querySelectorAll('[data-srcdel]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const source = data.sources.find((s) => s.id === btn.dataset.srcdel);
            const ok = await UI.confirmDialog({ title: '删除应用源', message: `确定删除「${source.name}」吗？`, confirmText: '删除', danger: true });
            if (!ok) return;
            await saveSources(data.sources.filter((s) => s.id !== source.id));
          })
        );
        body.querySelectorAll('[data-rinstall]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const app = (remote || []).find((a) => a.id === btn.dataset.rinstall && !a.__sourceInfo);
            if (app) await installApp(app, 'install');
          })
        );
      }

      function renderRemote() {
        if (!remote) return '';
        const sources = remote.filter((r) => r.__sourceInfo);
        const apps = remote.filter((r) => !r.__sourceInfo);
        return `
          <div class="list mt-12">
            ${sources
              .map(
                (s) => `<div class="list-item"><div class="list-item-main"><strong>${UI.escapeHtml(s.name)}</strong><span>${s.ok ? `${s.count} 个应用` : `拉取失败：${UI.escapeHtml(s.error || '')}`}</span></div><span class="tag ${s.ok ? 'ok' : 'danger'}">${s.ok ? '正常' : '失败'}</span></div>`
              )
              .join('')}
          </div>
          <div class="app-grid mt-12">
            ${apps.length ? apps.map((app) => appCard(app)).join('') : UI.empty('📦', '没有扩展应用', '检查应用源地址是否为有效的 JSON，或稍后重试')}
          </div>
        `;
      }

      async function fetchRemote(force = true) {
        if (remoteLoading) return;
        remoteLoading = true;
        renderSources();
        try {
          remote = await window.lh.call('store:remote', { force });
          const failed = remote.filter((r) => r.__sourceInfo && !r.ok);
          if (failed.length) UI.toast(`${failed.length} 个应用源拉取失败`, 'error');
          else UI.toast('扩展应用已更新', 'success');
        } catch (err) {
          UI.toast(String(err.message || err), 'error');
        } finally {
          remoteLoading = false;
          renderSources();
        }
      }

      async function saveSources(list) {
        try {
          const saved = await window.lh.call('store:sources-save', { sources: list.filter((s) => !s.builtin) });
          data.sources = saved;
          remote = null;
          renderSources();
          UI.toast('应用源已保存', 'success');
        } catch (err) {
          UI.toast(String(err.message || err), 'error');
        }
      }

      function editSource(source) {
        const isEdit = Boolean(source);
        UI.modal({
          title: isEdit ? '编辑应用源' : '添加应用源',
          subtitle: '支持 LinuxHelper 与 CasaOS 应用源 JSON',
          body: `
            <div class="form-grid">
              <div class="field full"><span class="field-label">名称</span><input class="input" id="src-name" placeholder="例如：社区精选源" value="${UI.escapeHtml(source ? source.name : '')}" /></div>
              <div class="field full"><span class="field-label">JSON 地址</span><input class="input" id="src-url" placeholder="https://example.com/appstore.json" value="${UI.escapeHtml(source ? source.url : '')}" /></div>
              <label class="switch full" style="padding-top:6px"><input type="checkbox" id="src-enabled" ${!source || source.enabled ? 'checked' : ''} /><span>启用该应用源</span></label>
            </div>
          `,
          actions: [
            { label: '取消', value: false, kind: 'ghost' },
            {
              label: isEdit ? '保存' : '添加',
              kind: 'primary',
              onClick(backdrop) {
                const name = backdrop.querySelector('#src-name').value.trim();
                const url = backdrop.querySelector('#src-url').value.trim();
                const enabled = backdrop.querySelector('#src-enabled').checked;
                if (!name || !url) {
                  UI.toast('名称和地址不能为空', 'error');
                  return false;
                }
                const list = (data.sources || []).filter((s) => !s.builtin);
                if (isEdit) {
                  const index = list.findIndex((s) => s.id === source.id);
                  list[index] = { ...list[index], name, url, enabled };
                } else {
                  list.push({ name, url, enabled });
                }
                saveSources(list);
                return true;
              }
            }
          ]
        });
      }

      /* -------------------------------- 事件绑定 -------------------------------- */
      root.querySelectorAll('[data-tab]').forEach((btn) =>
        btn.addEventListener('click', () => {
          tab = btn.dataset.tab;
          root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
          render();
        })
      );
      root.querySelector('#btn-refresh').addEventListener('click', () => load());

      await load();

      this.unmount = () => {
        offProgress();
      };
    }
  };
})();