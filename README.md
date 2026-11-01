# HCL - Minecraft 启动器

一个简洁、清爽的 Minecraft 启动器。专注于游戏与社区内容，不做多余的事情。

![HCL 主界面](docs/preview.png)

## 功能

- **游戏版本下载** — 接入 Mojang 官方版本源，一键下载客户端、运行库和资源文件，支持正式版 / 快照 / Beta / Alpha
- **Mod 下载** — 接入 [Modrinth](https://modrinth.com)，按游戏版本和加载器（Fabric / Forge / NeoForge / Quilt）筛选，直接下载到实例的 `mods` 文件夹
- **光影下载** — Modrinth 光影资源浏览与下载，保存到实例的 `shaderpacks` 文件夹
- **原版 / Fabric / Forge 实例** — 创建实例时可选原版、Fabric 或 Forge（Forge 走官方安装器，BMCLAPI 国内镜像兜底），每个实例拥有独立的存档、Mod 与光影
- **下载管理** — 后台多任务下载，实时进度、取消、失败日志
- **本地实例管理** — 实例切换 / 删除（移入回收站）、打开实例目录
- **启动设置** — 离线玩家名、内存分配、Java 自动检测与自定义路径
- **应用内更新** — 基于 GitHub Releases 自动检查，后台下载，重启后自动安装
- **外观主题** — 6 套强调色主题（翡翠绿/穹际蓝/星辉紫/暖阳橙/樱花粉/薄荷青），设置页一键切换、即时生效

## 快速开始

1. 从 [Releases](https://github.com/houshibo0101/HCL/releases) 下载 `HCL Setup 1.0.0.exe`（或 `release/win-unpacked/HCL.exe` 绿色版）
2. 安装并运行；Windows SmartScreen 提示时选择“更多信息 → 仍要运行”（安装包未做代码签名）
3. 在“游戏版本”页选择版本创建实例，然后回首页点击“启动游戏”

> 系统要求：Windows 10/11（64 位）。Minecraft 1.20.5+ 建议 Java 21，较新版本建议 Java 17；未检测到 Java 时可在“设置”页一键获取。

## 数据目录

所有游戏数据保存在 D 盘，不写入 C 盘用户目录：

```
D:\HCL\data
├── games\instances\<实例>\   # 游戏实例（versions / assets / libraries / mods / shaderpacks / saves）
├── logs\error.log            # 下载/安装失败日志
├── settings.json             # 启动器设置
└── instances.json            # 实例列表
```

## 从源码构建

```bash
git clone https://github.com/houshibo0101/HCL.git
cd HCL
# 国内网络建议使用镜像
npm install --registry=https://registry.npmmirror.com
# Electron 二进制建议走镜像
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

npm run dev     # 开发调试
npm run build   # 构建前端
npm run dist    # 打包 Windows 安装程序（输出到 release/）
```

详细文档见 [Wiki](https://github.com/houshibo0101/HCL/wiki)。

## 技术栈与数据来源

- Electron + React + Vite
- 游戏版本：Mojang 官方 version manifest / piston-meta
- Mod / 光影：Modrinth API
- Fabric 加载器：FabricMC meta API
- Forge 加载器：Forge 官方 Maven + BMCLAPI 镜像

## 免责声明

Minecraft 是 Mojang Synergies AB 的商标。HCL 不是官方 Minecraft 产品，与 Mojang 或 Microsoft 无隶属关系。
