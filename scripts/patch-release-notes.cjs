// 用 API 改写某个 Release 的说明（不需要本地 git 凭证）
// 用法: node scripts/patch-release-notes.cjs <token> <version>
//   例: node scripts/patch-release-notes.cjs ghp_xxx 1.7.13
const REPO = 'houshibo0101/HCL';
const API = 'https://api.github.com';

const NOTES = {
  '2.1.2': `## 修复：需要 Java 22+ 的版本无法自动安装 Java

### 问题
26.x 快照要求 Java 25，但启动器的下载策略把 18 以上一律当成 21，于是只下了 Java 21，再按「>= 25」校验自然找不到，直接报"Java 25 自动下载后仍不可用"。

### 修复
- 按游戏实际要求下载：要求 25 就下 25，不再降级到 21
- 回退顺序改为「要求版本 → 更新的 LTS」（例如要求 22 时依次试 22、25）
- 优先 JRE（约 56 MB），没有 JRE 时自动改用 JDK
- Forge / NeoForge 安装器改为读取版本 JSON 的 \`javaVersion\`，不再按版本号猜
- 失败提示会带上真实原因（找不到该版本 / 下载失败）

### 验证
- 新增 Java 版本选择单测，10 组全过
- 真实下载 Adoptium Java 25（清华镜像）：56 MB / 13.7 秒，解压后 \`java -version\` = 25.0.5，主版本识别为 25

> 升级后重试启动即可，已下载的 Java 21 不会浪费，遇到需要旧版本的实例仍会复用它。

下载：[HCL-Setup-2.1.2.exe](https://github.com/houshibo0101/HCL/releases/download/v2.1.2/HCL-Setup-2.1.2.exe)（macOS 包由 CI 构建）`,
  '2.1.1': `## 修复：个别资源校验失败会中断整个安装

### 问题
部分用户安装快照时遇到 \`文件校验失败（SHA1 不匹配）\`，原因是断点续传时把两段内容拼在了一起 / 进度统计与实际写入不一致，导致整个安装失败、半成品实例被清理。

### 修复
- 断点续传现在校验服务端返回的 \`Content-Range\` 起点，不一致就丢弃半截文件重新下载
- 字节统计移入写入管线，"写入量"与"统计量"始终一致
- 校验失败自动清掉 \`.part\` 重下一遍，仍不对才报错；错误信息带上实得哈希与字节数
- 游戏资源增加 BMCLAPI 镜像兜底
- **单个资源坏掉不再中断安装**：跳过并写入失败日志，安装继续完成（完成提示会注明跳过了几个）

### 工程
- 下载器抽成 \`electron/lib/downloader.cjs\`，新增 8 组单测（断点续传 / Range 异常 / 哈希失败重试 / 多源回退）

> 在 2.1.0 遇到该问题的用户，升级后重新安装一次即可；失败的半成品目录已被自动清理。

下载：[HCL-Setup-2.1.1.exe](https://github.com/houshibo0101/HCL/releases/download/v2.1.1/HCL-Setup-2.1.1.exe)（macOS 包由 CI 构建）`,
  '2.1.0': `## 新界面：钢蓝 Steel

### 视觉
- 中性冷灰蓝底色（\`#0b0e12\` → \`#111823\`），统一 1px 描边，去掉渐变与光晕
- 圆角从 12–20px 收到 **4px**，卡片改为纯扁平表面
- 字号整体下调一档、行高收紧；分区标题带下划线，版本号与数字改用等宽字形
- 七个页面 + 全部状态（空 / 加载 / 出错 / 弹窗 / 下载中）统一重排
- 六套强调色主题保留并重新派生

### 窗口
- 默认尺寸 **1440×900 → 1180×760**，居中启动，不再一打开就逼近全屏
- 最小尺寸 1024×660；1150px 以下网格降为两列，1040px 以下右栏改为并排

### 其他
- 截图工具新增 \`HCL_CAPTURE_SIZE\` / \`HCL_CAPTURE_CSS\`，方便做尺寸与皮肤对比
- 功能、数据目录、安装逻辑与 2.0.0 完全一致，可直接覆盖安装

下载：[HCL-Setup-2.1.0.exe](https://github.com/houshibo0101/HCL/releases/download/v2.1.0/HCL-Setup-2.1.0.exe)（macOS 包由 CI 构建）`,
  '2.0.0': `## HCL 2.0：结构升级与全新界面

### 更省磁盘
- **游戏资源改为全局共享**：\`assets\` / \`libraries\` 从每个实例目录移到 \`data\\shared\\\`，同一版本建多个实例只占一份磁盘
- 升级后首次启动**自动迁移**旧实例资源（同名同大小文件直接复用，跨盘自动降级为复制），迁移完成会弹一次提示
- 实测：1.12.2 实例目录由约 200 MB 降到约 19 MB

### 更好看
- 全新视觉：更深的背景层次、统一卡片表面与细描边、更大的标题与留白、胶囊式导航选中态
- Hero 区重做、渐变主按钮、卡片悬停与阴影统一、标签改为胶囊样式
- 粘性设置侧栏、新版滚动条与焦点环

### 更稳
- **断点续传**：下载中断后从断点继续，不再从头重下；同一文件的并发请求自动合并
- **令牌加密**：皮肤站 accessToken 与 cpolar authtoken 使用系统密钥（DPAPI）加密落盘，旧明文自动迁移
- 继续保留 1.7.13 的 SHA1 校验、单实例锁、配置原子写入、渲染进程沙箱与 CSP

### 工程
- \`App.jsx\` 拆分为 \`pages/\` + \`components/\` + \`lib/\` 共 11 个模块；下载任务改独立状态源，进度不再触发全应用重渲染
- 新增 GitHub Actions **CI**（lint + test + build）与 **MIT LICENSE**
- 纯函数与迁移逻辑补了单测（13 组用例）

> 兼容性说明：数据目录新增 \`data\\shared\\\`，首次启动会自动迁移，无需手动操作；回滚到 1.7.x 需重新登录皮肤站账户。

下载：[HCL-Setup-2.0.0.exe](https://github.com/houshibo0101/HCL/releases/download/v2.0.0/HCL-Setup-2.0.0.exe)（macOS 包由 CI 构建）`,
  '1.7.13': `## 可靠性维护与安全加固

- **修复 Forge / NeoForge 安装必失败**：v1.7.12 中 Forge 官方安装器跑完后写版本目录会抛 \`Assignment to constant variable\`，导致所有 Forge / NeoForge 实例安装失败，现已修复
- **下载完整性校验**：客户端、运行库、游戏资源按 Mojang 官方 SHA1 校验，Mod / 光影按 Modrinth 哈希校验；损坏文件自动删除重下，不再把半截文件当成已完成
- **单实例运行**：重复打开启动器只会把已有窗口唤到前台，避免两个进程同时改写 \`settings.json\` / \`instances.json\`
- **配置原子写入**：设置、实例、账户先写临时文件再替换，断电或崩溃不会留下半截 JSON
- **渲染进程沙箱 + CSP**：\`sandbox: true\`，生产构建注入内容安全策略，外链只放行 http(s)
- **首次渲染更稳**：初始化失败也会退出启动画面，不会再永远卡在加载页
- **启动更快**：字体改用系统字体栈（不再请求 Google Fonts），原生库解压结果缓存复用
- **Apple Silicon 修正**：清单 \`os.arch\` 映射补齐 arm64
- **更新检查去重**：启动时不再同一时间触发两次检查

下载：[HCL-Setup-1.7.13.exe](https://github.com/houshibo0101/HCL/releases/download/v1.7.13/HCL-Setup-1.7.13.exe)（macOS 包由 CI 构建中）`,
};

async function main() {
  const [token, versionArg] = process.argv.slice(2);
  if (!token || !versionArg) throw new Error('用法: node scripts/patch-release-notes.cjs <token> <version>');
  const version = String(versionArg).replace(/^v/, '');
  const body = NOTES[version];
  if (!body) throw new Error(`没有 ${version} 的更新说明，请先在 NOTES 里补一条`);

  const headers = { Authorization: `token ${token}`, 'User-Agent': 'HCL-Release', 'Content-Type': 'application/json' };
  const tag = `v${version}`;
  const release = await fetch(`${API}/repos/${REPO}/releases/tags/${tag}`, { headers });
  if (!release.ok) throw new Error(`找不到 Release ${tag}：HTTP ${release.status}`);
  const info = await release.json();
  const patched = await fetch(`${API}/repos/${REPO}/releases/${info.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ body, name: tag, draft: false }),
  });
  if (!patched.ok) throw new Error(`更新说明失败：HTTP ${patched.status} ${await patched.text()}`);
  console.log(`已更新 ${tag} 的说明`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
