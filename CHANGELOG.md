# 更新日志

按版本倒序记录。GitHub Releases 页面会同步展示每个版本的要点。

## 2.0.0

一次结构性升级：游戏资源改为全局共享、渲染层拆成模块、界面重新设计。

### 磁盘占用

- **shared 资源目录**：`assets` / `libraries` 从每个实例目录移到 `data\shared\`，同一版本的多个实例不再各存一份。旧实例在首次启动时自动迁移（同名同大小文件直接复用，跨盘自动降级为复制）。
- 实测：1.12.2 实例目录由 ~200 MB 降到 ~19 MB（资源部分转移至共享目录）。

### 界面

- 全新视觉：更深的背景层次、统一的卡片表面与细描边、更大的标题与留白、圆角胶囊式导航选中态。
- Hero 区重做：更大标题、径向光晕、渐变主按钮。
- 版本 / Mod / 实例 / 设置卡片统一悬停与阴影；标签改为胶囊样式。
- 细节：粘性设置侧栏、新的滚动条、焦点环、空状态与提示条统一。

### 架构

- `src/App.jsx` 从 735 行（单行 1000+ 字符）拆分为 `pages/` + `components/` + `lib/` + `constants.js` 共 11 个模块。
- 下载任务改用独立 store（`useSyncExternalStore`），任务进度不再触发整个 App 重渲染。
- 纯函数（版本比较、Java 匹配、离线 UUID、架构映射）抽到 `electron/lib/version-utils.cjs`。
- 迁移逻辑抽到 `electron/lib/shared-migration.cjs` 并补单测。

### 可靠性

- **断点续传**：固定 `.part` 文件 + `Range` 请求，失败后从已有字节继续；同一目标并发下载合并为一次。
- **令牌加密**：Yggdrasil `accessToken`、cpolar `authtoken` 使用系统密钥（DPAPI）加密落盘，旧明文自动迁移。
- 下载校验（1.7.13 引入）继续生效：Mojang SHA1 / Modrinth 哈希。

### 工程

- 新增 GitHub Actions **CI**（lint + test + build）。
- 删除三个依赖硬编码路径 / `eval` 的旧脚本，改为 `scripts/test-version-utils.cjs`、`scripts/test-migration.cjs`。
- 新增 `npm run docs`（wiki → docs）与 `scripts/capture-pages.cjs`（页面截图对比）。
- 新增 **MIT LICENSE**。
- Vite 文件监听忽略 `electron/`、`release/`、`data/` 与临时目录（此前会因文件锁崩溃）。

### 兼容性

- 数据目录结构变化：新增 `data\shared\`，实例目录不再含 `assets` / `libraries`。首次启动自动迁移，无需手动操作。
- 账户文件中的令牌会就地加密，回滚到 1.7.x 需要重新登录皮肤站账户。

## 1.7.13

- 修复 Forge / NeoForge 安装必失败（`const` 重赋值）
- 下载按 SHA1 校验，损坏文件自动重下
- 配置原子写入、单实例锁
- 渲染进程开启沙箱、生产构建注入 CSP
- 启动画面初始化失败兜底
- 原生库解压缓存、系统字体栈
- Apple Silicon 架构映射修正
- ESLint 覆盖 `.jsx`

## 1.7.12 及更早

见 [GitHub Releases](https://github.com/houshibo0101/HCL/releases)。
