const body = [
  '## PCL2 风格动效打磨',
  '',
  '- **悬停放大**：游戏版本、Mod/光影、快捷卡片悬停时轻微放大 + 上浮 + 阴影加深（PCL2 同款手感）',
  '- **柔顺缓动曲线**：所有过渡换用 PCL2 式缓动（cubic-bezier），移动更"跟手"不生硬',
  '- **主题切换平滑换色**：切换 6 套主题时整窗颜色 0.32 秒平滑过渡，不再是瞬间跳变（纯 CSS 实现，绝不阻塞交互）',
  '- **启动淡入**：打开启动器时主界面整体淡入',
  '- **细节**：按钮悬停轻微上浮、启动按钮悬停光晕增强、侧栏导航图标悬停轻移、页面与卡片入场曲线更顺滑',
  '- 稳定性说明：全部为纯 CSS 动画，不参与输入拦截，尊重系统"减弱动态效果"设置',
  '',
  '---',
  '',
  '下载：[HCL-Setup-1.6.9.exe](https://github.com/houshibo0101/HCL/releases/download/v1.6.9/HCL-Setup-1.6.9.exe)（macOS 包由 CI 构建中）',
].join('\n');
fetch('https://api.github.com/repos/houshibo0101/HCL/releases/tags/v1.6.9', { headers: { Authorization: 'token ' + process.argv[2], 'User-Agent': 'HCL-Release' } })
  .then((r) => r.json())
  .then((rel) => fetch('https://api.github.com/repos/houshibo0101/HCL/releases/' + rel.id, {
    method: 'PATCH',
    headers: { Authorization: 'token ' + process.argv[2], 'User-Agent': 'HCL-Release', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, draft: false }),
  }))
  .then(async (r) => console.log('PATCH:', r.status, r.ok ? 'OK' : await r.text()));
