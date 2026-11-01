# 开发与构建

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron 33 |
| 前端 | React 19 + Vite 6 |
| 图标 | lucide-react |
| 打包 | electron-builder（NSIS） |

## 环境要求

- Node.js 18+（开发时使用 22.x 验证）
- npm 9+
- Windows 10/11（打包目标平台）

## 获取代码

```bash
git clone https://github.com/houshibo0101/HCL.git
cd HCL
```

## 安装依赖

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
npm run dev     # 启动开发模式（Vite + Electron，热更新）
npm run build   # 构建前端到 dist/
npm run start   # 以生产方式启动（需先 build）
npm run dist    # 打包 Windows 安装程序，输出到 release/
```

打包如遇 winCodeSign 符号链接权限问题，可用环境变量 `CSC_IDENTITY_AUTO_DISCOVERY=false` 关闭签名检查（未签名打包不受影响）。

## 项目结构

```
HCL/
├── electron/
│   ├── main.cjs       # 主进程：窗口、IPC、版本安装、Modrinth、启动游戏
│   └── preload.cjs    # 预加载：contextBridge 暴露 window.hcl API
├── src/
│   ├── main.jsx       # React 入口
│   ├── App.jsx        # 全部页面组件（首页/版本/Mod/光影/下载/设置）
│   └── styles.css     # 全局样式（深色绿调主题）
├── public/            # 静态资源（图标、英雄区插画）
├── wiki/              # 本 Wiki 的源文件
├── dist/              # 构建输出（gitignore）
└── release/           # 打包输出（gitignore）
```

## 外部 API

| 用途 | 端点 |
| --- | --- |
| 版本清单 | `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` |
| 版本 JSON / 客户端 | piston-meta（清单内返回） |
| 游戏资源 | `https://resources.download.minecraft.net/<hash前2位>/<hash>` |
| Modrinth 搜索 | `https://api.modrinth.com/v2/search` |
| Modrinth 版本 | `https://api.modrinth.com/v2/project/{id}/version` |
| Fabric 加载器 | `https://meta.fabricmc.net/v2/versions/loader/{mc版本}` |

## 数据与隐私

- HCL 不上传任何用户数据；所有设置与游戏文件仅保存在本机
- 网络请求仅访问上表所列的官方数据源
