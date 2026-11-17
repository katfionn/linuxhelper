#!/bin/sh
# deb 卸载后刷新图标缓存与 desktop 数据库，避免残留已删除图标的缓存条目。
set -e

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications >/dev/null 2>&1 || true
fi

exit 0
