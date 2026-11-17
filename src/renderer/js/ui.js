'use strict';

(function () {
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/><path d="M5 15l.6 1.6L7.2 17l-1.6.6L5 19.2 4.4 17.6 2.8 17l1.6-.4L5 15Z"/>',
    store: '<path d="M4 9h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.3-2.3 2.6-2.6Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-8-8-4L21 3Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
    check: '<path d="m4 12.5 5 5L20 6.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6.5Z"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    drive: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 8.5h.01M11 8.5h6"/><path d="M7 15h10"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m16 4 4 4"/><path d="m14 6 3 3"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    play: '<path d="M7 4.5v15l13-7.5-13-7.5Z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    package: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.6 6.6 0 0 0 20 14.5Z"/>',
    shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    file: '<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M13 3v6h6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h1.2a2.3 2.3 0 0 0 0-4.6H12a2 2 0 0 1 0-4h4.5A3.5 3.5 0 0 0 20 9 9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="11" cy="7" r="1"/><circle cx="15.5" cy="8.5" r="1"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10.5 20a2 2 0 0 0 3 0"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>'
  };

  function icon(name, size = 18) {
    const body = ICONS[name] || ICONS.info;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      if (el.dataset.iconDone) return;
      el.innerHTML = icon(el.dataset.icon, Number(el.dataset.iconSize) || 18);
      el.dataset.iconDone = '1';
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    const value = n / 1024 ** i;
    return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
  }

  function fmtUptime(seconds) {
    const s = Math.floor(Number(seconds) || 0);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d} 天 ${h} 小时`;
    if (h > 0) return `${h} 小时 ${m} 分`;
    return `${m} 分钟`;
  }

  function fmtTime(ms) {
    const date = new Date(Number(ms) || Date.now());
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 86400000 * 30) return `${Math.floor(diff / 86400000)} 天前`;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  /* -------------------------------- Markdown -------------------------------- */
  function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return out;
  }

  function md(source) {
    let text = String(source == null ? '' : source);
    const codes = [];
    text = text.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_m, code) => {
      codes.push(code.replace(/\n$/, ''));
      return `\u0000CODE${codes.length - 1}\u0000`;
    });

    const lines = text.split(/\n/);
    const html = [];
    let list = null;
    let para = [];
    const flushPara = () => {
      if (para.length) {
        html.push(`<p>${para.map(inline).join('<br>')}</p>`);
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
        list = null;
      }
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) {
        flushPara();
        flushList();
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushPara();
        flushList();
        const level = Math.min(heading[1].length + 2, 6);
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }
      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (ordered || bullet) {
        flushPara();
        const tag = ordered ? 'ol' : 'ul';
        if (!list || list.tag !== tag) {
          flushList();
          list = { tag, items: [] };
        }
        list.items.push((ordered || bullet)[1]);
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara();
    flushList();

    let out = html.join('');
    out = out.replace(/\u0000CODE(\d+)\u0000/g, (_m, index) => `<pre><code>${escapeHtml(codes[Number(index)])}</code></pre>`);
    return out;
  }

  /* --------------------------------- 复制 --------------------------------- */
  async function copy(text) {
    const value = String(text == null ? '' : text);
    try {
      await navigator.clipboard.writeText(value);
      toast('已复制到剪贴板', 'success');
      return true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        toast('已复制到剪贴板', 'success');
        return true;
      } catch {
        toast('复制失败，请手动选择文本', 'error');
        return false;
      }
    }
  }

  function codeBlock(code, desc) {
    return `<div class="cmd-item">
      ${desc ? `<div class="cmd-desc">${escapeHtml(desc)}</div>` : ''}
      <div class="code"><button class="copy-btn" data-copy="${escapeHtml(code)}">复制</button>${escapeHtml(code)}</div>
    </div>`;
  }

  /* --------------------------------- Toast --------------------------------- */
  function toast(message, kind = 'info', timeout = 3200) {
    const root = document.getElementById('toasts');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const iconName = kind === 'success' ? 'check' : kind === 'error' ? 'x' : 'info';
    el.innerHTML = `${icon(iconName, 16)}<span>${escapeHtml(message)}</span>`;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 260);
    }, timeout);
  }

  /* --------------------------------- Modal --------------------------------- */
  function modal(options) {
    const { title, subtitle, body, actions = [{ label: '关闭', value: false, kind: 'ghost' }], width } = options;
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `
        <div class="modal" ${width ? `style="width:min(${width}px,100%)"` : ''} role="dialog" aria-modal="true">
          <div class="modal-head">
            <div>
              <h3>${escapeHtml(title || '')}</h3>
              ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
            </div>
            <button class="icon-button" data-close style="width:30px;height:30px">${icon('x', 15)}</button>
          </div>
          <div class="modal-body">${body || ''}</div>
          <div class="modal-foot">
            ${actions
              .map(
                (action, index) =>
                  `<button class="btn ${action.kind || 'ghost'} ${action.size || ''}" data-action="${index}">${escapeHtml(action.label)}</button>`
              )
              .join('')}
          </div>
        </div>`;
      const close = (value) => {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        resolve(value);
      };
      const onKey = (event) => {
        if (event.key === 'Escape') close(false);
      };
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) close(false);
        if (event.target.closest('[data-close]')) close(false);
        const btn = event.target.closest('[data-action]');
        if (btn) {
          const action = actions[Number(btn.dataset.action)];
          if (action && typeof action.onClick === 'function') {
            const result = action.onClick(backdrop);
            if (result instanceof Promise) {
              btn.disabled = true;
              result.then((value) => {
                btn.disabled = false;
                if (value !== undefined) close(value);
              });
            } else if (result !== false) {
              close(action.value !== undefined ? action.value : true);
            }
          } else {
            close(action ? (action.value !== undefined ? action.value : true) : true);
          }
        }
      });
      document.addEventListener('keydown', onKey);
      root.appendChild(backdrop);
    });
  }

  function confirmDialog(options) {
    const { title, message, confirmText = '确认', cancelText = '取消', danger = false, extra = '' } = options;
    return modal({
      title,
      body: `<p style="margin:0">${escapeHtml(message)}</p>${extra}`,
      actions: [
        { label: cancelText, value: false, kind: 'ghost' },
        { label: confirmText, value: true, kind: danger ? 'danger' : 'primary' }
      ]
    });
  }

  /* -------------------------------- 日志面板 -------------------------------- */
  function createLog() {
    const el = document.createElement('div');
    el.className = 'progress-log';
    el.textContent = '';
    return {
      el,
      append(line, kind) {
        const span = document.createElement('div');
        if (kind === 'error' || kind === 'err') span.className = 'err';
        span.textContent = line;
        el.appendChild(span);
        el.scrollTop = el.scrollHeight;
      },
      clear() {
        el.textContent = '';
      }
    };
  }

  function busy(target, text = '加载中…') {
    target.innerHTML = `<div class="loading-row"><span class="spinner"></span><span>${escapeHtml(text)}</span></div>`;
  }

  function empty(iconName, title, description) {
    return `<div class="empty"><div class="empty-icon">${iconName}</div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description || '')}</p></div>`;
  }

  function on(root, selector, eventName, handler) {
    root.addEventListener(eventName, (event) => {
      const target = event.target.closest(selector);
      if (target && root.contains(target)) handler(event, target);
    });
  }

  // 全局复制按钮
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-copy]');
    if (btn) {
      event.preventDefault();
      copy(btn.dataset.copy);
    }
    const link = event.target.closest('a[data-external]');
    if (link) {
      event.preventDefault();
      window.lh.call('system:open-external', { url: link.dataset.external });
    }
  });

  window.UI = {
    icon,
    hydrateIcons,
    escapeHtml,
    fmtBytes,
    fmtUptime,
    fmtTime,
    md,
    copy,
    codeBlock,
    toast,
    modal,
    confirmDialog,
    createLog,
    busy,
    empty,
    on
  };
})();