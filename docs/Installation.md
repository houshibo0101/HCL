# 安装指南

## 系统要求

| 项目 | Windows | macOS |
| --- | --- | --- |
| 系统 | Windows 10 / 11（64 位） | macOS 11+（Intel 与 Apple Silicon 均支持） |
| 安装包 | `HCL-Setup-x.x.x.exe`（约 81 MB） | `HCL-x.x.x.dmg` / `.zip`（约 100 MB） |
| 磁盘 | 每个游戏实例另需 1–5 GB | 同左 |
| Java | 不需要提前安装（见下文） | 同左 |

## 下载

- 最新版直链：<https://github.com/houshibo0101/HCL/releases/latest>
- 历史版本：<https://github.com/houshibo0101/HCL/releases>

| 平台 | 文件 |
| --- | --- |
| Windows 64 位 | `HCL-Setup-x.x.x.exe` |
| macOS Apple Silicon (M1/M2/M3/M4) | `HCL-x.x.x-arm64.dmg` 或 `.zip` |
| macOS Intel | `HCL-x.x.x.dmg` 或 `.zip` |

## Windows 安装步骤

1. 双击运行 `HCL Setup x.x.x.exe`。若 SmartScreen 提示“已保护你的电脑”：点击 **更多信息 → 仍要运行**（安装包未做代码签名，程序本身无恶意行为）
2. 按向导完成安装，桌面和开始菜单会生成 **HCL** 快捷方式
3. 首次启动会自动初始化数据目录

## macOS 安装步骤

1. 打开 `.dmg`，把 **HCL** 拖入「应用程序」
2. 首次打开若提示“无法验证开发者”：在启动器图标上 **右键 → 打开**，或到 **系统设置 → 隐私与安全性** 点击「仍要打开」
3. 若提示“已损坏，无法打开”，在终端执行后重新打开：

```bash
xattr -cr /Applications/HCL.app
```

> 原因同样是应用未做 Apple 公证签名，属正常现象。

## Java 环境说明

**不需要提前安装 Java。**

- **自动匹配**（v1.6.3 起）：启动游戏时，启动器按实例的官方版本信息自动确定所需 Java——1.16.5 及以下→**Java 8**，1.17–1.20.4→**Java 17**，1.20.5+→**Java 21**
- **自动下载**：本机没有匹配的 Java 时，自动从 [Adoptium](https://adoptium.net) 下载对应 JRE 并安装到启动器数据目录 `data\runtime\`，国内优先走清华 TUNA 镜像，下载完自动继续启动；进度可在 **下载管理** 查看（咖啡杯图标）
- **手动优先**：在 **设置 → Java 环境 → 浏览** 手动指定的 `java.exe` 优先级最高；也可以关闭「自动下载缺失的 Java」开关
- 安装 Forge 时缺 Java 同样会自动补齐

## 数据目录

Windows 默认所有数据保存在 **D 盘**；无 D 盘的机器自动落到 `%APPDATA%\HCL\data`：

```
D:\HCL\
└── data\
    ├── shared\
    │   ├── assets\            # 游戏资源（所有实例共用，按哈希去重）
    │   └── libraries\         # 运行库（所有实例共用）
    ├── games\
    │   └── instances\<实例ID>\
    │       ├── versions\      # 版本 JSON 与客户端 jar
    │       ├── mods\          # Mod 文件
    │       ├── shaderpacks\   # 光影文件
    │       ├── saves\         # 存档
    │       └── options.txt    # 游戏设置（含语言）
    ├── runtime\               # 自动下载的 Java（java-8 / java-17 / java-21）
    ├── tools\cpolar\          # 联机隧道程序（按需下载）
    ├── logs\error.log         # 下载/安装失败日志
    ├── settings.json          # 启动器设置
    ├── instances.json         # 实例列表
    └── accounts.json          # 游戏账户（离线 / 皮肤站，令牌加密存储）
```

> **2.0.0 起** `assets` / `libraries` 由 `data\shared\` 统一管理：同一版本建多个实例只占一份磁盘。升级后首次启动会把旧实例里的资源自动迁移过去，实例目录不会再有这两个文件夹。

可在 **设置 → 存储位置** 修改游戏目录；修改后只影响之后新建的实例。

## 自动更新

- 启动时自动检查新版本，运行中每 2 小时复查一次
- 发现新版本自动后台下载，完成后右下角弹出更新卡片，点 **立即重启** 几秒钟完成安装；不点则退出应用时自动安装
- 可在 **设置 → 启动器更新** 关闭；详情见 [常见问题](FAQ.md)

macOS 当前版本自动更新需应用签名支持，暂以「检测新版本 + 提示手动下载」为主。

## 卸载

- Windows：使用系统「应用和功能」卸载程序本体
- 游戏数据在 `data\` 目录，卸载不会删除它；不再需要时可手动删除
