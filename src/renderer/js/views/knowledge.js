'use strict';

(function () {
  window.LHViews = window.LHViews || {};

  window.LHViews.knowledge = {
    title: 'Linux 知识',
    subtitle: '把命令行和系统概念讲成人话',

    async mount(root) {
      let meta = null;
      let category = 'all';
      let query = '';
      let current = null;
      let loadingArticle = false;

      root.innerHTML = `
        <div class="banner info">
          ${UI.icon('book', 15)}
          <span>面向从 Windows 转过来的用户编写：每个概念都配了对比、命令与常见坑。搜不到答案时，可以直接去「AI 助手」提问。</span>
        </div>
        <div class="toolbar mt-16" style="justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div class="chip-row" id="cat-row"></div>
          <input class="input" id="kb-search" placeholder="搜索知识点，如 权限、flatpak、输入法…" style="max-width:300px" />
        </div>
        <div id="kb-body" class="mt-16"><div class="loading-row"><span class="spinner"></span><span>正在加载知识库…</span></div></div>
      `;

      const body = root.querySelector('#kb-body');
      const catRow = root.querySelector('#cat-row');
      const searchInput = root.querySelector('#kb-search');

      try {
        meta = await window.lh.call('data:knowledge');
      } catch (err) {
        body.innerHTML = `<div class="banner danger">加载失败：${UI.escapeHtml(String(err.message || err))}</div>`;
        return;
      }

      function renderCats() {
        const cats = [{ id: 'all', name: '全部', icon: '🗂️' }, ...(meta.categories || [])];
        catRow.innerHTML = cats
          .map(
            (c) =>
              `<button class="chip chip-button ${c.id === category ? 'active' : ''}" data-cat="${UI.escapeHtml(c.id)}">${UI.escapeHtml(c.icon || '')} ${UI.escapeHtml(c.name)}</button>`
          )
          .join('');
        catRow.querySelectorAll('[data-cat]').forEach((btn) =>
          btn.addEventListener('click', () => {
            category = btn.dataset.cat;
            current = null;
            renderCats();
            renderList();
          })
        );
      }

      function catName(id) {
        const c = (meta.categories || []).find((x) => x.id === id);
        return c ? `${c.icon || ''} ${c.name}` : '综合';
      }

      function renderList() {
        const q = query.trim().toLowerCase();
        const articles = (meta.articles || []).filter((a) => {
          const matchCat = category === 'all' || a.category === category;
          const matchQuery = !q || `${a.title} ${a.summary} ${(a.tags || []).join(' ')}`.toLowerCase().includes(q);
          return matchCat && matchQuery;
        });

        body.innerHTML = `
          <div class="section-title">
            <div><h2>${category === 'all' ? '全部知识' : UI.escapeHtml(catName(category))}</h2><p>${articles.length} 篇文章 · 共 ${meta.articleCount} 篇</p></div>
          </div>
          ${
            articles.length
              ? `<div class="kb-grid">
                  ${articles
                    .map(
                      (a) => `
                    <button class="kb-card" data-article="${UI.escapeHtml(a.id)}">
                      <div class="kb-card-top">
                        <span class="tag">${UI.escapeHtml(catName(a.category))}</span>
                        <span class="tag ${a.level === '进阶' ? 'warn' : 'ok'}">${UI.escapeHtml(a.level || '入门')}</span>
                      </div>
                      <strong>${UI.escapeHtml(a.title)}</strong>
                      <p>${UI.escapeHtml(a.summary || '')}</p>
                      <div class="kb-card-foot">
                        <span class="text-sm text-muted">约 ${a.readMinutes || 3} 分钟</span>
                        <span class="text-sm text-muted">阅读 →</span>
                      </div>
                    </button>`
                    )
                    .join('')}
                </div>`
              : UI.empty('📚', '没有匹配的文章', '换个关键词，或切换到其他分类试试')
          }
        `;

        body.querySelectorAll('[data-article]').forEach((btn) =>
          btn.addEventListener('click', () => openArticle(btn.dataset.article))
        );
      }

      async function openArticle(id) {
        if (loadingArticle) return;
        loadingArticle = true;
        body.innerHTML = `<div class="loading-row"><span class="spinner"></span><span>正在打开文章…</span></div>`;
        try {
          current = await window.lh.call('data:article', { id });
        } catch {
          current = null;
        } finally {
          loadingArticle = false;
        }
        if (!current) {
          body.innerHTML = `<div class="banner danger">文章不存在或已被移除</div>`;
          return;
        }
        renderArticle();
      }

      function renderArticle() {
        const a = current;
        body.innerHTML = `
          <div class="toolbar" style="justify-content:space-between">
            <button class="btn sm ghost" id="btn-back">${UI.icon('back', 14)} 返回列表</button>
            <div class="btn-row">
              <button class="btn sm ghost" id="btn-ask-ai">${UI.icon('sparkles', 14)} 问 AI 更细的问题</button>
            </div>
          </div>
          <article class="article">
            <div class="article-head">
              <div class="chip-row">
                <span class="tag">${UI.escapeHtml(catName(a.category))}</span>
                <span class="tag ${a.level === '进阶' ? 'warn' : 'ok'}">${UI.escapeHtml(a.level || '入门')}</span>
                <span class="tag">约 ${a.readMinutes || 3} 分钟</span>
              </div>
              <h2>${UI.escapeHtml(a.title)}</h2>
              <p class="article-summary">${UI.escapeHtml(a.summary || '')}</p>
            </div>
            <div class="article-body md">${UI.md(a.body || '')}</div>
            ${
              (a.commands || []).length
                ? `<div class="article-commands">
                    <h3>${UI.icon('terminal', 16)} 动手试试</h3>
                    ${a.commands.map((c) => UI.codeBlock(c.cmd, c.desc)).join('')}
                  </div>`
                : ''
            }
            <div class="article-foot">
              ${(a.tags || []).map((t) => `<span class="tag">#${UI.escapeHtml(t)}</span>`).join('')}
            </div>
          </article>
        `;

        body.querySelector('#btn-back').addEventListener('click', () => {
          current = null;
          renderList();
        });
        body.querySelector('#btn-ask-ai').addEventListener('click', () => {
          ctx.App.pendingPrompt = `我在看「${a.title}」，还有几个细节不太明白：`;
          ctx.navigate('ai');
        });
        body.querySelectorAll('[data-copy]').forEach((btn) =>
          btn.addEventListener('click', () => UI.copy(btn.dataset.copy))
        );
      }

      searchInput.addEventListener('input', () => {
        query = searchInput.value;
        current = null;
        renderList();
      });

      renderCats();
      renderList();
      this.unmount = () => {};
    }
  };
})();