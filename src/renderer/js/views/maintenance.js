'use strict';

(function () {
  window.LHViews = window.LHViews || {};

  const RISK_LABEL = { low: '安全', medium: '注意' };

  window.LHViews.maintenance = {
    title: '系统维护',
    subtitle: '清缓存、卸载无用依赖、检查更新',

    async mount(root, ctx) {
      let tab = 'cleanup';
      let scan = null;
      let scanning = false;
      let cleaning = false;
      let selected = new Set();
      let installed = null;
      let installedFilter = '';
      let upgrades = null;
      let busyMessage = '';

      root.innerHTML = `
        <div class="tabs" id="mt-tabs">
          <button class="tab active" data-tab="cleanup">${UI.icon('trash', 15)} 缓存清理</button>
          <button class="tab" data-tab="packages">${UI.icon('package', 15)} 软件包</button>
        </div>
        <div id="mt-body" class="mt-16"></div>
        <div id="mt-log" class="mt-16"></div>
      `;

      const body = root.querySelector('#mt-body');
      const logHost = root.querySelector('#mt-log');
      const log = UI.createLog();
      logHost.appendChild(log.el);
      logHost.hidden = true;

      function writeLog(line, kind) {
        logHost.hidden = false;
        log.append(line, kind);
      }

      root.querySelectorAll('[data-tab]').forEach((btn) =>
        btn.addEventListener('click', () => {
          tab = btn.dataset.tab;
          root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
          render();
        })
      );

      const offCleanup = window.lh.on('cleanup:progress', (p) => {
        if (p && p.line) writeLog(p.line, p.stream);
      });
      const offPkg = window.lh.on('pkg:progress', (p) => {
        if (p && p.line) writeLog(p.line, p.stream);
      });

      function render() {
        if (tab === 'cleanup') renderCleanup();
        else renderPackages();
      }

      /* ------------------------------ 缓存清理 ------------------------------ */

      function cleanupHost() {
        return body.querySelector('#cleanup-content') || body;
      }

      async function loadScan() {
        if (scanning) return;
        scanning = true;
        const btn = body.querySelector('#btn-rescan');
        if (btn) btn.disabled = true;
        cleanupHost().innerHTML = `<div class="loading-row"><span class="spinner"></span><span>正在扫描可清理的内容…</span></div>`;
        try {
          scan = await window.lh.call('cleanup:scan');
          selected = new Set(scan.targets.filter((t) => t.risk === 'low').map((t) => t.id));
        } catch (err) {
          cleanupHost().innerHTML = `<div class="banner danger">扫描失败：${UI.escapeHtml(String(err.message || err))}</div>`;
          scanning = false;
          return;
        }
        scanning = false;
        if (tab === 'cleanup') renderCleanup();
      }

      function renderCleanup() {
        if (!scan) {
          body.innerHTML = `
            <div class="card">
              <div class="card-head"><h3>释放磁盘空间</h3><span class="tag">只清理缓存，不动你的个人文件</span></div>
              <div class="card-body" id="cleanup-content">
                <p class="text-muted" style="margin-top:0">扫描系统缓存、软件包残留与孤儿依赖。默认勾选的都是「安全」项，删除后会自动重建或重新下载。</p>
                <button class="btn primary" id="btn-rescan">${UI.icon('search', 15)} 开始扫描</button>
              </div>
            </div>`;
          body.querySelector('#btn-rescan').addEventListener('click', loadScan);
          return;
        }

        const t = scan.targets || [];
        const selectedBytes = t.filter((x) => selected.has(x.id)).reduce((sum, x) => sum + x.size, 0);
        body.innerHTML = `
          <div class="stat-grid">
            <div class="stat-card"><span class="stat-label">可清理总量</span><strong class="stat-value">${UI.fmtBytes(scan.total)}</strong><span class="stat-hint">${t.length} 个位置</span></div>
            <div class="stat-card"><span class="stat-label">已选</span><strong class="stat-value">${UI.fmtBytes(selectedBytes)}</strong><span class="stat-hint">${selected.size} 项</span></div>
            <div class="stat-card"><span class="stat-label">孤儿依赖</span><strong class="stat-value">${scan.orphans.count} 个</strong><span class="stat-hint">${UI.escapeHtml(scan.orphans.total || '自动检测')}</span></div>
            <div class="stat-card"><span class="stat-label">应用数据 / 缓存 / 日志</span><strong class="stat-value">${UI.fmtBytes(scan.appData.data + scan.appData.cache + scan.appData.logs)}</strong><span class="stat-hint">${UI.fmtBytes(scan.appData.data)} / ${UI.fmtBytes(scan.appData.cache)} / ${UI.fmtBytes(scan.appData.logs)}</span></div>
          </div>

          ${scan.demo ? `<div class="banner warn">${UI.icon('info', 15)}<span>当前是预览模式，清理操作只会模拟执行，不会删除真实文件。</span></div>` : ''}

          <div class="card mt-16">
            <div class="card-head">
              <h3>可清理项</h3>
              <div class="btn-row">
                <button class="btn sm ghost" id="btn-select-all">全选安全项</button>
                <button class="btn sm ghost" id="btn-rescan">${UI.icon('refresh', 13)} 重新扫描</button>
              </div>
            </div>
            <div class="card-body" id="cleanup-content">
              <div class="list">
                ${t
                  .map(
                    (item) => `
                  <label class="list-item clean-row ${item.risk === 'medium' ? 'risk' : ''}">
                    <input type="checkbox" data-target="${UI.escapeHtml(item.id)}" ${selected.has(item.id) ? 'checked' : ''} />
                    <div class="list-item-main">
                      <strong>${UI.escapeHtml(item.label)} <span class="tag ${item.risk === 'low' ? 'ok' : 'warn'}">${RISK_LABEL[item.risk] || item.risk}</span></strong>
                      <span>${UI.escapeHtml(item.desc)}</span>
                      <code class="path-mini">${UI.escapeHtml(item.path)}</code>
                    </div>
                    <div class="clean-size">${UI.fmtBytes(item.size)}<small>${item.entries} 项</small></div>
                  </label>`
                  )
                  .join('')}
              </div>
              <div class="btn-row mt-16">
                <button class="btn primary" id="btn-clean" ${cleaning || !selected.size ? 'disabled' : ''}>
                  ${UI.icon('trash', 15)} ${cleaning ? '清理中…' : `清理所选项（${UI.fmtBytes(selectedBytes)}）`}
                </button>
                <button class="btn" id="btn-open-cache">${UI.icon('folder', 14)} 打开应用缓存目录</button>
              </div>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head">
              <h3>无用依赖（孤儿包）</h3>
              <span class="tag ${scan.orphans.count ? 'warn' : 'ok'}">${scan.orphans.count ? `${scan.orphans.count} 个待清理` : '干净'}</span>
            </div>
            <div class="card-body">
              <p class="text-muted" style="margin-top:0">这些是曾经被安装、现在已没有软件需要的库。用包管理器提供的安全方式移除，不会影响现有软件。</p>
              ${scan.orphans.packages.length ? `<div class="chip-row mb-12">${scan.orphans.packages.slice(0, 30).map((p) => `<span class="tag">${UI.escapeHtml(p.name)}</span>`).join('')}${scan.orphans.packages.length > 30 ? `<span class="tag">…共 ${scan.orphans.packages.length} 个</span>` : ''}</div>` : ''}
              <button class="btn ${scan.orphans.count ? 'danger' : ''}" id="btn-autoremove" ${scan.orphans.count && !cleaning ? '' : 'disabled'}>
                ${UI.icon('trash', 14)} 移除无用依赖${scan.orphans.total ? `（约 ${UI.escapeHtml(scan.orphans.total)}）` : ''}
              </button>
              <p class="text-xs text-muted mt-12">若提示需要管理员密码，会弹出系统授权窗口，由系统自己询问密码，应用不会保存你的密码。</p>
            </div>
          </div>
        `;

        body.querySelectorAll('[data-target]').forEach((box) =>
          box.addEventListener('change', () => {
            if (box.checked) selected.add(box.dataset.target);
            else selected.delete(box.dataset.target);
            renderCleanup();
          })
        );

        body.querySelector('#btn-select-all').addEventListener('click', () => {
          selected = new Set(scan.targets.filter((x) => x.risk === 'low').map((x) => x.id));
          renderCleanup();
        });
        body.querySelector('#btn-rescan').addEventListener('click', loadScan);
        body.querySelector('#btn-open-cache').addEventListener('click', () =>
          window.lh.call('system:open-path', { path: ctx.info.paths.cache })
        );

        const cleanBtn = body.querySelector('#btn-clean');
        if (cleanBtn) cleanBtn.addEventListener('click', doClean);
        const autoBtn = body.querySelector('#btn-autoremove');
        if (autoBtn) autoBtn.addEventListener('click', doAutoremove);
      }

      async function doClean() {
        if (!selected.size || cleaning) return;
        const bytes = scan.targets.filter((x) => selected.has(x.id)).reduce((sum, x) => sum + x.size, 0);
        const risky = scan.targets.filter((x) => selected.has(x.id) && x.risk !== 'low');
        const ok = await UI.confirmDialog({
          title: '确认清理',
          message: `将清理 ${selected.size} 个位置，预计释放 ${UI.fmtBytes(bytes)}。`,
          extra: risky.length
            ? `<p class="text-sm" style="color:#c2410c">包含需要留意的项目：${risky.map((r) => UI.escapeHtml(r.label)).join('、')}。回收站清空后文件无法恢复。</p>`
            : '',
          confirmText: '开始清理'
        });
        if (!ok) return;
        cleaning = true;
        log.clear();
        logHost.hidden = true;
        writeLog(`开始清理 ${selected.size} 项…`);
        renderCleanup();
        try {
          const res = await window.lh.call('cleanup:clean', { ids: [...selected] });
          cleaning = false;
          if (res.demo) {
            UI.toast('预览模式：已模拟清理', 'info');
          } else if (res.ok) {
            UI.toast(`清理完成，释放 ${UI.fmtBytes(res.freed)}`, 'success');
          } else {
            UI.toast('部分项目清理失败，请查看下方日志', 'warn');
          }
          writeLog(`清理完成，释放 ${UI.fmtBytes(res.freed)}`);
        } catch (err) {
          cleaning = false;
          writeLog(`清理失败：${String(err.message || err)}`);
          UI.toast('清理失败', 'error');
        }
        scan = null;
        selected = new Set();
        await loadScan();
      }

      async function doAutoremove() {
        if (cleaning) return;
        const ok = await UI.confirmDialog({
          title: '移除无用依赖',
          message: '将调用系统包管理器的自动清理功能移除孤儿依赖，可能需要管理员授权。',
          confirmText: '移除了解'
        });
        if (!ok) return;
        cleaning = true;
        log.clear();
        logHost.hidden = true;
        writeLog('正在移除无用依赖…');
        renderCleanup();
        try {
          const res = await window.lh.call('cleanup:orphans');
          cleaning = false;
          UI.toast(res.demo ? '预览模式：已模拟移除' : res.ok === false ? '移除未完成，请查看日志' : '无用依赖已移除', res.ok === false ? 'warn' : 'success');
        } catch (err) {
          cleaning = false;
          writeLog(`移除失败：${String(err.message || err)}`);
          UI.toast('移除失败', 'error');
        }
        scan = null;
        await loadScan();
      }

      /* ------------------------------ 软件包管理 ------------------------------ */

      async function loadPackages(force = false) {
        body.querySelector('#pkg-content').innerHTML = `<div class="loading-row"><span class="spinner"></span><span>正在读取已安装软件…</span></div>`;
        try {
          installed = await window.lh.call('pkg:installed', { force });
        } catch (err) {
          body.querySelector('#pkg-content').innerHTML = `<div class="banner danger">读取失败：${UI.escapeHtml(String(err.message || err))}</div>`;
          return;
        }
        upgrades = await window.lh.call('pkg:upgrades').catch(() => ({ packages: [] }));
        if (tab === 'packages') renderPackages();
      }

      function renderPackages() {
        if (!installed) {
          body.innerHTML = `
            <div class="card">
              <div class="card-head"><h3>软件包</h3><span class="tag">${UI.escapeHtml(ctx.info.familyLabel || ctx.info.family || '')}</span></div>
              <div class="card-body">
                <p class="text-muted" style="margin-top:0">查看已安装的软件、检查可用更新。安装新软件请前往「应用市场」，或用 AI 助手描述需求。</p>
                <button class="btn primary" id="btn-load-pkgs">${UI.icon('package', 15)} 读取已安装软件</button>
              </div>
            </div>`;
          body.querySelector('#btn-load-pkgs').addEventListener('click', () => loadPackages(true));
          return;
        }

        const all = installed.packages || [];
        const q = installedFilter.trim().toLowerCase();
        const list = q
          ? all.filter((p) => `${p.name} ${p.summary || ''}`.toLowerCase().includes(q))
          : all;
        const upg = (upgrades && upgrades.packages) || [];
        const shown = list.slice(0, 200);

        body.innerHTML = `
          <div class="stat-grid">
            <div class="stat-card"><span class="stat-label">已安装</span><strong class="stat-value">${all.length}</strong><span class="stat-hint">${installed.demo ? '预览数据' : '来自系统包管理器'}</span></div>
            <div class="stat-card"><span class="stat-label">可更新</span><strong class="stat-value">${upg.length}</strong><span class="stat-hint">${upg.length ? '建议定期更新' : '已是最新'}</span></div>
            <div class="stat-card"><span class="stat-label">包管理方式</span><strong class="stat-value" style="font-size:20px">${UI.escapeHtml(ctx.info.familyLabel || ctx.info.family || installed.family || '未知')}</strong><span class="stat-hint">${UI.escapeHtml(ctx.info.prettyName || '')}</span></div>
          </div>

          <div class="card mt-16">
            <div class="card-head">
              <h3>可更新软件</h3>
              <button class="btn sm ${upg.length ? 'primary' : ''}" id="btn-upgrade" ${upg.length ? '' : 'disabled'}>${UI.icon('refresh', 13)} 全部升级</button>
            </div>
            <div class="card-body" id="pkg-content">
              ${upg.length
                ? `<div class="chip-row">${upg.slice(0, 40).map((p) => `<span class="tag">${UI.escapeHtml(p.name)}${p.current ? ` ${UI.escapeHtml(p.current)} → ` : ' → '}${UI.escapeHtml(p.next || '')}</span>`).join('')}</div>`
                : `<p class="text-muted" style="margin:0">暂无可更新项，或者还没同步软件源。</p>`}
              <div class="btn-row mt-12">
                <button class="btn sm ghost" id="btn-update-index">${UI.icon('download', 13)} 同步软件源</button>
              </div>
            </div>
          </div>

          <div class="card mt-16">
            <div class="card-head">
              <h3>已安装软件（${list.length}）</h3>
              <div class="btn-row">
                <input class="input sm" id="pkg-filter" placeholder="筛选名称…" value="${UI.escapeHtml(installedFilter)}" style="width:180px" />
                <button class="btn sm ghost" id="btn-reload">${UI.icon('refresh', 13)} 刷新</button>
              </div>
            </div>
            <div class="card-body">
              <div class="table-like">
                ${shown
                  .map(
                    (p) => `
                  <div class="pkg-row">
                    <div class="list-item-main">
                      <strong>${UI.escapeHtml(p.name)}</strong>
                      <span>${UI.escapeHtml(p.summary || p.source || '系统软件包')}</span>
                    </div>
                    <code class="pkg-ver">${UI.escapeHtml(p.version || '')}</code>
                    <button class="btn sm ghost" data-remove="${UI.escapeHtml(p.name)}">卸载</button>
                  </div>`
                  )
                  .join('')}
              </div>
              ${list.length > shown.length ? `<p class="text-sm text-muted mt-12">仅显示前 ${shown.length} 个，输入关键字可继续筛选。</p>` : ''}
            </div>
          </div>
        `;

        const filter = body.querySelector('#pkg-filter');
        let timer = null;
        filter.addEventListener('input', () => {
          const value = filter.value;
          clearTimeout(timer);
          timer = setTimeout(() => {
            installedFilter = value;
            renderPackages();
            const input = body.querySelector('#pkg-filter');
            if (input) {
              input.focus();
              input.setSelectionRange(input.value.length, input.value.length);
            }
          }, 220);
        });

        body.querySelector('#btn-reload').addEventListener('click', () => loadPackages(true));
        body.querySelector('#btn-update-index').addEventListener('click', async () => {
          log.clear();
        logHost.hidden = true;
          UI.toast('正在同步软件源…', 'info');
          try {
            const res = await window.lh.call('pkg:update-index');
            UI.toast(res.ok ? '软件源已同步' : '同步失败，请查看日志', res.ok ? 'success' : 'error');
            loadPackages(true);
          } catch (err) {
            UI.toast('同步失败', 'error');
            writeLog(String(err.message || err));
          }
        });
        const upBtn = body.querySelector('#btn-upgrade');
        if (upBtn) {
          upBtn.addEventListener('click', async () => {
            const ok = await UI.confirmDialog({
              title: '升级所有软件',
              message: `将升级 ${upg.length} 个软件包，可能需要管理员授权，过程可能需要几分钟。`,
              confirmText: '开始升级'
            });
            if (!ok) return;
            log.clear();
        logHost.hidden = true;
            UI.toast('正在升级，请稍候…', 'info');
            try {
              const res = await window.lh.call('pkg:upgrade');
              UI.toast(res.ok ? '升级完成' : '升级未完成，请查看日志', res.ok ? 'success' : 'warn');
            } catch (err) {
              UI.toast('升级失败', 'error');
            }
            loadPackages(true);
          });
        }
        body.querySelectorAll('[data-remove]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            const name = btn.dataset.remove;
            const ok = await UI.confirmDialog({
              title: `卸载 ${name}`,
              message: '卸载系统软件包可能影响依赖它的其他软件，是否继续？（仅卸载该软件，不会 purge 配置）',
              danger: true,
              confirmText: '卸载'
            });
            if (!ok) return;
            log.clear();
        logHost.hidden = true;
            try {
              const res = await window.lh.call('pkg:remove', { packages: [name], purge: false });
              UI.toast(res.ok ? `${name} 已卸载` : '卸载未完成，请查看日志', res.ok ? 'success' : 'warn');
            } catch (err) {
              UI.toast('卸载失败', 'error');
            }
            loadPackages(true);
          })
        );
      }

      renderCleanup();
      loadScan();

      this.unmount = () => {
        offCleanup();
        offPkg();
      };
    }
  };
})();