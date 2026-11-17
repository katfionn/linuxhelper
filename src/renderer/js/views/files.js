'use strict';

(function () {
  window.LHViews = window.LHViews || {};

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatTime(ms) {
    if (!ms) return '';
    const date = new Date(ms);
    const diff = Date.now() - ms;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function fileEmoji(item) {
    if (item.isDir) return '📁';
    const ext = (item.name.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '🎬';
    if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) return '🎵';
    if (['zip', 'tar', 'gz', 'xz', '7z', 'zst'].includes(ext)) return '🗜️';
    if (['pdf'].includes(ext)) return '📕';
    if (['doc', 'docx', 'odt'].includes(ext)) return '📝';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
    if (['sh', 'py', 'js', 'ts', 'c', 'cpp', 'rs', 'go', 'json', 'yml', 'yaml', 'toml', 'conf'].includes(ext)) return '⌨️';
    if (['deb', 'rpm', 'pkg', 'appimage'].includes(ext)) return '📦';
    return '📄';
  }

  function copyText(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      UI.toast('路径已复制', 'success');
    } catch {
      UI.toast('复制失败，请手动选择文本', 'error');
    }
    document.body.removeChild(area);
  }

  window.LHViews.files = {
    title: '文件查找',
    subtitle: '快速定位家目录中的文件和文件夹',

    async mount(root, ctx) {
      const shortcuts = await window.lh.call('files:shortcuts').catch(() => []);
      let dir = (shortcuts[0] && shortcuts[0].path) || '';
      let kind = 'any';
      let query = '';
      let results = null;
      let engine = '';
      let note = '';
      let demo = false;
      let truncated = false;
      let loading = false;
      let lastMs = 0;

      root.innerHTML = `
        <div class="card">
          <div class="card-body">
            <div class="search-hero">
              <div class="search-box">
                ${UI.icon('search', 18)}
                <input id="file-query" class="input" placeholder="输入文件名关键字，例如 报告、.pdf、screenshot（回车搜索）" autocomplete="off" />
                <button class="btn primary" id="btn-search">搜索</button>
              </div>
              <div class="toolbar mt-12" style="justify-content:space-between">
                <div class="chip-row">
                  ${shortcuts.map((s) => `<button class="chip chip-button" data-dir="${UI.escapeHtml(s.path)}">${UI.escapeHtml(s.label)}</button>`).join('')}
                </div>
                <div class="seg">
                  <button class="seg-item active" data-kind="any">全部</button>
                  <button class="seg-item" data-kind="file">文件</button>
                  <button class="seg-item" data-kind="dir">文件夹</button>
                </div>
              </div>
              <div class="path-bar mt-12">
                <span class="text-sm text-muted">搜索范围：</span>
                <code id="dir-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${UI.escapeHtml(dir || '家目录')}</code>
                <span class="tag" id="engine-chip" hidden></span>
              </div>
            </div>
          </div>
        </div>

        <div id="results" class="mt-16">
          <div class="empty">${UI.icon('search', 26)}<strong>输入关键字开始查找</strong><p>优先使用 fd（极速），未安装时自动回退到 find。范围限制在你的家目录内。</p></div>
        </div>
      `;

      const resultsEl = root.querySelector('#results');
      const dirLabel = root.querySelector('#dir-label');
      const engineChip = root.querySelector('#engine-chip');
      const queryInput = root.querySelector('#file-query');

      function markDirChips() {
        root.querySelectorAll('[data-dir]').forEach((btn) => btn.classList.toggle('active', btn.dataset.dir === dir));
      }
      markDirChips();

      root.querySelectorAll('[data-dir]').forEach((btn) =>
        btn.addEventListener('click', () => {
          dir = btn.dataset.dir;
          dirLabel.textContent = dir;
          markDirChips();
          if (query.trim()) doSearch();
        })
      );
      root.querySelectorAll('[data-kind]').forEach((btn) =>
        btn.addEventListener('click', () => {
          kind = btn.dataset.kind;
          root.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('active', b === btn));
          if (query.trim()) doSearch();
        })
      );

      root.querySelector('#btn-search').addEventListener('click', () => doSearch());
      queryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
      });

      async function doSearch() {
        query = queryInput.value.trim();
        if (!query) {
          resultsEl.innerHTML = `<div class="empty">${UI.icon('search', 26)}<strong>请输入关键字</strong><p>试试输入扩展名，如 .pdf、.jpg，或者输入文件名的部分内容。</p></div>`;
          return;
        }
        if (loading) return;
        loading = true;
        const started = performance.now();
        resultsEl.innerHTML = `<div class="loading-row"><span class="spinner"></span><span>正在搜索「${UI.escapeHtml(query)}」…</span></div>`;
        try {
          const res = await window.lh.call('files:search', { query, dir, kind, limit: 100 });
          lastMs = Math.round(performance.now() - started);
          results = res.results || [];
          engine = res.engine || '';
          note = res.note || '';
          demo = Boolean(res.demo);
          truncated = Boolean(res.truncated);
          engineChip.hidden = !engine;
          engineChip.textContent = `搜索引擎：${engine}`;
          renderResults();
        } catch (err) {
          resultsEl.innerHTML = `<div class="banner danger">搜索失败：${UI.escapeHtml(String(err.message || err))}</div>`;
        } finally {
          loading = false;
        }
      }

      function renderResults() {
        if (!results) return;
        const header = `
          <div class="toolbar" style="justify-content:space-between">
            <div class="text-sm text-muted">找到 <b>${results.length}</b> 个结果 · 用时 ${lastMs} ms ${demo ? ' · 预览数据' : ''}</div>
            <div class="btn-row">
              ${results.length ? `<button class="btn sm ghost" id="btn-open-dir">${UI.icon('folder', 13)} 打开当前目录</button>` : ''}
            </div>
          </div>`;

        resultsEl.innerHTML =
          header +
          (note ? `<div class="banner warn mt-12">${UI.icon('info', 15)}<span>${UI.escapeHtml(note)}</span></div>` : '') +
          (truncated ? `<div class="banner info mt-12">${UI.icon('info', 15)}<span>结果较多，仅显示前 ${results.length} 条。可以补充更精确的关键字。</span></div>` : '') +
          (results.length
            ? `<div class="list mt-12">
                ${results
                  .map(
                    (item, index) => `
                  <div class="list-item file-row" data-path="${UI.escapeHtml(item.path)}">
                    <div class="file-icon">${fileEmoji(item)}</div>
                    <div class="list-item-main">
                      <strong>${UI.escapeHtml(item.name)}</strong>
                      <span>${UI.escapeHtml(item.dir)} · ${item.isDir ? '文件夹' : formatSize(item.size)} · ${formatTime(item.mtime)}</span>
                    </div>
                    <div class="btn-row">
                      <button class="btn sm ghost" data-copy="${index}" title="复制路径">复制路径</button>
                      <button class="btn sm ghost" data-reveal="${index}" title="在文件管理器中显示">定位</button>
                      <button class="btn sm" data-open="${index}">${item.isDir ? '打开' : '用默认程序打开'}</button>
                    </div>
                  </div>`
                  )
                  .join('')}
              </div>`
            : `<div class="empty mt-16">${UI.icon('search', 26)}<strong>没有找到匹配的文件</strong><p>试试更短的关键字、切换搜索范围，或把「全部」切换为文件类型。</p></div>`);

        const openDirBtn = resultsEl.querySelector('#btn-open-dir');
        if (openDirBtn) openDirBtn.addEventListener('click', () => openPath(dir));

        resultsEl.querySelectorAll('[data-open]').forEach((btn) =>
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const item = results[Number(btn.dataset.open)];
            if (!item) return;
            const res = await window.lh.call('files:open', { path: item.path });
            if (!res.ok && res.error) UI.toast(res.error, 'error');
          })
        );
        resultsEl.querySelectorAll('[data-reveal]').forEach((btn) =>
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const item = results[Number(btn.dataset.reveal)];
            if (!item) return;
            await window.lh.call('files:reveal', { path: item.path });
          })
        );
        resultsEl.querySelectorAll('[data-copy]').forEach((btn) =>
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = results[Number(btn.dataset.copy)];
            if (item) copyText(item.path);
          })
        );
      }

      async function openPath(target) {
        const res = await window.lh.call('files:open', { path: target });
        if (!res.ok && res.error) UI.toast(res.error, 'error');
      }

      queryInput.focus();
      this.unmount = () => {};
    }
  };
})();