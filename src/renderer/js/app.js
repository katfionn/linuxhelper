'use strict';

(function () {
  const ROUTES = ['home', 'ai', 'store', 'files', 'knowledge', 'maintenance', 'settings'];

  const App = {
    info: null,
    settings: null,
    current: null,
    cleanup: null,
    pendingPrompt: '',
    storeTab: 'apps',
    openArticleId: null,
    aiApprovalHandler: null,

    async init() {
      this.bindChrome();
      try {
        const [info, settings] = await Promise.all([window.lh.call('system:info'), window.lh.call('settings:get')]);
        this.info = info;
        this.settings = settings;
      } catch (err) {
        document.getElementById('view').innerHTML = `<div class="banner danger">初始化失败：${UI.escapeHtml(err.message || err)}</div>`;
        return;
      }
      this.applyTheme();
      this.renderChrome();
      window.addEventListener('hashchange', () => this.route());
      window.lh.on('ui:navigate', (route) => {
        window.location.hash = `#/${route}`;
      });
      window.lh.on('ai:approval', (payload) => {
        if (this.aiApprovalHandler) this.aiApprovalHandler(payload);
      });
      this.route();
    },

    bindChrome() {
      const go = (target) => {
        if (window.location.hash === `#/${target}`) this.route();
        else window.location.hash = `#/${target}`;
      };
      document.getElementById('btn-settings').addEventListener('click', () => {
        go('settings');
      });
      document.getElementById('provider-chip').addEventListener('click', () => {
        App.settingsTab = 'ai';
        go('settings');
      });
      UI.hydrateIcons(document);
    },

    async refreshSettings() {
      try {
        this.settings = await window.lh.call('settings:get');
        this.applyTheme();
        this.renderChrome();
      } catch {
        /* ignore */
      }
    },

    applyTheme() {
      const theme = (this.settings && this.settings.general && this.settings.general.theme) || 'dark';
      const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = resolved;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'light' ? '#f3f6fb' : '#070b10');

      const zoom = Number(this.settings && this.settings.general && this.settings.general.zoom) || 1;
      document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);
    },

    renderChrome() {
      const info = this.info || {};
      const distroName = info.demo ? '预览模式（非 Linux）' : info.prettyName || info.name || 'Linux';
      const el = document.getElementById('distro-name');
      if (el) el.textContent = distroName.length > 22 ? `${distroName.slice(0, 21)}…` : distroName;
      document.getElementById('demo-banner').hidden = !info.demo;

      const settings = this.settings;
      if (settings) {
        const active = (settings.ai.providers || []).find((p) => p.id === settings.ai.activeProviderId) || (settings.ai.providers || [])[0];
        const label = document.getElementById('provider-label');
        const dot = document.getElementById('provider-dot');
        if (active) {
          const configured = active.hasKey || active.kind === 'local' || /localhost|127\.0\.0\.1/.test(active.baseUrl);
          label.textContent = `${active.name} · ${active.model}`;
          dot.className = `pulse-dot ${configured ? '' : 'warn'}`;
        } else {
          label.textContent = '未配置 AI';
          dot.className = 'pulse-dot off';
        }
      }
    },

    route() {
      const hash = window.location.hash.replace(/^#\/?/, '');
      const [name, queryString] = hash.split('?');
      const route = ROUTES.includes(name) ? name : 'home';
      const params = new URLSearchParams(queryString || '');
      const view = window.LHViews[route];
      if (!view) return;

      if (this.current && typeof this.current.unmount === 'function') {
        try {
          this.current.unmount();
        } catch {
          /* ignore */
        }
      }
      this.current = view;

      document.querySelectorAll('#nav .nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.route === route);
      });

      document.getElementById('page-title').textContent = view.title || '';
      document.getElementById('page-sub').textContent = view.subtitle || '';
      // 每次切换页面都换一个全新的 #view 容器：
      // 旧页面里尚未完成的异步渲染只会写进已脱离文档的旧容器，不会覆盖新页面。
      const previous = document.getElementById('view');
      const root = previous.cloneNode(false);
      previous.replaceWith(root);
      root.scrollTop = 0;

      const ctx = {
        App,
        info: this.info,
        settings: this.settings,
        params,
        navigate: (to) => {
          window.location.hash = `#/${to}`;
        },
        refreshSettings: () => this.refreshSettings(),
        toast: UI.toast,
        confirm: UI.confirmDialog
      };

      Promise.resolve(view.mount(root, ctx)).catch((err) => {
        root.innerHTML = `<div class="banner danger">页面加载失败：${UI.escapeHtml(err.message || err)}</div>`;
      });
    }
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', () => App.init());
})();