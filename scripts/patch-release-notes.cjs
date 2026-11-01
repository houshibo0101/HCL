const body = [
  '## 更新源国内镜像兜底（学 PCL2）',
  '',
  '- **官方源连不上也能更新**：GitHub 检查失败时，自动切换国内镜像链（gh-proxy → ghfast → ghproxy → moeyy）完成版本检查和安装包下载，全程无需手动操作',
  '- 镜像源通过代理的 `latest/download` 路径始终指向最新版本，不会卡在固定版本',
  '- 手动「检查更新」同样享受镜像兜底；下载完整性由 SHA512 校验保证',
  '- 官方能连时依然优先直连 GitHub，镜像只在失败时启用',
  '',
  '配合失败自动重试机制，国内网络环境下更新成功率大幅提升。',
  '',
  '---',
  '',
  '下载：[HCL-Setup-1.7.1.exe](https://github.com/houshibo0101/HCL/releases/download/v1.7.1/HCL-Setup-1.7.1.exe)（macOS 包由 CI 构建中）',
].join('\n');
fetch('https://api.github.com/repos/houshibo0101/HCL/releases/tags/v1.7.1', { headers: { Authorization: 'token ' + process.argv[2], 'User-Agent': 'HCL-Release' } })
  .then((r) => r.json())
  .then((rel) => fetch('https://api.github.com/repos/houshibo0101/HCL/releases/' + rel.id, {
    method: 'PATCH',
    headers: { Authorization: 'token ' + process.argv[2], 'User-Agent': 'HCL-Release', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, draft: false }),
  }))
  .then(async (r) => console.log('PATCH:', r.status, r.ok ? 'OK' : await r.text()));
