#!/usr/bin/env node
/**
 * 把 electron-builder 的 linux-unpacked 目录打成可上机测试的便携 tar.gz。
 *
 * Windows 上没有 Linux 的 fpm/appimagetool，无法直接产出 AppImage/deb；
 * 但 Linux 版 Electron 的二进制可以正常跨平台解包。Windows 文件系统不带
 * POSIX 权限位，直接打 tar 会丢失可执行位，因此这里按文件名显式写回权限：
 *   - linuxhelper / chrome_crashpad_handler : 0755
 *   - chrome-sandbox                        : 4755
 *   - 其余文件                              : 0644
 *   - 目录                                  : 0755
 *
 * 用法（在项目根目录）：
 *   node tools/pack-linux-portable.mjs [arch]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { create } from 'tar';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const args = process.argv.slice(2);
const srcIndex = args.indexOf('--src');
const srcDir = srcIndex >= 0 && args[srcIndex + 1] ? args[srcIndex + 1] : join('dist', 'linux-unpacked');
const arch = args.find((item, index) => !item.startsWith('--') && index !== srcIndex + 1) || 'x64';
const exeName = pkg.build?.linux?.executableName || pkg.name;
const exePath = join(srcDir, exeName);
const topName = `${pkg.build?.productName || pkg.productName || pkg.name}-${pkg.version}-${arch}`;
const outFile = join('dist', `${topName}-portable.tar.gz`);
const readmeName = 'README-portable.txt';

if (!existsSync(exePath)) {
  console.error(`找不到 ${exePath}，请先执行：npx electron-builder --linux dir --${arch} --publish never`);
  process.exit(1);
}

const readme = `LinuxHelper ${pkg.version} 便携测试版（Linux ${arch}）

1. 解压
   tar -xzf ${basename(outFile)}

2. 启动
   ./${topName}/${exeName}

（可执行文件名是全小写 ${exeName}，Linux 区分大小写）

3. 如果启动时报 SUID sandbox / chrome-sandbox 错误
   本机未启用非特权 user namespace 时，可临时使用：
   ./${topName}/${exeName} --no-sandbox

   请用桌面登录的普通用户启动。在 root shell 里运行（su 不继承会话总线）会出现
   "Failed to connect to the bus"，通知/托盘不可用，且必须加 --no-sandbox；确需 root 时：
   dbus-run-session -- ./${topName}/${exeName} --no-sandbox

   虚拟机没有 3D/VA-API 时的 "No 3D enabled"、"vaInitialize failed" 属正常降级，
   若黑屏/白屏可加 --disable-gpu。

4. 数据位置（Linux）
   ~/.local/share/linux-assistant
   ~/.cache/linux-assistant
   ~/.config/linux-assistant

5. 这是便携包，不是系统安装包。
   正式 AppImage / deb / pacman 包请在 Linux 机器上执行：
   npm install
   npm run dist:linux

6. 同时提供 .sha256 校验文件：
   sha256sum -c ${basename(outFile)}.sha256
`;
const readmePath = join(srcDir, readmeName);
writeFileSync(readmePath, readme, 'utf8');

const isExec = new Set([exeName, 'chrome_crashpad_handler']);
function modeFor(rel, type) {
  if (type === 'Directory') return 0o755;
  if (rel === 'chrome-sandbox') return 0o4755;
  if (isExec.has(rel)) return 0o755;
  return 0o644;
}

try {
  await create(
    {
      file: outFile,
      cwd: dirname(srcDir),
      gzip: { level: 9 },
      portable: true,
      onWriteEntry: (entry) => {
        const raw = entry.path.split(/[\\/]+/).join('/').replace(/\/+$/, '');
        const root = basename(srcDir);
        const rel = raw === root ? '' : raw.replace(new RegExp(`^${root}/`), '');
        entry.path = rel ? `${topName}/${rel}` : `${topName}/`;
        entry.stat.mode = modeFor(rel, entry.type);
      }
    },
    [basename(srcDir)]
  );
} finally {
  rmSync(readmePath, { force: true });
}

const hash = createHash('sha256').update(readFileSync(outFile)).digest('hex');
writeFileSync(`${outFile}.sha256`, `${hash}  ${basename(outFile)}\n`);
const size = statSync(outFile).size;
console.log(`已生成 ${outFile}`);
console.log(`  大小 ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  SHA256 ${hash}`);
console.log(`  解压后运行 ./${topName}/${exeName}`);
console.log(`  目录内容示例：\n${relative('.', srcDir)}${sep}${readmeName}`);
console.log(`  校验：sha256sum -c ${basename(outFile)}.sha256`);