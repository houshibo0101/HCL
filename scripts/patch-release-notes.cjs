// 用 API 改写某个 Release 的说明（不需要本地 git 凭证）
// 用法: node scripts/patch-release-notes.cjs <token> <version>
//   例: node scripts/patch-release-notes.cjs ghp_xxx 1.7.13
const REPO = 'houshibo0101/HCL';
const API = 'https://api.github.com';

const NOTES = {
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
