# 安装指南

## 系统要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows 10 / 11（64 位） |
| 磁盘空间 | 安装包约 81 MB；每个游戏实例另需 1–5 GB |
| Java | 启动游戏必需。Minecraft 1.20.5+ 建议 Java 21；较新版本建议 Java 17 |

> Java 不需要提前安装：HCL 会自动检测系统 Java；如果没有检测到，可以在 **设置 → Java 环境** 里点击“获取 Java 21”下载（Adoptium Temurin），或手动浏览选择 `java.exe`。

## 安装步骤

1. 下载安装包：
   - [Releases 页面](https://github.com/houshibo0101/HCL/releases) 的 `HCL Setup 1.0.0.exe`
   - 或直接使用仓库 `release/win-unpacked/` 中的绿色版 `HCL.exe`
2. 双击运行安装程序。若 Windows SmartScreen 提示“已保护你的电脑”：
   - 点击 **更多信息**
   - 点击 **仍要运行**
   - （提示原因是安装包未做代码签名，程序本身无恶意行为）
3. 按向导完成安装，桌面和开始菜单会生成 **HCL** 快捷方式
4. 首次启动会自动初始化数据目录

## 数据目录

HCL 所有游戏数据默认保存在 **D 盘**：

```
D:\HCL\
├── HCL.exe                    # 程序本体（安装版位于安装目录）
├── release\                   # 打包输出（仅源码仓库存在）
└── data\
    ├── games\
    │   └── instances\<实例ID>\
    │       ├── versions\      # 版本 JSON 与客户端 jar
    │       ├── libraries\     # 运行库
    │       ├── assets\        # 游戏资源（声音、语言、图标等）
    │       ├── mods\          # Mod 文件
    │       ├── shaderpacks\   # 光影文件
    │       └── saves\         # 存档
    ├── logs\error.log         # 下载/安装失败日志
    ├── settings.json          # 启动器设置
    └── instances.json         # 实例列表
```

可在 **设置 → 存储位置** 中修改游戏目录；修改后新实例会安装到新位置，已有实例不受影响。

## 卸载

- 使用系统“应用和功能”卸载 HCL 程序本体
- 游戏数据在 `D:\HCL\data`，卸载程序不会删除它；如不再需要可手动删除
