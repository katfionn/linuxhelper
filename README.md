<div align="center">
  <img src="https://github.com/user-attachments/assets/40654c16-065a-4a26-93ce-70c874ded156" width="112" height="112" alt="LinuxHelper" />
  <h1>LinuxHelper · Linux 使用助手</h1>
  <p>
    <strong>把发行版信息、装软件、找文件、清缓存、查知识收进一个窗口</strong><br />
    面向刚从 Windows 转到 Linux 的桌面用户，可选接入任意 OpenAI 兼容模型
  </p>
</div>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white" />
  <img alt="Linux" src="https://img.shields.io/badge/Linux-x64%20%7C%20arm64-FCC624?logo=linux&logoColor=black" />
  <img alt="License" src="https://img.shields.io/badge/License-MPL--2.0-blue" />
</p>

<p align="center">
  <a href="#功能一览">功能</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#构建与打包">构建</a> ·
  <a href="#ai-配置">AI 配置</a> ·
  <a href="#数据与隐私">数据</a> ·
  <a href="#项目结构">结构</a> ·
  <a href="#测试">测试</a>
</p>

<p align="center">
  <a href="https://github.com/katfionn/linuxhelper/tree/build">项目处于开发阶段，MVP版本请前往Build分支查看</a> 
</p>

---

## 这是什么

LinuxHelper 是一个 Linux 桌面客户端，把新手最常卡住的几件事做成图形界面：看发行版和硬件、按当前包管理器装/卸软件、找大文件、清缓存看日志、查内置知识库。需要更复杂的操作时，可以在内置 AI 助手里描述需求，由模型给出命令——**每条命令都会先展示，确认后才执行**。

应用本身不写入 `/usr`、`/opt`，设置、缓存、日志都在当前用户家目录内；默认不内置任何 API Key，AI 能力完全由你选择的服务商或本地模型提供。

## 功能一览

| 模块 | 能做什么 |
| --- | --- |
| **首页** | 发行版与桌面环境、CPU / 内存 / 磁盘占用、常用工具检测、每日一条 Linux 技巧 |
| **AI 助手** | 多服务商配置、拉取模型列表、连接测试、流式对话；系统操作前必须确认 |
| **应用市场** | 识别 APT / Pacman / DNF / Zypper / APK，搜索、安装、卸载；支持 Flatpak / Snap 等来源提示 |
| **文件查找** | 按文件名搜索、查看目录占用、在文件管理器中打开 |
| **维护** | 清理包缓存与日志、磁盘占用检查、查看系统信息 |
| **知识库** | 内置面向 Windows 用户的 Linux 入门文章，支持关键词搜索 |
| **设置** | 主题、缩放、代理、开机自启、AI 参数、隐私与数据管理 |
| **环境快照** | 把应用数据打包备份、恢复或彻底清除（命令行工具，见下文） |

## 快速开始

**环境要求**：Node.js 20+、npm；Linux 桌面环境（GNOME / KDE / XFCE 等）。在 Windows / macOS 上可以启动「预览模式」查看界面，但不会执行真实的包管理与系统修改。

```bash
git clone https://github.com/<your-name>/linuxhelper.git
cd linuxhelper
npm install
npm run dev      # 开发模式，自动打开开发者工具
```

只想看看界面：

```bash
npm start
```

## 构建与打包

项目有两条打包路径，产物不同，按场景选择。

### 1. 正式安装包（在 Linux 上执行）

```bash
npm install
npm run dist:linux
```

产物输出到 `dist/`：

| 产物 | 架构 | 说明 |
| --- | --- | --- |
| `LinuxHelper-<version>-x64.AppImage` | x64 | 免安装，加执行权限后直接运行 |
| `LinuxHelper-<version>-arm64.AppImage` | arm64 | 同上 |
| `LinuxHelper-<version>-x64.deb` | x64 | Debian / Ubuntu 系 |
| `LinuxHelper-<version>-arm64.deb` | arm64 | 同上 |
| `LinuxHelper-<version>-x64.pacman` | x64 | Arch 系 |

AppImage / deb / pacman 依赖 Linux 打包工具链（`fpm`、`appimagetool` 等），**不能在纯 Windows 主机上生成**。需要先安装对应工具，例如 Debian / Ubuntu：

```bash
sudo apt install -y rpm fakeroot dpkg
```

### 2. 便携测试包（可在 Windows 上产出）

没有 Linux 打包工具链、或只想把程序丢到测试机上跑一趟时，用这条命令：

```bash
npm install
npm run dist:linux:portable
```

它会先用 electron-builder 生成 `dist/linux-unpacked/`，再由 `tools/pack-linux-portable.mjs` 重新打包为：

```
dist/LinuxHelper-<version>-x64-portable.tar.gz
dist/LinuxHelper-<version>-x64-portable.tar.gz.sha256
```

Windows 文件系统没有 POSIX 权限位，脚本会按文件名显式写回权限：

| 文件 | 权限 |
| --- | --- |
| `linuxhelper`、`chrome_crashpad_handler` | `0755` |
| `chrome-sandbox` | `4755` |
| 其他文件 | `0644` |
| 目录 | `0755` |

在 Linux 上运行便携包：

```bash
sha256sum -c LinuxHelper-0.1.0-x64-portable.tar.gz.sha256
tar -xzf LinuxHelper-0.1.0-x64-portable.tar.gz
cd LinuxHelper-0.1.0-x64
./linuxhelper
```

> 可执行文件名是**全小写** `linuxhelper`。Linux 区分大小写，`./linuxHelper` 会报“没有那个文件或目录”。

<details>
<summary><b>启动异常排查（root / 虚拟机 / 容器）</b></summary>

<br />

- **`SUID sandbox helper` 或 `chrome-sandbox` 报错**：说明当前环境不能使用 setuid 沙箱。临时加 `--no-sandbox` 仅用于测试：
  ```bash
  ./linuxhelper --no-sandbox
  ```
- **在 root shell 里启动**：`su` 不会继承桌面会话总线，会出现 `Failed to connect to the bus`，通知与托盘不可用，并且必须加 `--no-sandbox`。建议用桌面登录的普通用户运行；确需 root 时：
  ```bash
  dbus-run-session -- ./linuxhelper --no-sandbox
  ```
- **虚拟机没有 3D / VA-API**：`VMware: No 3D enabled`、`vaInitialize failed` 属于正常降级，Chromium 会退回软件渲染；若出现黑屏/白屏，加 `--disable-gpu`。
- **AI 请求提示证书错误**：确认系统已安装根证书（`sudo apt install ca-certificates`）。

</details>

## AI 配置

1. 打开「设置 → AI」，选择服务商预设。
2. 云端服务填写 API Key；本地服务（Ollama / LM Studio / vLLM）填写地址后可直接使用。
3. 「获取模型」调用 `/models`，「测试连接」发起一次最小请求，「保存配置」会校验接口地址格式。
4. API Key 只写入 `secrets.json`（权限 `0600`），界面只显示掩码，不会随设置导出。

内置预设：OpenAI、DeepSeek、Moonshot、智谱、通义、硅基流动、OpenRouter、Ollama、LM Studio、vLLM，以及自定义 OpenAI 兼容接口。

## 数据与隐私

Linux：

```
~/.local/share/linux-assistant   设置、密钥、会话、运行时、日志
~/.cache/linux-assistant         下载缓存、源缓存、截图
~/.config/linux-assistant        Electron 配置、隔离分区、开机自启
```

Windows 预览模式：

```
%USERPROFILE%\.linux-assistant
%USERPROFILE%\.linux-assistant-cache
%USERPROFILE%\.linux-assistant-config
```

实际路径可在「设置 → 隐私与数据」中查看。卸载应用不会自动删除这些目录，需要清理时使用环境快照工具的 `purge`。

## 环境快照工具

在源码目录执行（需要 Node）：

```bash
npm run env:status
npm run env:pack -- --out ~/LinuxHelper-backup.tar.gz
npm run env:restore -- ~/LinuxHelper-backup.tar.gz --yes
npm run env:purge -- --dry-run
npm run env:purge -- --yes --keep-config
```

- `pack` 默认包含 data、config、cache，可加 `--no-cache`。
- 所有路径都限制在当前用户家目录内；备份文件不能放进被备份的数据目录。
- `purge` 默认清除 data、cache、config；`--keep-config` 保留配置，`--dry-run` 只统计不删除。

## 项目结构

```
.
├── .github/
│   └── workflows/
│       └── build-linux.yml   CI：推 build 分支或打 tag 时出 AppImage / deb / pacman
├── build/
│   └── icon.png              应用图标（打包资源）
├── data/                     内置数据
│   ├── apps.json             应用目录与安装提示
│   ├── knowledge.json        知识库文章
│   ├── personalization.json  个性化选项
│   └── tips.json             每日技巧
├── src/
│   ├── main/                 主进程
│   │   ├── main.js           窗口、菜单、托盘、生命周期
│   │   ├── preload.js        contextBridge 暴露的 window.lh
│   │   ├── ipc.js            IPC 路由
│   │   └── lib/              系统能力：distro / pkgs / exec / files / ai / settings …
│   └── renderer/             渲染层（无构建步骤）
│       ├── index.html
│       ├── css/app.css
│       └── js/
│           ├── app.js        路由与启动
│           ├── ui.js         通用组件与提示
│           └── views/        home / ai / store / files / knowledge / maintenance / settings
├── tests/                    测试代码（node --test 执行，非运行产物）
│   ├── distro.test.js        os-release 解析与包管理器家族识别
│   ├── data.test.js          知识库/技巧加载、搜索、每日索引
│   ├── settings.test.js      设置校验、API Key 掩码与 0600 持久化
│   ├── envpack.test.js       快照 status/pack/purge 与家目录边界（调用 envpack.mjs + 系统 tar）
│   └── fixtures/
│       └── settings-child.cjs  隔离子进程内验证设置读写的辅助脚本
├── tools/                    可执行脚本（由 package.json 调用，不随安装包分发）
│   ├── envpack.mjs           环境快照 CLI：status/pack/restore/purge（产品功能）
│   ├── smoke.mjs             界面冒烟：启动 Electron 依次检查 7 个页面
│   ├── pack-linux-portable.mjs  重打 linux-unpacked 为便携 tar.gz + sha256
│   └── gen-icon.mjs          纯 Node 重新生成 build/icon.png（1024×1024）
├── CONTRIBUTING.md           贡献约定与 MPL-2.0 授权说明
├── LICENSE                   MPL-2.0 许可证原文
├── package.json
└── README.md
```

## 开发脚本

| 命令 | 作用 |
| --- | --- |
| `npm start` | 以生产模式启动 Electron |
| `npm run dev` | 启动并打开开发者工具 |
| `npm test` | 运行单元 / 集成测试 |
| `npm run smoke` | 启动开发版并做界面冒烟检查（需要图形环境） |
| `npm run icon` | 重新生成 `build/icon.png` |
| `npm run dist:linux` | 生成 AppImage / deb / pacman |
| `npm run dist:dir` | 只生成未打包目录 |
| `npm run dist:linux:portable` | 生成 Linux 便携 tar.gz + sha256 |
| `npm run env:status` / `env:pack` / `env:restore` / `env:purge` | 环境快照 |

## 测试

```bash
npm test
```

覆盖：

- 发行版 `os-release` 解析与包管理器家族识别；
- 内置知识库 / 技巧加载、搜索、索引取模；
- 设置持久化、范围校验、API Key 掩码与 `0600` 存储；
- 环境快照的 status / pack / purge 与家目录边界保护。

界面冒烟测试：

```bash
npm run smoke
```

会依次打开首页、AI、应用市场、文件、知识库、维护、设置七个页面，检查渲染内容、异常横幅与控制台错误，并验证设置读写链路。该脚本需要能启动 Electron 的图形环境。

## 安全与边界

- 不读取或保存系统密码；需要授权时由 polkit 等系统弹窗处理。
- 安装、卸载、删除、修改系统配置等操作，在 AI 流程中必须先经用户确认。
- 默认不写入家目录之外的位置；快照工具会拒绝越界路径。
- 便携包的 `chrome-sandbox` 需要 root 属主才能启用 setuid 沙箱；条件不满足时仅建议在测试环境临时使用 `--no-sandbox`。

## 已知限制

- Windows 主机不能执行 Linux 包管理，预览模式只展示界面与演示数据。
- AppImage / deb / pacman 必须在 Linux 上构建；Windows 产物只有便携 tar.gz。
- 部分功能依赖系统命令（`flatpak`、`snap`、`docker`、`journalctl` 等），缺失时会在界面提示。
- AI 功能需要自备服务商或本地模型，仓库不包含任何密钥。

## 已知不足/待优化
- [ ] 1. 界面内容超出窗口时未提供滚动窗口功能
- [ ] 2. 个性化主题市场无法正常应用主体、图标、光标、壁纸、字体
- [ ] 3. AI助手无法联网，进行`web_search`一类的操作，只能查软件包或相关依赖包
- [ ] 4. AI助手工具调用和思考过程无法正常渲染
- [ ] 5. AI助手上下文管理问题，超出是会直接截断，有待优化
- [ ] 6. AI助手授权索取窗口未限制必须点击弹窗按钮，会导致点击空白处会直接拒绝授权导致token浪费
- [ ] 7. 文件搜索、系统设置地UI/UX体验不统一

## 许可证

允许使用/修改/分发（含商业）；对 MPL 文件的修改需继续以 MPL-2.0 提供；二进制分发需附带许可证与源码获取地址；含专利授权、不含商标授权、不担保
