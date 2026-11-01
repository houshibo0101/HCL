# 开发与构建

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron 33 |
| 前端 | React 19 + Vite 6 |
| 图标 | lucide-react |
| 自动更新 | electron-updater（GitHub Releases） |
| 打包 | electron-builder（Windows NSIS；macOS 由 GitHub Actions CI 构建 x64 + arm64） |
| 压缩处理 | adm-zip（natives 解包、Java 运行时解压等） |

## 环境要求

- Node.js 18+（开发时使用 22.x 验证）
- npm 9+
- Windows 10/11（Windows 包在本机构建；macOS 包由 tag 推送触发 CI）

## 获取代码与安装依赖

```bash
git clone https://github.com/houshibo0101/HCL.git
cd HCL
```

国内网络建议使用 npmmirror，并给 Electron 设置镜像：

```bash
npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
# PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
# Git Bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

> Electron 二进制在依赖安装（postinstall）阶段下载，务必先设置 `ELECTRON_MIRROR` 再执行安装。

## 常用命令

```bash
npm run dev     # 开发模式（Vite + Electron，热更新）
npm run build   # 构建前端到 dist/
npm run start   # 以生产方式启动（需先 build）
npm run dist    # 打包 Windows 安装程序，输出到 release/
```

electron-builder 打包常见坑（国内环境）：

- Electron dist 下载失败：设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
- nsis / winCodeSign 下载失败：设 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- winCodeSign 解包在 Windows 上因 darwin 软链报“没有所需的特权”：手动从镜像下载 `winCodeSign-2.6.0.7z` 解压到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\`（两个软链错误可忽略），builder 即跳过下载

## 项目结构

```
HCL/
├── electron/
│   ├── main.cjs       # 主进程：窗口、IPC、版本安装（Vanilla/Fabric/Forge）、
│   │                  #   游戏启动、账户（离线/Yggdrasil）、联机（cpolar）、
│   │                  #   Java 检测与自动下载、electron-updater 自动更新
│   └── preload.cjs    # 预加载：contextBridge 暴露 window.hcl API
├── src/
│   ├── main.jsx       # React 入口
│   ├── App.jsx        # 全部页面组件（首页/版本/Mod/光影/下载/联机/设置）
│   ├── modDictionary.js # Mod/光影中英映射词表（中文搜索与汉化）
│   └── styles.css     # 全局样式（CSS 变量主题系统，6 套 data-theme）
├── public/            # 静态资源（图标、英雄区插画）
├── scripts/           # 辅助脚本（push-via-api.cjs：API 推送备用通道）
├── wiki/              # 本 Wiki 源文件（推送到 GitHub Wiki）
├── docs/              # GitHub Pages 版文档（main 分支 /docs 发布）
├── .github/workflows/release-mac.yml  # tag 触发的 macOS CI
├── dist/              # 构建输出（gitignore）
└── release/           # 打包输出（gitignore）
```

## 核心模块速览

| 模块 | 位置（main.cjs） | 说明 |
| --- | --- | --- |
| 版本安装 | `installVersion` | 客户端/libraries/assets 并发下载，路径去重防竞态，失败清理半成品 |
| Forge | `installVersion` Forge 分支 | 官方 installer `--installClient` + BMCLAPI 兜底 + 系统代理注入 |
| 游戏启动 | `launchGame` | inheritsFrom 合并父版本、authlib-injector 注入、语言写中文 |
| Java 匹配 | `requiredJavaMajor` / `resolveJavaForInstance` | 读版本 JSON `javaVersion`，缺则 Adoptium 下载（TUNA 镜像优先） |
| 账户 | `accounts:*` | accounts.json 多账户；Yggdrasil `authserver/authenticate` |
| 联机 | `net:*` | 本机 IP 枚举；cpolar 客户端下载（msiexec /a 静默解包）、隧道启停、本地 API 查询公网地址 |
| 自动更新 | `setupAutoUpdater` | electron-updater，启动检查 + 4 小时定时复查，事件广播渲染层 |

## 外部 API

| 用途 | 端点 |
| --- | --- |
| 版本清单 | `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` |
| 版本 JSON / 客户端 | piston-meta / piston-data（清单内返回） |
| 游戏资源 | `https://resources.download.minecraft.net/<hash前2位>/<hash>` |
| Mojang 镜像 | `https://bmclapi2.bangbang93.com`（Forge/Fabric/libraries 兜底） |
| Modrinth 搜索 | `https://api.modrinth.com/v2/search` |
| Modrinth 版本 | `https://api.modrinth.com/v2/project/{id}/version` |
| Fabric 加载器 | `https://meta.fabricmc.net/v2/versions/loader/{mc版本}`（BMCLAPI 兜底） |
| Java 运行时 | `https://api.adoptium.net/v3/assets/latest/{major}/hotspot`（镜像 `mirrors.tuna.tsinghua.edu.cn/Adoptium`） |
| Yggdrasil 认证 | `{apiRoot}/authserver/authenticate`（如 littleskin.cn/api/yggdrasil） |
| cpolar | 官网静态下载 + 本地 Web API `127.0.0.1:14040/api/tunnels` |

## 发布流程

1. 版本号写入 `package.json`，构建 `npm run build` 后 `electron-builder --publish always`（需 `GH_TOKEN`），生成 Windows 安装包并创建 Release + tag
2. tag 指向的 commit 必须已包含 `.github/workflows/release-mac.yml`，推送 tag 触发 macOS CI（x64 + arm64 的 dmg/zip 自动上传）
3. Release 说明通过 API PATCH（按 release id，注意 `/releases/latest` 仅支持 GET；删 tag 会把 Release 转为 draft，需重新 `draft=false`）
4. 网络代理对 `github.com` 主站不稳定时，代码推送可走 Git Data API（`scripts/push-via-api.cjs`：blobs → trees → commits → refs）

## 数据与隐私

- HCL 不上传任何用户数据；所有设置与游戏文件仅保存在本机
- 网络请求仅访问上表所列的数据源；皮肤站密码不落盘，仅保存会话令牌
